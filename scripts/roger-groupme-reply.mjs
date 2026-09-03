#!/usr/bin/env node
/**
 * Roger GroupMe reply lane.
 *
 * Roger has posted deadline reminders into the league GroupMe for years and has
 * never once heard the chat answer back. This script is that return path: it
 * reads recent messages, finds the ones aimed at Roger, and — when the model
 * agrees the message was a shot — posts a comeback grounded in the sender's
 * actual roster.
 *
 * Not a standalone cron. It is invoked inline at the END of
 * scripts/schefter-scan.mjs, after scanEventReminders has already posted the
 * reminders this tick, so a reply Roger earns on one run is answered on the
 * next (15 minutes later). One cron, both directions.
 *
 * KEYS (all league-scoped so the AFL can be switched on without collision):
 *   roger:<league>:groupme:last_reply_id   watermark cursor — NEVER expires
 *   roger:<league>:groupme:bot_message_ids Roger's own post ids (48h) — the
 *                                          set native replies resolve against
 *   roger:<league>:clapbacks_today         daily counter, expires at PT midnight
 *   roger:<league>:clapback:last_ts        ms epoch of the last clapback
 *   roger:<league>:clapback:owner:<userId> per-owner cooldown marker
 *
 * WHY THE WATERMARK ADVANCES EVEN ON A SKIP: the alternative is re-reading the
 * same messages every 15 minutes forever. A message Roger declined once he will
 * decline again, so there is nothing to gain and a duplicate-post risk to run.
 *
 * Roger's lane never touches Schefter's keys or his tips queue — see the
 * two-bots note in scripts/lib/roger-clapback.mjs for how the two stay disjoint.
 */

import fs from 'node:fs/promises';

import { getRedisConfig, createUpstashClient } from './lib/redis.mjs';
import { postToGroupMe } from './lib/groupme.mjs';
import { isQuietHours, secondsUntilPtMidnight } from './lib/schefter-groupme-budget.mjs';
import { getCurrentYears } from './lib/league-years.mjs';
import { buildRosterRoast, buildDraftContext } from './lib/roger-roster-context.mjs';
import {
  detectRogerTarget,
  isRogerBotMessage,
  buildFactSheet,
  generateClapback,
  MAX_CLAPBACKS_PER_DAY,
  OWNER_COOLDOWN_MS,
  MIN_GAP_MS,
  BOT_MESSAGE_IDS_TTL_SEC,
  MAX_TRACKED_BOT_MESSAGES,
} from './lib/roger-clapback.mjs';

const GROUPME_API_BASE = 'https://api.groupme.com/v3';

function log(...args) {
  console.log('[roger-reply]', ...args);
}
function warn(...args) {
  console.warn('[roger-reply]', ...args);
}

/** League-scoped Redis key. Mirrors schefterKey's shape for the Roger lane. */
export function rogerKey(navSlug, suffix) {
  return `roger:${navSlug}:${suffix}`;
}

async function getRedis() {
  const config = getRedisConfig();
  if (!config) return null;
  try {
    return await createUpstashClient(config);
  } catch (err) {
    warn(`Redis init failed: ${err.message}`);
    return null;
  }
}

/**
 * Fetch GroupMe messages since the watermark, oldest first.
 *
 * The service token is account-wide (one GroupMe user, all their groups), so
 * it stays global; the GROUP is per-league and comes from the registry.
 */
async function fetchGroupMeSince(watermarkId, groupId) {
  const token = process.env.GROUPME_SERVICE_TOKEN || process.env.GROUPME_ACCESS_TOKEN;
  if (!token || !groupId) {
    warn('GroupMe service token or group id not set — skipping Roger reply scan');
    return null;
  }

  const url = new URL(`${GROUPME_API_BASE}/groups/${groupId}/messages`);
  url.searchParams.set('token', token);
  url.searchParams.set('limit', '100');
  if (watermarkId) url.searchParams.set('since_id', watermarkId);

  try {
    const res = await fetch(url.toString());
    if (res.status === 304) return [];
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      warn(`GroupMe fetch failed (${res.status}): ${body.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const messages = data?.response?.messages ?? [];
    return [...messages].sort((a, b) => a.created_at - b.created_at);
  } catch (err) {
    warn(`GroupMe fetch error: ${err.message}`);
    return null;
  }
}

/** Read a JSON feed, returning null rather than throwing when it's absent. */
async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Resolve a GroupMe sender to a franchise, scoped to the league.
 *
 * The mapping is the commissioner-curated one written by
 * src/utils/groupme-storage.ts#linkFranchise. That writer uses a BARE
 * `groupme:user:<userId>` key and loads TheLeague's team config, so the ids
 * behind it are TheLeague franchise ids — and both leagues have a franchise
 * "0001". An owner who plays in both would collide on the bare key, and the
 * AFL would read a TheLeague franchise id against AFL feeds: a roster that
 * belongs to a different person in a different league.
 *
 * So the lookup is league-scoped, with the legacy bare key kept as a
 * TheLeague-only fallback (same idiom as rankings-scope.ts, where TheLeague
 * keeps the unprefixed key and every other league gets its own). The AFL gets
 * NO fallback — reading the bare key there is exactly the bug above.
 *
 * Display names are deliberately not a fallback in either league: GroupMe
 * nicknames are free text an owner can change to anything (the message that
 * prompted this feature came from "Dicks out for Harambe", which is not a team
 * name in any league), and a fuzzy match that lands wrong means Roger reads
 * out someone else's roster to the whole chat. No mapping simply means no
 * roster facts — the clapback still fires, just without specifics.
 */
export function franchiseMapKeys(navSlug, userId) {
  const scoped = `groupme:${navSlug}:user:${userId}`;
  return navSlug === 'theleague' ? [scoped, `groupme:user:${userId}`] : [scoped];
}

async function resolveFranchiseId(redis, navSlug, userId) {
  if (!redis || !userId) return null;
  for (const key of franchiseMapKeys(navSlug, userId)) {
    try {
      const value = await redis.get(key);
      if (typeof value === 'string' && value) return value;
    } catch (err) {
      warn(`Franchise lookup failed on ${key}: ${err.message}`);
    }
  }
  return null;
}

/** Load the team display name for a franchise from the league config. */
async function loadTeamName(configPath, franchiseId) {
  const config = await readJson(configPath);
  const team = (config?.teams ?? []).find((t) => t.franchiseId === franchiseId);
  return team?.name ?? null;
}

/**
 * Build the roster fact sheet for one franchise. Every feed read is
 * best-effort: a missing feed degrades to a factless clapback rather than
 * blocking the reply or, worse, guessing.
 */
async function buildFacts(league, franchiseId, year) {
  if (!franchiseId) return { roast: null, draft: null, teamName: null };

  const [rostersFeed, playersFeed, leagueFeed, draftFeed, teamName] = await Promise.all([
    readJson(league.feedFilePath(year, 'rosters.json')),
    readJson(league.feedFilePath(year, 'players.json')),
    readJson(league.feedFilePath(year, 'league.json')),
    readJson(league.feedFilePath(year, 'draftResults.json')),
    loadTeamName(league.configPath, franchiseId),
  ]);

  if (!rostersFeed || !playersFeed) {
    warn(`Missing roster/player feeds for ${year} — clapback will run factless`);
    return { roast: null, draft: null, teamName };
  }

  const roast = buildRosterRoast({ franchiseId, rostersFeed, playersFeed, leagueFeed });
  const draft =
    roast?.topRoast && draftFeed
      ? buildDraftContext({
          franchiseId,
          draftFeed,
          playersFeed,
          position: roast.topRoast.position,
        })
      : null;

  return { roast, draft, teamName };
}

/**
 * Check the shared rails before spending an API call.
 *
 * Ordered cheapest-first, and every failure is a hard stop rather than a delay:
 * a clapback that arrives four hours after the joke isn't a clapback.
 */
async function checkRails(redis, league, userId, nowMs) {
  if (!redis) return { allowed: false, reason: 'no-redis' };

  const todayKey = rogerKey(league.slug, 'clapbacks_today');
  const lastTsKey = rogerKey(league.slug, 'clapback:last_ts');
  const ownerKey = rogerKey(league.slug, `clapback:owner:${userId}`);

  try {
    const [todayRaw, lastTsRaw, ownerRaw] = await Promise.all([
      redis.get(todayKey),
      redis.get(lastTsKey),
      redis.get(ownerKey),
    ]);

    const today = parseInt(todayRaw ?? '0', 10) || 0;
    if (today >= MAX_CLAPBACKS_PER_DAY) {
      return { allowed: false, reason: `daily-cap (${today}/${MAX_CLAPBACKS_PER_DAY})` };
    }

    const lastTs = parseInt(lastTsRaw ?? '0', 10) || 0;
    if (lastTs && nowMs - lastTs < MIN_GAP_MS) {
      return { allowed: false, reason: `min-gap (${Math.round((nowMs - lastTs) / 60000)}m ago)` };
    }

    const ownerTs = parseInt(ownerRaw ?? '0', 10) || 0;
    if (ownerTs && nowMs - ownerTs < OWNER_COOLDOWN_MS) {
      return {
        allowed: false,
        reason: `owner-cooldown (${Math.round((nowMs - ownerTs) / 60000)}m ago)`,
      };
    }

    return { allowed: true };
  } catch (err) {
    // Rails unreadable means rails unenforceable. Staying silent is the safe
    // failure for a bot with a live microphone.
    return { allowed: false, reason: `rails-read-failed: ${err.message}` };
  }
}

/** Record a posted clapback against all three rails. */
async function recordClapback(redis, league, userId, nowMs) {
  const todayKey = rogerKey(league.slug, 'clapbacks_today');
  try {
    const count = await redis.incr(todayKey);
    if (count === 1) await redis.expire(todayKey, secondsUntilPtMidnight(new Date(nowMs)));
    await redis.set(rogerKey(league.slug, 'clapback:last_ts'), nowMs);
    await redis.set(rogerKey(league.slug, `clapback:owner:${userId}`), nowMs, {
      ex: Math.ceil(OWNER_COOLDOWN_MS / 1000),
    });
  } catch (err) {
    warn(`Rail bookkeeping failed: ${err.message}`);
  }
}

/**
 * Scan for messages aimed at Roger and answer the ones that were shots.
 *
 * @param {object} opts
 * @param {object} opts.league  a SCHEFTER_LEAGUES entry
 * @param {boolean} [opts.dryRun]  skip every Redis write and the GroupMe send
 * @returns {Promise<{scanned:number, targeted:number, posted:number, skipped:Array}>}
 */
export async function scanRogerReplies({ league, dryRun = false }) {
  const result = { scanned: 0, targeted: 0, posted: 0, skipped: [] };

  if (!league?.features?.rogerReplies) {
    log(`Skipping ${league?.slug} — Roger's reply lane is off for this league`);
    return result;
  }
  if (!league.features.eventReminders) {
    log(`Skipping ${league.slug} — Roger doesn't post here, so there is nothing to reply to`);
    return result;
  }
  if (!league.groupMeRogerBotId) {
    log(`Skipping ${league.slug} — no Roger bot id configured`);
    return result;
  }
  if (!league.groupMeGroupId) {
    log(`Skipping ${league.slug} — no GroupMe group id configured for this league`);
    return result;
  }

  // Quiet hours wrap the WHOLE scan, matching scanEventReminders. Unlike the
  // reminder lane there is no catch-up window to worry about: a shot Roger
  // sleeps through is one he simply doesn't answer, and answering a 1am dig at
  // 7am would be worse than staying quiet.
  if (isQuietHours(new Date())) {
    log(`Quiet hours — Roger holds his tongue in ${league.slug}`);
    return result;
  }

  const redis = await getRedis();
  if (!redis) {
    warn('No Redis — cannot read watermark or enforce rails; skipping');
    return result;
  }

  const watermarkKey = rogerKey(league.slug, 'groupme:last_reply_id');
  const botIdsKey = rogerKey(league.slug, 'groupme:bot_message_ids');

  let watermark = null;
  try {
    const raw = await redis.get(watermarkKey);
    watermark = raw == null ? null : String(raw);
  } catch (err) {
    warn(`Watermark read failed: ${err.message}`);
  }

  log(`Fetching ${league.slug} messages since watermark=${watermark ?? '(none)'}`);
  const messages = await fetchGroupMeSince(watermark, league.groupMeGroupId);
  if (messages === null) return result;
  result.scanned = messages.length;
  if (messages.length === 0) {
    log('No new messages');
    return result;
  }

  // Roger's own post ids, so a native reply can be resolved against posts made
  // on earlier runs as well as ones in this batch.
  const rogerBotMsgIds = new Set();
  try {
    const cached = await redis.lrange(botIdsKey, 0, MAX_TRACKED_BOT_MESSAGES - 1);
    if (Array.isArray(cached)) for (const id of cached) if (typeof id === 'string') rogerBotMsgIds.add(id);
  } catch (err) {
    warn(`Bot-message-id cache read failed: ${err.message}`);
  }
  const newRogerMsgIds = [];
  // Text of Roger's posts in this batch, so the model can see what it is the
  // owner actually replied to.
  const rogerPostText = new Map();

  const { currentLeagueYear } = getCurrentYears();
  const newestId = messages[messages.length - 1].id;

  for (const msg of messages) {
    // Track Roger's own posts BEFORE the bot filter — replies later in this
    // same batch need them.
    if (isRogerBotMessage(msg, league.groupMeRogerBotSenderId) && typeof msg.id === 'string') {
      if (!rogerBotMsgIds.has(msg.id)) {
        rogerBotMsgIds.add(msg.id);
        newRogerMsgIds.push(msg.id);
      }
      if (typeof msg.text === 'string') rogerPostText.set(msg.id, msg.text);
      continue;
    }
    // Never answer a bot — least of all Schefter, who would answer back.
    if (msg.sender_type === 'bot') continue;

    const target = detectRogerTarget(msg, rogerBotMsgIds);
    if (!target.match) {
      if (/roger/i.test(msg.text ?? '')) {
        result.skipped.push({ id: msg.id, author: msg.name, reason: target.reason });
      }
      continue;
    }
    result.targeted += 1;

    const nowMs = Date.now();
    const userId = msg.user_id ?? msg.sender_id ?? '';
    const rails = await checkRails(redis, league, userId, nowMs);
    if (!rails.allowed) {
      log(`  Skipping ${msg.name}: ${rails.reason}`);
      result.skipped.push({ id: msg.id, author: msg.name, reason: rails.reason });
      continue;
    }

    const franchiseId = await resolveFranchiseId(redis, league.slug, userId);
    const { roast, draft, teamName } = await buildFacts(league, franchiseId, currentLeagueYear);
    const factSheet = buildFactSheet({
      teamName,
      roast,
      draft,
      rogerPostText: target.replyToGroupMeId ? rogerPostText.get(target.replyToGroupMeId) : null,
    });

    const clapback = await generateClapback({
      ownerText: msg.text ?? '',
      ownerName: msg.name,
      factSheet,
    });

    if (!clapback.shot) {
      log(`  No swing at ${msg.name}: ${clapback.reason ?? 'not a shot'}`);
      result.skipped.push({ id: msg.id, author: msg.name, reason: clapback.reason ?? 'not-a-shot' });
      continue;
    }

    if (dryRun) {
      log(`  [dry-run] Would reply to ${msg.name}: ${clapback.reply}`);
      result.posted += 1;
      continue;
    }

    await postToGroupMe({
      botId: league.groupMeRogerBotId,
      text: clapback.reply,
      onPosted: () => log(`  Replied to ${msg.name}: ${clapback.reply}`),
      onFetchError: (err) => warn(`  GroupMe send failed: ${err.message}`),
    });
    await recordClapback(redis, league, userId, nowMs);
    result.posted += 1;
  }

  if (!dryRun) {
    try {
      await redis.set(watermarkKey, newestId);
    } catch (err) {
      warn(`Watermark write failed: ${err.message}`);
    }
    if (newRogerMsgIds.length > 0) {
      try {
        await redis.lpush(botIdsKey, ...[...newRogerMsgIds].reverse());
        await redis.ltrim(botIdsKey, 0, MAX_TRACKED_BOT_MESSAGES - 1);
        await redis.expire(botIdsKey, BOT_MESSAGE_IDS_TTL_SEC);
      } catch (err) {
        warn(`Bot-message-id cache write failed: ${err.message}`);
      }
    }
  } else {
    log(`  [dry-run] Would advance watermark → ${newestId}, cache ${newRogerMsgIds.length} Roger post ids`);
  }

  log(
    `${league.slug}: scanned=${result.scanned} targeted=${result.targeted} ` +
      `posted=${result.posted} skipped=${result.skipped.length}`,
  );
  return result;
}

// ── CLI ──
// `node scripts/roger-groupme-reply.mjs --dry-run` for a no-write rehearsal.
if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes('--dry-run');
  const { SCHEFTER_LEAGUES } = await import('./lib/schefter-leagues.mjs');
  for (const league of SCHEFTER_LEAGUES) {
    await scanRogerReplies({ league, dryRun });
  }
}
