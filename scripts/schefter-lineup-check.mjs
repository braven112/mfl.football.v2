#!/usr/bin/env node

/**
 * Schefter pre-kickoff lineup check — runs ahead of EVERY kickoff slot.
 *
 * Scans every franchise's submitted starting lineup in each lineup-playing
 * league (registry leagues without `bestBall: true`) and flags teams starting
 * players who cannot play — OUT, on IR, suspended, retired, holding out, or on
 * bye — plus teams with empty starting slots or no submitted lineup at all. If
 * every lineup in a league is clean, that league hears nothing — silence is the
 * good outcome.
 *
 * DELIVERY IS PUSH-FIRST (Sep 2026). Every flagged owner gets a private web
 * push about their own lineup. The GroupMe post is now a FALLBACK that carries
 * the warning only for the owners push did not reach, @-mentions them, and
 * links them to /<league>/notifications — see scripts/lib/reminder-fallback.mjs
 * for why it is shaped that way. Every owner reached by push means one fewer
 * name in the chat, and a league that has all subscribed gets no post at all.
 * The safety property that makes this acceptable on a deadline-critical alert:
 * a push that could not run reports EVERYONE unreached, so the chat still gets
 * the full broadcast it always did.
 *
 * Flagging logic is pure and unit-tested in scripts/lib/lineup-warnings.mjs
 * (tests/lineup-warnings.test.ts); this script owns all I/O.
 *
 * Usage:
 *   node scripts/schefter-lineup-check.mjs                 # all lineup leagues
 *   node scripts/schefter-lineup-check.mjs --league theleague
 *   node scripts/schefter-lineup-check.mjs --dry-run       # print, no Redis/GroupMe
 *   node scripts/schefter-lineup-check.mjs --week 7        # override NFL week
 *
 * Env:
 *   ANTHROPIC_API_KEY            optional — Schefter-voice intro; template
 *                                fallback when unset (dry runs still work)
 *   GROUPME_SCHEFTER_BOT_ID      TheLeague Schefter bot (absent = print only)
 *   GROUPME_AFL_SCHEFTER_BOT_ID  AFL Schefter bot (absent = print only)
 *   CRON_SECRET                  push fan-out. Absent = nobody is reachable by
 *                                push, so the chat fallback names everyone.
 *   GROUPME_SERVICE_TOKEN        resolves the group's member list so unreached
 *                                owners can be @-mentioned. Absent = they are
 *                                named in plain text instead.
 *   UPSTASH_REDIS_REST_URL/_TOKEN (or KV_/STORAGE_ pairs) — per-week
 *                                alerted set, shared GroupMe daily budget, and
 *                                the franchise↔GroupMe owner map. Absent = no
 *                                dedup (warn; every run re-alerts every still-
 *                                fixable problem) and no @-mentions.
 *
 * Scheduling: .github/workflows/lineup-reminders.yml, dispatched ONLY by the
 * Vercel cron bridge src/pages/api/cron/lineup-check.ts, ~75 minutes ahead of
 * every distinct kickoff in the NFL schedule (Thursday, a London morning game,
 * the Sunday slates, SNF, MNF). It used to be one GitHub schedule at Sunday
 * 9:15am PT, which GitHub delivered after noon three Sundays running.
 *
 * Because it now runs several times a week, two rules keep it honest:
 *  - LOCKED PLAYERS ARE DROPPED SILENTLY. A starter whose game has kicked off
 *    cannot be swapped, so naming him helps nobody (dropLockedProblems).
 *  - EACH PROBLEM IS ALERTED ONCE PER WEEK. A per-week Redis set records what
 *    was delivered; later runs only carry what is new — a late inactive, a
 *    status change (filterUnalerted). A problem is marked only once a channel
 *    actually carried it, so a held chat post is retried by the next run.
 *
 * Quiet hours (11pm–7am PT) still hold the chat post, EXCEPT for a warning
 * whose own deadline falls inside them — a 6:30am PT London game cannot wait
 * for 7am. Push is never held.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { getSchefterLeague } from './lib/schefter-leagues.mjs';
import { schefterKey } from './lib/schefter-keys.mjs';
import { getRedisConfig } from './lib/redis.mjs';
import { createUpstashClient } from './lib/redis-client.mjs';
import { postToGroupMe } from './lib/groupme.mjs';
import { postToGroupMeCapped } from './lib/groupme-capped.mjs';
import { sendPushFanout } from './lib/push-fanout.mjs';
import { resolveFranchiseMentions } from './lib/groupme-mentions.mjs';
import { buildFallbackPost } from './lib/reminder-fallback.mjs';
import { buildAssistantPost, publishAssistantPosts } from './lib/schefter-assistant-post.mjs';
import { fetchWithRetry } from './lib/fetch-retry.mjs';
import { isSeasonWindowOpen } from '../src/utils/pecking-order-season-window.mjs';
import { isQuietHours, consumeDailyPost } from './lib/schefter-groupme-budget.mjs';
import {
  buildLineupWarnings,
  buildPlayerIndex,
  fallbackIntro,
  formatWarningLine,
  parseByeTeams,
  parseFranchiseNames,
  parseInjuries,
  parseRequiredStarters,
  parseStartingLineups,
  parseKickoffsByTeam,
  dropLockedProblems,
  filterUnalerted,
  warningAlertKeys,
  warningDeadline,
} from './lib/lineup-warnings.mjs';
import { leagueYearFor } from './lib/schefter-league-year.mjs';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), '..');

// ── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const leagueArgIdx = args.indexOf('--league');
const LEAGUE_FILTER = leagueArgIdx !== -1 ? args[leagueArgIdx + 1] : null;
// Fail-safe: `--league` with a missing value must error out, never silently
// widen the run to every league.
if (leagueArgIdx !== -1 && (!LEAGUE_FILTER || LEAGUE_FILTER.startsWith('--'))) {
  console.error('--league requires a value (e.g. --league theleague)');
  process.exit(1);
}
const weekArgIdx = args.indexOf('--week');
const WEEK_OVERRIDE = weekArgIdx !== -1 ? parseInt(args[weekArgIdx + 1], 10) : null;

const log = (...a) => console.log(...a);
const warn = (...a) => console.warn(...a);

// ── Year + season gates ─────────────────────────────────────────────────────

// leagueYearFor lives in scripts/lib/schefter-league-year.mjs (shared with the
// trade-bait lane); re-exported below so existing importers keep working.

/**
 * Lineup warnings only make sense while NFL games are being played. The
 * cron already only fires Sep–Jan; this guard makes an off-season
 * workflow_dispatch a clean no-op instead of posting about Week 1 in July.
 */
function isInSeason(now = new Date()) {
  // Anchored to the actual opener, not the calendar month. A month check
  // (`month >= 9`) calls September 1st "in season", but week 1 kicks off the
  // Thursday AFTER Labor Day — up to nine days later. On 2026-09-06, a Sunday
  // four days before the opener, that gap posted a lineup warning naming every
  // team that had not yet set a week 1 lineup: 4 of 16 in TheLeague and 17 of
  // 24 in the AFL, for a week nobody could have set a lineup for. There is
  // always at least one such Sunday, and in some years two.
  //
  // isSeasonWindowOpen is the repo's designated season gate for exactly this
  // reason. Asking it about both candidate years rather than deriving a base
  // year keeps January correct without re-porting the rollover pivot — see
  // the same note on isChatBusySeason in schefter-scan.mjs.
  const year = now.getUTCFullYear();
  return isSeasonWindowOpen(year, now) || isSeasonWindowOpen(year - 1, now);
}

// ── Fetch + feed helpers ────────────────────────────────────────────────────

const MFL_API_HOST = 'api.myfantasyleague.com';

async function fetchJson(url, label) {
  return fetchWithRetry(url, {
    attempts: 3,
    baseDelayMs: 1500,
    fetchOptions: { headers: { 'User-Agent': 'schefter-lineup-check/1.0' } },
    formatHttpError: (res) => `${label}: HTTP ${res.status}`,
    onRetry: (err, attempt) => warn(`  [fetch] ${label} attempt ${attempt + 1} failed: ${err.message} — retrying`),
  });
}

/** Read a committed mfl-feeds file, falling back to a live MFL fetch. */
async function readFeedOrFetch(league, year, filename, liveUrl, label) {
  const feedPath = path.join(root, league.dataPath, 'mfl-feeds', String(year), filename);
  try {
    return JSON.parse(fs.readFileSync(feedPath, 'utf8'));
  } catch {
    warn(`  [feed] ${feedPath} unavailable — fetching live (${label})`);
    return fetchJson(liveUrl, label);
  }
}

// ── Schefter voice ──────────────────────────────────────────────────────────

/** First ~1200 chars of the league's persona file, or '' when missing. */
function readPersonaExcerpt(navSlug) {
  const personaPath = path.join(root, 'data', 'schefter', navSlug, 'personality.md');
  try {
    return fs.readFileSync(personaPath, 'utf8').slice(0, 1200);
  } catch {
    warn(`  [voice] ${personaPath} missing — using generic Schefter register`);
    return '';
  }
}

/**
 * Generate the 1–2 sentence Schefter-voice intro. Pattern follows
 * generateQuietDayBody in scripts/schefter-rumor-scan.mjs: a small dedicated
 * system prompt with a deterministic template fallback when
 * ANTHROPIC_API_KEY is unset, so dry runs still produce recognizable output.
 *
 * The LLM writes ONLY the intro — the team-by-team problem list is appended
 * deterministically by composePost, so player/team facts can never be
 * hallucinated into the post.
 */
async function generateLineupWarningIntro({ leagueName, week, teamCount, personaExcerpt }) {
  const fallback = fallbackIntro({ week, teamCount });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    warn('  [voice] ANTHROPIC_API_KEY not set — using template intro');
    return fallback;
  }

  const persona = personaExcerpt
    ? `\n\nPERSONA NOTES (voice reference only — never quote them):\n${personaExcerpt}`
    : '';

  const system = `You are Claude Schefter — ${leagueName}'s AI beat reporter. It is shortly before an NFL kickoff. You are filing a pre-kickoff LINEUP WARNING to the league's GroupMe: some owners are starting players who are OUT, on IR, suspended, or on bye — or left starting slots empty.

Your output is ONLY the short intro line. A factual team-by-team list is appended after your intro by the system — do not write the list yourself.

HARD RULES (all of them, every time):
- ONE or TWO short sentences. Punchy, urgent, wire-report energy.
- Do NOT name any franchise, owner, or player — the appended list has the facts.
- Do NOT invent details, counts beyond what you're given, or fake sourcing about specific teams. Generic beat-reporter framing ("sources", "my desk") is your bit and is fine.
- The message: fix your lineup before kickoff. Nudge action.
- Output JSON ONLY: {"intro": "<the intro as a single string>"}. No meta-commentary.${persona}`;

  const userMessage = `File the intro. Context: Week ${week}, ${teamCount} team(s) flagged. Output JSON only.`;

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
        max_tokens: 150,
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      warn(`  [voice] anthropic ${res.status}: ${t.slice(0, 200)} — falling back to template`);
      return fallback;
    }
    const data = await res.json();
    const text = data?.content?.[0]?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (typeof parsed?.intro === 'string' && parsed.intro.trim().length > 0) {
        return parsed.intro.trim();
      }
    }
    warn('  [voice] unusable response — falling back to template');
    return fallback;
  } catch (err) {
    warn(`  [voice] generation failed: ${err.message} — falling back to template`);
    return fallback;
  }
}

// ── Redis (optional — per-week alerted set + shared GroupMe budget) ─────────

let redisMemo;
async function getRedis() {
  if (redisMemo !== undefined) return redisMemo;
  const config = getRedisConfig();
  if (!config) {
    redisMemo = null;
    return null;
  }
  try {
    redisMemo = await createUpstashClient(config);
  } catch (err) {
    warn(`  [redis] client init failed: ${err.message}`);
    redisMemo = null;
  }
  return redisMemo;
}

const ALERTED_TTL_SECONDS = 10 * 24 * 3600; // outlives its week, then self-cleans

// ── Per-league check ────────────────────────────────────────────────────────

/**
 * @returns {'posted' | 'clean' | 'skipped'}
 */
async function checkLeague(league, now = new Date()) {
  log(`\n=== ${league.name} (${league.slug}) ===`);

  const year = leagueYearFor(league, now);

  // Per-league Schefter config (GroupMe bot, and the feed path the assistant
  // post is written to). Leagues in the registry but not yet in
  // SCHEFTER_LEAGUES run bot-less (print-only) and write no feed post.
  let botId;
  // Also the object that owns absolute-URL building and the GroupMe group
  // lookup — its `slug` IS the navSlug, which is the scope both the mention
  // keys and the group-id cache are written under.
  let schefterLeague = null;
  try {
    schefterLeague = getSchefterLeague(league.slug);
    botId = schefterLeague.groupMeSchefterBotId;
  } catch {
    warn(`  [config] ${league.slug} has no Schefter league config — no GroupMe bot`);
  }

  // Resolve the current NFL week (MFL's own clock, not local math), and that
  // week's kickoffs — what decides which starters are already locked.
  let week = WEEK_OVERRIDE;
  let weekScheduleJson = null;
  if (!week) {
    weekScheduleJson = await fetchJson(
      `https://${MFL_API_HOST}/${year}/export?TYPE=nflSchedule&JSON=1`,
      'nflSchedule',
    );
    week = parseInt(weekScheduleJson?.nflSchedule?.week, 10);
  }
  if (!Number.isFinite(week) || week < 1 || week > 18) {
    log(`  [skip] no valid regular-season NFL week (got ${week})`);
    return 'skipped';
  }
  if (!weekScheduleJson) {
    weekScheduleJson = await fetchJson(
      `https://${MFL_API_HOST}/${year}/export?TYPE=nflSchedule&W=${week}&JSON=1`,
      'nflSchedule week',
    );
  }
  let kickoffsByTeam = parseKickoffsByTeam(weekScheduleJson);
  // This run was dispatched AHEAD of a kickoff. If every game in MFL's
  // "current" week is already behind us, MFL has not moved its week pointer
  // yet (a Thursday opener) — the kickoff we are racing is next week's.
  // Without this, every starter would read as locked and the run would go
  // silent before exactly the game it was dispatched for.
  const nowMs = now.getTime();
  if (!WEEK_OVERRIDE && week < 18 && kickoffsByTeam.size > 0 &&
      ![...kickoffsByTeam.values()].some((at) => at > nowMs)) {
    week += 1;
    log(`  [week] every MFL-current-week game has kicked off — checking Week ${week}`);
    weekScheduleJson = await fetchJson(
      `https://${MFL_API_HOST}/${year}/export?TYPE=nflSchedule&W=${week}&JSON=1`,
      'nflSchedule next week',
    );
    kickoffsByTeam = parseKickoffsByTeam(weekScheduleJson);
  }
  if (kickoffsByTeam.size === 0) {
    // Fail toward warning: without kickoffs nothing is treated as locked,
    // which is the old behavior, never a silenced league.
    warn('  [schedule] no kickoffs for this week — cannot drop locked players');
  }
  log(`  Year ${year}, NFL Week ${week}`);

  // Per-week record of what has already been alerted (skipped in dry-run:
  // posting is the mutation, and a preview should show the full picture).
  // Scoped by league year AND week so a new week starts clean.
  const alertedKey = schefterKey(league.navSlug, `lineup_check:alerted:${year}:w${week}`);
  let redis = null;
  let alerted = new Set();
  if (!DRY_RUN) {
    redis = await getRedis();
    if (redis) {
      const raw = await redis.get(alertedKey).catch(() => null);
      try {
        const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(list)) alerted = new Set(list.map(String));
      } catch {
        warn('  [redis] unreadable alerted set — treating as empty');
      }
    } else {
      warn('  [redis] unavailable — per-week dedup inactive, every run re-alerts');
    }
  }

  // ── Data: live lineups + statuses, committed feeds for names/config ──────
  const weeklyResults = await fetchJson(
    `https://${league.mflHost}/${year}/export?TYPE=weeklyResults&L=${league.id}&W=${week}&JSON=1`,
    'weeklyResults',
  );
  const lineups = parseStartingLineups(weeklyResults);
  if (lineups.length === 0) {
    log('  [skip] weeklyResults returned no franchise lineups');
    return 'skipped';
  }

  const [injuriesJson, byeWeeksJson, playersJson, leagueJson] = await Promise.all([
    // Injuries + byes are NFL-wide (league-independent) — always fetch live
    // so Sunday-morning statuses are current, not last commit's.
    fetchJson(`https://${MFL_API_HOST}/${year}/export?TYPE=injuries&JSON=1`, 'injuries'),
    fetchJson(`https://${MFL_API_HOST}/${year}/export?TYPE=nflByeWeeks&JSON=1`, 'nflByeWeeks'),
    // Names/positions and franchise names change rarely — committed feeds
    // are fine and save two large fetches; live fallback if missing.
    readFeedOrFetch(
      league, year, 'players.json',
      `https://${league.mflHost}/${year}/export?TYPE=players&L=${league.id}&JSON=1`,
      'players',
    ),
    readFeedOrFetch(
      league, year, 'league.json',
      `https://${league.mflHost}/${year}/export?TYPE=league&L=${league.id}&JSON=1`,
      'league',
    ),
  ]);

  const allWarnings = buildLineupWarnings({
    lineups,
    players: buildPlayerIndex(playersJson),
    injuries: parseInjuries(injuriesJson),
    byeTeams: parseByeTeams(byeWeeksJson, week),
    franchiseNames: parseFranchiseNames(leagueJson),
    requiredStarters: parseRequiredStarters(leagueJson),
  });
  const actionable = dropLockedProblems(allWarnings, kickoffsByTeam, now);
  const warnings = filterUnalerted(actionable, alerted);

  if (warnings.length === 0) {
    log(
      `  ✅ Nothing new to alert — ${allWarnings.length} flagged, ` +
        `${allWarnings.length - actionable.length} locked by kickoff, ` +
        `${actionable.length} already alerted this week — no post`,
    );
    return 'clean';
  }

  log(`  ⚠️  ${warnings.length}/${lineups.length} franchises flagged`);
  for (const w of warnings) log(`     ${formatWarningLine(w)}`);

  // Marks the warnings a channel actually carried as alerted for the week.
  //
  // Only DELIVERED warnings: an owner reached by push is done; an unreached
  // owner is done only once the chat post lands. A chat post held for quiet
  // hours therefore leaves them unmarked, and the next kickoff's run tries
  // again — if their player is still unlocked by then.
  //
  // `consumedChatSlot` is load-bearing: the SHARED Schefter chat budget counts
  // chat posts, is spent by the rumor and speculation lanes too, and stamping
  // it also starts their 4-hour spacing hold. Burning a slot for a warning that
  // went out purely over push would silence a trade rumor for a post the chat
  // never saw.
  const recordDelivery = async ({ delivered, consumedChatSlot }) => {
    if (!redis) return;
    try {
      for (const w of delivered) for (const k of warningAlertKeys(w)) alerted.add(k);
      await redis.set(alertedKey, JSON.stringify([...alerted].sort()));
      await redis.expire(alertedKey, ALERTED_TTL_SECONDS);
      if (consumedChatSlot) await consumeDailyPost(redis, now, league.navSlug);
    } catch (err) {
      warn(`  [redis] failed to record delivery: ${err.message}`);
    }
  };

  // Which kickoff slot this run is ahead of — keeps one run's push and feed
  // post from replacing an earlier run's for the same owner in the same week.
  const upcoming = [...kickoffsByTeam.values()].filter((at) => at > now.getTime());
  const slot = upcoming.length ? Math.floor(Math.min(...upcoming) / 1000) : Math.floor(now.getTime() / 1000);

  // PUSH FIRST, AND TO EVERY FLAGGED OWNER. This is the real channel now: it
  // tells one owner about their own lineup, which is more useful and far less
  // public than a broadcast describing everyone's problems to everyone.
  const push = await sendPushFanout({
    league,
    dryRun: DRY_RUN,
    category: 'lineup-deadline',
    notifications: warnings.map((w) => ({
      franchiseId: w.franchiseId,
      title: w.noLineup ? 'No lineup submitted' : 'Check your lineup',
      body: formatWarningLine(w),
      url: '/lineup',
      // Per franchise and per kickoff slot: a re-run for the same slot
      // replaces, while a later slot's new problem does not erase this one.
      tag: `lineup-check-${w.franchiseId}-${slot}`,
    })),
    log: { log, warn },
  });

  // The same warning, left on the site, for EVERY flagged owner.
  //
  // Placed ahead of the push-fallback branch below on purpose: that branch
  // returns early once the fan-out reached everyone, which is the common case
  // now that reminders are push-first. Writing the feed post after it would
  // mean the better the push works, the fewer owners get a durable copy — the
  // feed would quietly stop filling exactly when the system is healthiest.
  //
  // A push is gone the moment it is dismissed; this is the copy an owner can
  // come back to, and it is what their For You feed shows. Scoped to their
  // franchise, so it reaches nobody else. Deliberately NOT another push:
  // `lineup-deadline` already fired above.
  if (schefterLeague) {
    const written = await publishAssistantPosts({
      league: schefterLeague,
      posts: warnings.map((w) =>
        buildAssistantPost({
          league: schefterLeague,
          franchiseId: w.franchiseId,
          // The slot keeps a later run's NEW problem from colliding with this
          // week's earlier post id (a duplicate id is silently not written).
          kind: `lineup-${slot}`,
          year,
          week,
          headline: w.noLineup ? 'No lineup submitted' : 'Check your lineup',
          body: formatWarningLine(w).replace(/^• /, ''),
          link: `/${schefterLeague.registrySlug}/lineup`,
          linkLabel: 'Set your lineup',
          playerIds: w.problems.map((p) => p.playerId).filter(Boolean),
          tier: w.noLineup ? 'breaking' : 'standard',
          now,
        }),
      ),
      dryRun: DRY_RUN,
      log: { log, warn },
    });
    if (written) log(`  [feed] wrote ${written} assistant post(s)`);
  }

  // ── The chat post is now a FALLBACK, not the broadcast ───────────────────
  // Only the flagged owners the push did not reach. Two things they get out of
  // one message: the warning itself, which they would otherwise never see, and
  // a public tag that stops the moment they turn notifications on. An owner
  // whose push landed is deliberately NOT named here — their problem is their
  // own business, and airing it after we already told them privately is the
  // noise this migration exists to remove.
  //
  // Note the failure direction: when push cannot run at all (no CRON_SECRET,
  // an outage, a dry run) the fan-out reports EVERYONE unreached, so this
  // composes the same full broadcast the chat has always received. A push
  // problem must never turn into a league that was not warned.
  const unreachedIds = new Set(push.undelivered ?? warnings.map((w) => w.franchiseId));
  const unreached = warnings.filter((w) => unreachedIds.has(w.franchiseId));
  const reached = warnings.filter((w) => !unreachedIds.has(w.franchiseId));

  if (unreached.length === 0) {
    log(`  ✅ All ${warnings.length} flagged owners reached by push — no chat post.`);
    // The push IS the delivery, so it marks the week's alerted set. Without
    // this the next slot's dispatch re-pushes an alert the owner already has.
    // No chat slot is spent: nothing posted.
    await recordDelivery({ delivered: reached, consumedChatSlot: false });
    return 'pushed';
  }
  log(`  ${unreached.length}/${warnings.length} flagged owners unreached by push — chat fallback`);

  // Overnight quiet window (11pm–7am PT) still holds the chat post, with ONE
  // exception: a warning whose own deadline falls INSIDE the quiet window — a
  // 6:30am PT London game. Holding that until 7am means posting after the
  // player is locked, which is the bug this lane was rebuilt to stop. During
  // quiet hours the post therefore carries only those urgent warnings; the
  // rest stay unmarked and ride the next kickoff slot's run, after 7am.
  const quiet = isQuietHours(now);
  const chatBatch = quiet
    ? unreached.filter((w) => {
        const deadline = warningDeadline(w, kickoffsByTeam, now);
        return deadline != null && isQuietHours(new Date(deadline));
      })
    : unreached;

  if (chatBatch.length === 0) {
    warn('  [groupme] quiet hours (11pm–7am PT), nothing kicks off inside them — holding post; push already sent');
    if (!DRY_RUN) await recordDelivery({ delivered: reached, consumedChatSlot: false });
    return 'skipped';
  }
  if (chatBatch.length < unreached.length) {
    log(`  [groupme] quiet hours — posting only the ${chatBatch.length} warning(s) whose game kicks off before 7am PT`);
  }

  const intro = await generateLineupWarningIntro({
    leagueName: league.name,
    week,
    teamCount: chatBatch.length,
    personaExcerpt: readPersonaExcerpt(league.navSlug),
  });

  // Resolved even in a dry run — the whole point of the preview is to see who
  // would actually be tagged, and a preview that silently drops the mentions
  // is how a wrong tag ships. `getRedis()` is the same lookup the day guard
  // does; it is null-safe and the resolver degrades to plain names.
  const mentions = await resolveFranchiseMentions({
    league: schefterLeague,
    redis: redis ?? (await getRedis()),
    log: { log, warn },
  });

  const post = buildFallbackPost({
    headline: intro,
    unreached: chatBatch.map((w) => ({
      franchiseId: w.franchiseId,
      name: w.franchiseName,
      detail: formatWarningLine(w).replace(/^•\s*/, '').replace(`${w.franchiseName}: `, ''),
    })),
    mentions,
    notificationsUrl: schefterLeague.url('/notifications'),
  });
  if (!post) return 'skipped';
  const { text, attachments } = post;

  if (DRY_RUN) {
    log(
      `  [dry-run] would post to GroupMe (${text.length} chars, ` +
        `${attachments.length > 0 ? attachments[0].user_ids.length : 0} mention(s)):\n---\n${text}\n---`,
    );
    return 'posted';
  }

  // EXEMPT from the daily cap, deliberately. This file's own note above calls
  // the warning "deadline-critical and useless after kickoff": an owner who
  // misses it starts an empty or illegal slot and loses real points. That is
  // the same harm the Roger deadline-reminder exemption exists to prevent, so
  // it gets the same treatment even though it is Schefter sending it.
  const result = await postToGroupMeCapped({
    league,
    kind: 'lineup-deadline',
    botId,
    text,
    attachments,
    checkStatus: true,
    onMissingBotId: () => warn(`  [groupme] no Schefter bot id for ${league.slug} — printing instead:\n---\n${text}\n---`),
    onPosted: () => log('  [groupme] posted ✔'),
    onHttpError: (status) => warn(`  [groupme] HTTP ${status} — post failed`),
    onFetchError: (err) => warn(`  [groupme] fetch failed: ${err.message}`),
  });

  if (!result.posted) {
    await recordDelivery({ delivered: reached, consumedChatSlot: false });
    return 'skipped';
  }

  await recordDelivery({ delivered: [...reached, ...chatBatch], consumedChatSlot: true });
  return 'posted';
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const now = new Date();
  log(`🏈 Schefter lineup check — ${now.toISOString()}${DRY_RUN ? ' (dry run)' : ''}`);

  if (!isInSeason(now) && !WEEK_OVERRIDE) {
    log('Outside the season window (week 1 kickoff → +20 weeks) — nothing to check.');
    return 0;
  }

  // Every lineup-playing league in the registry. Best-ball leagues are
  // draft-only (no lineups to warn about) — the registry flag is the gate.
  const leagues = ALL_LEAGUES.filter((l) => !l.bestBall).filter(
    (l) => !LEAGUE_FILTER || l.slug === LEAGUE_FILTER || l.navSlug === LEAGUE_FILTER,
  );
  if (leagues.length === 0) {
    warn(`No matching lineup-playing leagues${LEAGUE_FILTER ? ` for --league ${LEAGUE_FILTER}` : ''}`);
    return 1;
  }

  let failures = 0;
  for (const league of leagues) {
    try {
      await checkLeague(league, now);
    } catch (err) {
      failures += 1;
      console.error(`  ❌ ${league.slug} check failed:`, err.message);
    }
  }

  log(`\n=== Done${failures ? ` (${failures} league(s) failed)` : ''} ===`);
  return failures > 0 ? 1 : 0;
}

// Only run when invoked directly (same guard pattern as the schefter
// scanners) so vitest can import helpers without side effects.
const invokedDirectly = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('[lineup-check] Fatal:', err);
      process.exit(1);
    });
}

export { checkLeague, leagueYearFor, isInSeason, generateLineupWarningIntro };
