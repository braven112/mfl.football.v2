#!/usr/bin/env node
/**
 * Schefter Trade Speculation — daily scanner that turns the league's tradeBait
 * + roster + cap state into Schefter-voiced speculation posts on the news feed.
 *
 * Phase 1 scope (per docs/plans/schefter-trade-speculation.md):
 *   - Two-team match search (no three-team yet)
 *   - Schefter blurb via Claude API (falls back to template on API failure)
 *   - Append to src/data/theleague/schefter-feed.json
 *   - Append to data/theleague/derived/speculation-history.json (rotation gate)
 *   - Honor calendar-aware cadence (scripts/lib/speculation-cadence.mjs)
 *   - Share the 3-posts/day rumor-mill budget (`schefter:rumor:posts_today`),
 *     with a peak-week reservation that lets speculation skip past a saturated
 *     budget the week before the trade deadline
 *   - NO GroupMe posting yet — that lands in Phase 2
 *
 * Usage:
 *   node scripts/schefter-trade-speculation.mjs           # live run
 *   node scripts/schefter-trade-speculation.mjs --dry-run # no mutations
 *
 * Env (required for live posting):
 *   ANTHROPIC_API_KEY        Claude API key for blurb generation
 *   UPSTASH_REDIS_REST_URL   Redis URL (required for shared daily counter)
 *   UPSTASH_REDIS_REST_TOKEN Redis token
 *   (KV_* / STORAGE_* fallbacks also accepted, mirroring the rumor-mill)
 *
 * Optional:
 *   SCHEFTER_TRADE_SPECULATION_ENABLED  gate flag — must be truthy to run
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import {
  resolveCadence,
  permitsPost,
} from './lib/speculation-cadence.mjs';
import {
  findTwoTeamCandidates,
  valuePlayer,
} from './lib/speculation-matching.mjs';
import {
  defaultLedgerPath,
  loadLedger,
  saveLedger,
  appendEntry,
  postsToday as ledgerPostsToday,
  lastPostAt as ledgerLastPostAt,
  recentlyPostedTrade,
  franchiseInRecentRotation,
  tradeSignature,
} from './lib/speculation-history.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DRY_RUN = process.argv.includes('--dry-run');

// ── Constants ──

const LEAGUE_SLUG = 'theleague';
const FEED_PATH = path.join(projectRoot, 'src', 'data', 'theleague', LEAGUE_SLUG === 'theleague' ? 'schefter-feed.json' : `${LEAGUE_SLUG}-schefter-feed.json`);
const RESOLVED_EVENTS_PATH = path.join(projectRoot, 'src', 'data', 'theleague', 'resolved-events.json');
const TEAMS_CONFIG_PATH = path.join(projectRoot, 'src', 'data', 'theleague.config.json');

// Shared rumor-mill daily counter — keep in sync with scripts/schefter-rumor-scan.mjs
const RUMOR_POSTS_TODAY_KEY = 'schefter:rumor:posts_today';
const RUMOR_LAST_POST_TS_KEY = 'schefter:rumor:last_post_ts';
const MAX_GLOBAL_POSTS_PER_DAY = 3;
const RESERVED_PEAK_SLOT = 1; // peak-week speculation may use this slot even if 3 are burned

const SPECULATION_TIER_TWO_TEAM = 'speculation_two_team';
const SPECULATION_SUB_TYPE = 'trade_speculation';

const log = (...args) => console.log(...args);
const warn = (...args) => console.warn(...args);

// ── Time helpers (mirror rumor-scan) ──

function getPtHour(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(fmt.format(now), 10);
}

function isQuietHours(now = new Date()) {
  const h = getPtHour(now);
  return h >= 23 || h < 7;
}

function secondsUntilPtMidnight(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  const h = parseInt(parts.hour, 10);
  const m = parseInt(parts.minute, 10);
  const s = parseInt(parts.second, 10);
  return 24 * 3600 - (h * 3600 + m * 60 + s);
}

// ── Redis ──

let _redis;
async function getRedis() {
  if (_redis !== undefined) return _redis;
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.STORAGE_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.STORAGE_REST_API_TOKEN;
  if (!url || !token) {
    warn('[speculation] Redis credentials not set — running without budget gate');
    _redis = null;
    return null;
  }
  try {
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({ url, token });
    return _redis;
  } catch (err) {
    warn(`[speculation] Redis import failed: ${err.message}`);
    _redis = null;
    return null;
  }
}

// ── File loaders ──

async function loadJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (err) {
    warn(`[speculation] read ${filePath} failed: ${err.message}`);
    return fallback;
  }
}

async function loadResolvedEvents() {
  const data = await loadJson(RESOLVED_EVENTS_PATH, { events: [] });
  return Array.isArray(data?.events) ? data.events : [];
}

async function loadTeams() {
  const config = await loadJson(TEAMS_CONFIG_PATH, { teams: [] });
  const map = new Map();
  for (const t of config.teams ?? []) {
    map.set(t.franchiseId, {
      name: t.name,
      nameMedium: t.nameMedium ?? t.name,
      nameShort: t.nameShort ?? t.nameMedium ?? t.name,
      abbrev: t.abbrev,
      division: t.division,
    });
  }
  return map;
}

function detectCurrentSeason(now = new Date()) {
  // Mirrors scripts/fetch-trade-bait.mjs season-detection logic so we read
  // the same year's feeds.
  const calendarYear = now.getFullYear();
  const febCutoff = new Date(calendarYear, 1, 14, 16, 45, 0, 0);
  return now >= febCutoff ? calendarYear : calendarYear - 1;
}

async function loadEnrichedSalaries(year) {
  const file = path.join(projectRoot, 'src', 'data', 'theleague', `mfl-player-salaries-${year}.json`);
  const data = await loadJson(file, { players: [] });
  const playersByFranchise = new Map();
  for (const p of data.players ?? []) {
    if (!p.franchiseId) continue;
    const arr = playersByFranchise.get(p.franchiseId) ?? [];
    arr.push({
      id: String(p.id),
      name: p.name,
      position: p.position,
      salary: Number(p.salary) || 0,
      contractYear: p.contractYear,
      status: p.status,
      age: p.sleeper?.age ?? null,
      team: p.team,
    });
    playersByFranchise.set(p.franchiseId, arr);
  }
  return playersByFranchise;
}

async function loadAdpRanks(year) {
  const file = path.join(projectRoot, 'data', 'theleague', 'mfl-feeds', String(year), 'adp-dynasty.json');
  const data = await loadJson(file, { adp: { player: [] } });
  const arr = Array.isArray(data?.adp?.player) ? data.adp.player : [];
  const map = new Map();
  for (const row of arr) {
    if (!row?.id) continue;
    const rank = parseInt(row.rank, 10);
    if (Number.isFinite(rank)) map.set(String(row.id), rank);
  }
  return map;
}

async function loadTradeBaitByFranchise(year) {
  const file = path.join(projectRoot, 'data', 'theleague', 'mfl-feeds', String(year), 'tradeBait-by-franchise.json');
  const data = await loadJson(file, null);
  if (!data?.franchises) return null;
  const map = new Map();
  for (const [fid, entry] of Object.entries(data.franchises)) {
    map.set(fid, Array.isArray(entry.playerIds) ? entry.playerIds.map(String) : []);
  }
  return map;
}

async function loadFeed() {
  return loadJson(FEED_PATH, { lastScanTimestamp: '', lastProcessedMflTimestamp: '0', posts: [] });
}

// ── Schefter blurb generation ──

const TIER_EMOJI = '🟡';

// Local-media / fan-chatter framing — the speculation does NOT come from
// owners or front-office sources. It comes from beat writers, talk-radio
// callers, fan blogs, and barstool chatter speculating about whether a
// hypothetical move makes sense. Schefter is REPORTING on that buzz.
function templateBlurb({ marquee, returnPkg, sellerName, buyerName, capRelief }) {
  const pkgStr = returnPkg.map((p) => p.name).join(' and ');
  const lines = [
    `${TIER_EMOJI} The talk-radio crowd in ${buyerName}-country has been chewing on a fit for ${sellerName} ${marquee.position} ${marquee.name}.`,
    `Local fan boards are floating ${pkgStr} as the kind of return ${sellerName} would have to take seriously — neither front office has commented.`,
  ];
  if (capRelief) {
    lines.push(`${sellerName} would clear meaningful cap room in any version of this deal, which is half the reason the speculation has legs.`);
  }
  return lines.join(' ');
}

async function generateBlurbWithClaude({ marquee, returnPkg, sellerName, buyerName, capRelief }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || DRY_RUN) {
    return null;
  }

  const system = `You are Claude Schefter — a dynasty fantasy football beat reporter channeling Adam Schefter's voice.
You are writing a SPECULATION post about a hypothetical two-team trade. The trade is NOT real — it has NOT been offered. It is fan/media chatter generated from publicly-listed trade-bait + roster fits + cap math.

CRITICAL FRAMING (self-enforce):
- The speculation comes from LOCAL MEDIA and FANS, not from the front offices or owners. Frame the post as Schefter REPORTING on what fans / talk radio / beat writers / fan blogs / barstool chatter are kicking around — not as Schefter relaying a leak from team sources.
- Use phrases like: "the talk-radio crowd in [team]-country", "fan boards are floating", "local beat writers have been speculating", "the [team] fan base has been kicking around", "a Wednesday night call-in show floated", "barstool chatter from [team] country", "season-ticket holders have been wondering aloud".
- NEVER imply either GM, owner, or front office is shopping or pursuing. Do NOT use phrases like "sources tell me [team] is shopping/circling/in talks". The story is the BUZZ around the move, not the move itself. Both front offices in the post should be framed as silent, surprised, or non-committal ("neither front office has commented", "[team] hasn't acknowledged", "this isn't coming from the building — it's coming from outside it").

HARD RULES (self-enforce):
- 1–3 sentences total. Tight, beat-reporter cadence.
- Lead with the marquee piece moving from seller → buyer in the fan/media speculation. Use the franchise nameMedium values exactly as given.
- Do NOT invent any player names beyond the marquee + return-package list. If a name isn't in the input, it doesn't exist.
- Do NOT name the dollar amount of any salary; you may say "the cap fit makes sense" or "cap relief" only when the input flag says so.
- No emojis (the post is prefixed with a tier emoji separately).
- No hashtags, no @-mentions, no meta-commentary about the speculation engine, no markdown.
- OUTPUT CONTRACT: respond with JSON only — {"post": "<the speculation copy as a single string>"}.`;

  const userMessage = `Generate a fan/media speculation post for the following candidate trade. Remember: this is NOT a leak from the teams — it's chatter from outside the buildings.

INPUT:
${JSON.stringify(
  {
    seller: sellerName,
    buyer: buyerName,
    marquee: { name: marquee.name, position: marquee.position, age: marquee.age ?? null, onTradeBait: marquee.onTradeBait },
    returnPackage: returnPkg.map((p) => ({ name: p.name, position: p.position, age: p.age ?? null })),
    capReliefAngle: capRelief,
  },
  null,
  2,
)}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 260,
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    if (!res.ok) {
      warn(`[speculation AI] HTTP ${res.status} — using template`);
      return null;
    }
    const data = await res.json();
    const text = (data.content?.[0]?.text ?? '').trim();
    return parseAiResponse(text);
  } catch (err) {
    warn(`[speculation AI] ${err.message} — using template`);
    return null;
  }
}

function parseAiResponse(raw) {
  try {
    // Tolerate code fences / surrounding prose
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const obj = JSON.parse(match[0]);
    const post = typeof obj.post === 'string' ? obj.post.trim() : null;
    if (!post) return null;
    // Sanity guard: reject any output that contains markdown or meta-commentary
    if (/^\s*here\b|\bspeculation engine\b/i.test(post)) return null;
    return post;
  } catch {
    return null;
  }
}

// ── Post id ──

function generatePostId() {
  const hash = createHash('sha256').update(`${Date.now()}${Math.random()}`).digest('hex').slice(0, 8);
  return `sf_speculation_${Date.now()}_${hash}`;
}

// ── Main ──

async function main() {
  log(`\n=== Schefter Trade Speculation ${DRY_RUN ? '[DRY RUN]' : ''} ===`);
  const now = new Date();
  log(`  Timestamp: ${now.toISOString()}`);

  // Enable gate (defaults to OFF in production unless explicitly enabled —
  // mirrors how the rumor-mill rolled out).
  const enabled = process.env.SCHEFTER_TRADE_SPECULATION_ENABLED;
  if (!enabled || enabled === '0' || String(enabled).toLowerCase() === 'false') {
    log('  SCHEFTER_TRADE_SPECULATION_ENABLED is not truthy — exiting');
    return 0;
  }

  if (isQuietHours(now)) {
    log(`  Quiet hours (PT ${getPtHour(now)}:00) — exiting`);
    return 0;
  }

  // 1. Resolve calendar cadence.
  const events = await loadResolvedEvents();
  const cadence = resolveCadence({ events, now });
  log(`  Cadence: ${cadence.tag} (maxPerDay=${cadence.maxPerDay}, reservesGlobalSlot=${cadence.reservesGlobalSlot})`);
  if (cadence.maxPerDay === 0) {
    log('  Cadence quota = 0 — exiting');
    return 0;
  }

  // 2. Lane permission check (against the local rotation ledger).
  const ledgerPath = defaultLedgerPath(projectRoot);
  const ledger = await loadLedger(ledgerPath);
  const laneToday = ledgerPostsToday(ledger, now);
  const laneLast = ledgerLastPostAt(ledger);
  const lanePermit = permitsPost({ cadence, postsTodayInLane: laneToday, lastPostAt: laneLast, now });
  if (!lanePermit.allowed) {
    log(`  Lane gate blocked: ${lanePermit.reason} — exiting`);
    return 0;
  }

  // 3. Global daily-budget check — share the rumor-mill's `posts_today`
  // counter so all Schefter-voiced posts (rumors + speculation) honor a
  // single 3-per-day cap on the feed.
  const redis = await getRedis();
  let globalPostsToday = 0;
  if (redis) {
    const raw = await redis.get(RUMOR_POSTS_TODAY_KEY);
    globalPostsToday = typeof raw === 'number' ? raw : parseInt(raw ?? '0', 10) || 0;
  }
  const effectiveCap = MAX_GLOBAL_POSTS_PER_DAY - (cadence.reservesGlobalSlot ? 0 : 0);
  if (globalPostsToday >= MAX_GLOBAL_POSTS_PER_DAY) {
    if (!cadence.reservesGlobalSlot) {
      log(`  Global cap met (posts_today=${globalPostsToday}, cap=${MAX_GLOBAL_POSTS_PER_DAY}) — exiting`);
      return 0;
    }
    // Peak-week speculation may exceed the soft cap by RESERVED_PEAK_SLOT.
    if (globalPostsToday >= MAX_GLOBAL_POSTS_PER_DAY + RESERVED_PEAK_SLOT) {
      log(`  Even with peak-week reservation, cap met (posts_today=${globalPostsToday}) — exiting`);
      return 0;
    }
    log(`  Global cap normally met but peak-week reservation in effect — proceeding`);
  } else {
    log(`  Global posts_today=${globalPostsToday} (cap=${MAX_GLOBAL_POSTS_PER_DAY}); effectiveCap=${effectiveCap}`);
  }

  // 4. Load league state.
  const season = detectCurrentSeason(now);
  const teams = await loadTeams();
  const playersByFranchise = await loadEnrichedSalaries(season);
  const adpRankById = await loadAdpRanks(season);
  const tradeBaitByFranchise = await loadTradeBaitByFranchise(season);

  if (!tradeBaitByFranchise || tradeBaitByFranchise.size === 0) {
    log('  No tradeBait-by-franchise.json (run scripts/fetch-trade-bait.mjs first) — exiting');
    return 0;
  }
  if (playersByFranchise.size === 0) {
    log('  Enriched salary feed empty — exiting');
    return 0;
  }

  // 5. Find candidates.
  const rawCandidates = findTwoTeamCandidates({
    playersByFranchise,
    tradeBaitByFranchise,
    adpRankById,
    teams,
    limit: 10,
  });
  log(`  Raw candidate pool: ${rawCandidates.length}`);
  if (rawCandidates.length === 0) {
    log('  No candidates found — exiting');
    return 0;
  }

  // 6. Apply rotation gate.
  const passing = [];
  for (const c of rawCandidates) {
    const sig = tradeSignature({
      seller: c.seller,
      buyer: c.buyer,
      marqueeId: c.marquee.id,
      returnPkgIds: c.returnPkg.map((p) => p.id),
    });
    if (recentlyPostedTrade(ledger, sig, now)) continue;
    if (
      franchiseInRecentRotation(ledger, c.seller, now) &&
      franchiseInRecentRotation(ledger, c.buyer, now)
    ) {
      // Both already featured in the last 7 days — skip to spread coverage.
      continue;
    }
    passing.push({ ...c, signature: sig });
  }
  log(`  After rotation gate: ${passing.length}`);
  if (passing.length === 0) {
    log('  All candidates are in the rotation cooldown — exiting');
    return 0;
  }

  const winner = passing[0];
  const sellerTeam = teams.get(winner.seller);
  const buyerTeam = teams.get(winner.buyer);
  log(`  Winner (score=${winner.score}): ${sellerTeam?.nameMedium ?? winner.seller} → ${buyerTeam?.nameMedium ?? winner.buyer}: ${winner.marquee.name}`);

  // 7. Generate blurb (Claude + template fallback).
  const blurbInput = {
    marquee: winner.marquee,
    returnPkg: winner.returnPkg,
    sellerName: sellerTeam?.nameMedium ?? `Franchise ${winner.seller}`,
    buyerName: buyerTeam?.nameMedium ?? `Franchise ${winner.buyer}`,
    capRelief: winner.capRelief,
  };
  let body = await generateBlurbWithClaude(blurbInput);
  if (!body) body = templateBlurb(blurbInput);
  // Tier emoji prefix is the visual spine — match the format from the plan doc.
  const post = {
    id: generatePostId(),
    timestamp: now.toISOString(),
    type: 'rumor',
    transactionSubType: SPECULATION_SUB_TYPE,
    tier: SPECULATION_TIER_TWO_TEAM,
    headline: 'Schefter speculating…',
    body: body.startsWith(TIER_EMOJI) ? body : `${TIER_EMOJI} ${body}`,
    authorId: 'claude',
    franchiseIds: [winner.seller, winner.buyer],
    league: LEAGUE_SLUG,
    speculation: {
      seller: winner.seller,
      buyer: winner.buyer,
      marquee: { id: winner.marquee.id, name: winner.marquee.name, position: winner.marquee.position },
      returnPkg: winner.returnPkg.map((p) => ({ id: p.id, name: p.name, position: p.position })),
      score: winner.score,
      capRelief: winner.capRelief,
    },
  };

  if (DRY_RUN) {
    log('\n  [dry-run] Would append to feed:');
    log(JSON.stringify(post, null, 2));
    log('\n  [dry-run] Would append to speculation history:', winner.signature);
    return 0;
  }

  // 8. Persist feed + ledger.
  const feed = await loadFeed();
  feed.posts = [post, ...(feed.posts ?? [])];
  feed.lastScanTimestamp = now.toISOString();
  await fs.writeFile(FEED_PATH, JSON.stringify(feed, null, 2) + '\n');
  log('  Appended to schefter-feed.json');

  const updatedLedger = appendEntry(ledger, {
    postedAt: now.getTime(),
    postId: post.id,
    signature: winner.signature,
    franchiseIds: [winner.seller, winner.buyer],
    cadenceTag: cadence.tag,
  });
  await saveLedger(ledgerPath, updatedLedger, { now });
  log('  Appended to speculation-history.json');

  // 9. Increment shared global counter (so rumor-mill respects this slot).
  if (redis) {
    try {
      const newCount = await redis.incr(RUMOR_POSTS_TODAY_KEY);
      if (newCount === 1) {
        await redis.expire(RUMOR_POSTS_TODAY_KEY, secondsUntilPtMidnight(now));
      }
      await redis.set(RUMOR_LAST_POST_TS_KEY, now.getTime());
      await redis.expire(RUMOR_LAST_POST_TS_KEY, secondsUntilPtMidnight(now));
      log(`  posts_today incremented → ${newCount}`);
    } catch (err) {
      warn(`  [speculation] Redis counter update failed: ${err.message}`);
    }
  }

  return 0;
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
