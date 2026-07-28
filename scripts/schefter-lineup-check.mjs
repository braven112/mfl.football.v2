#!/usr/bin/env node

/**
 * Schefter pre-kickoff lineup check — Sunday-morning GroupMe warnings.
 *
 * Scans every franchise's submitted starting lineup in each lineup-playing
 * league (registry leagues without `bestBall: true`) and posts ONE GroupMe
 * message per league flagging teams starting players who are OUT / on IR /
 * suspended / on bye, or with empty starting slots. If every lineup in a
 * league is clean, that league gets no post — silence is the good outcome.
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
 *   UPSTASH_REDIS_REST_URL/_TOKEN (or KV_/STORAGE_ pairs) — once-per-day
 *                                guard + shared GroupMe daily budget. Absent
 *                                = no guard (warn, still posts: the cron
 *                                runs once per Sunday).
 *
 * Scheduling: .github/workflows/lineup-reminders.yml — Sundays ~9:15am PT,
 * September through January, plus workflow_dispatch.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { getSchefterLeague } from './lib/schefter-leagues.mjs';
import { schefterKey } from './lib/schefter-keys.mjs';
import { getRedisConfig, createUpstashClient } from './lib/redis.mjs';
import { postToGroupMe } from './lib/groupme.mjs';
import { fetchWithRetry } from './lib/fetch-retry.mjs';
import { getPtDateString } from './lib/pt-date.mjs';
import { isQuietHours, consumeDailyPost } from './lib/schefter-groupme-budget.mjs';
import {
  buildLineupWarnings,
  buildPlayerIndex,
  composePost,
  fallbackIntro,
  formatWarningLine,
  parseByeTeams,
  parseFranchiseNames,
  parseInjuries,
  parseRequiredStarters,
  parseStartingLineups,
} from './lib/lineup-warnings.mjs';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), '..');

// ── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const leagueArgIdx = args.indexOf('--league');
const LEAGUE_FILTER = leagueArgIdx !== -1 ? args[leagueArgIdx + 1] : null;
const weekArgIdx = args.indexOf('--week');
const WEEK_OVERRIDE = weekArgIdx !== -1 ? parseInt(args[weekArgIdx + 1], 10) : null;

const log = (...a) => console.log(...a);
const warn = (...a) => console.warn(...a);

// ── Year + season gates ─────────────────────────────────────────────────────

/**
 * 4-digit MFL league year for a registry league. Mirrors the
 * getCurrentLeagueYear()/getAflLeagueYear() semantics from
 * src/utils/league-year.ts, driven by the registry's per-league
 * `leagueYearRollover` — same inline-mirror pattern as
 * scripts/schefter-rumor-scan.mjs#getSeasonYearForTipster (node .mjs can't
 * import the .ts module). Do NOT re-derive base-year math here — that's the
 * double-advance bug class CLAUDE.md documents.
 */
function leagueYearFor(league, now = new Date()) {
  const rollover = league.leagueYearRollover ?? { month: 2, day: 14 };
  const pt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const year = pt.getFullYear();
  const flipped =
    pt.getMonth() + 1 > rollover.month ||
    (pt.getMonth() + 1 === rollover.month && pt.getDate() >= rollover.day);
  return flipped ? year : year - 1;
}

/**
 * Lineup warnings only make sense while NFL games are being played. The
 * cron already only fires Sep–Jan; this guard makes an off-season
 * workflow_dispatch a clean no-op instead of posting about Week 1 in July.
 */
function isInSeason(now = new Date()) {
  const pt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const month = pt.getMonth() + 1;
  return month >= 9 || month === 1;
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

  const system = `You are Claude Schefter — ${leagueName}'s AI beat reporter. It is Sunday morning, shortly before NFL kickoff. You are filing a pre-kickoff LINEUP WARNING to the league's GroupMe: some owners are starting players who are OUT, on IR, suspended, or on bye — or left starting slots empty.

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

// ── Redis (optional — once-per-day guard + shared GroupMe budget) ───────────

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

const GUARD_TTL_SECONDS = 7 * 24 * 3600; // self-cleans; only today's value matters

// ── Per-league check ────────────────────────────────────────────────────────

/**
 * @returns {'posted' | 'clean' | 'skipped'}
 */
async function checkLeague(league, now = new Date()) {
  log(`\n=== ${league.name} (${league.slug}) ===`);

  const year = leagueYearFor(league, now);

  // Per-league Schefter config (GroupMe bot). Leagues added to the registry
  // but not yet to SCHEFTER_LEAGUES simply run bot-less (print-only).
  let botId;
  try {
    botId = getSchefterLeague(league.slug).groupMeSchefterBotId;
  } catch {
    warn(`  [config] ${league.slug} has no Schefter league config — no GroupMe bot`);
    botId = undefined;
  }

  // Resolve the current NFL week (MFL's own clock, not local math).
  let week = WEEK_OVERRIDE;
  if (!week) {
    const schedule = await fetchJson(
      `https://${MFL_API_HOST}/${year}/export?TYPE=nflSchedule&JSON=1`,
      'nflSchedule',
    );
    week = parseInt(schedule?.nflSchedule?.week, 10);
  }
  if (!Number.isFinite(week) || week < 1 || week > 18) {
    log(`  [skip] no valid regular-season NFL week (got ${week})`);
    return 'skipped';
  }
  log(`  Year ${year}, NFL Week ${week}`);

  // Once-per-PT-day guard (skipped in dry-run; posting is the mutation).
  const todayPt = getPtDateString(now);
  const guardKey = schefterKey(league.navSlug, 'lineup_check:last_post_date');
  let redis = null;
  if (!DRY_RUN) {
    redis = await getRedis();
    if (redis) {
      const lastPosted = await redis.get(guardKey).catch(() => null);
      if (lastPosted === todayPt) {
        log(`  [skip] already posted today (${todayPt})`);
        return 'skipped';
      }
    } else {
      warn('  [redis] unavailable — once-per-day guard inactive');
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

  const warnings = buildLineupWarnings({
    lineups,
    players: buildPlayerIndex(playersJson),
    injuries: parseInjuries(injuriesJson),
    byeTeams: parseByeTeams(byeWeeksJson, week),
    franchiseNames: parseFranchiseNames(leagueJson),
    requiredStarters: parseRequiredStarters(leagueJson),
  });

  if (warnings.length === 0) {
    log(`  ✅ All ${lineups.length} lineups clean — no post (silence is the good outcome)`);
    return 'clean';
  }

  log(`  ⚠️  ${warnings.length}/${lineups.length} franchises flagged`);
  for (const w of warnings) log(`     ${formatWarningLine(w)}`);

  // ── Compose + post ───────────────────────────────────────────────────────
  const intro = await generateLineupWarningIntro({
    leagueName: league.name,
    week,
    teamCount: warnings.length,
    personaExcerpt: readPersonaExcerpt(league.navSlug),
  });
  const text = composePost(intro, warnings.map(formatWarningLine));

  if (DRY_RUN) {
    log(`  [dry-run] would post to GroupMe (${text.length} chars):\n---\n${text}\n---`);
    return 'posted';
  }

  // Overnight quiet window still holds (a 3am manual dispatch shouldn't buzz
  // phones); the spacing + daily-cap gates deliberately do NOT — a lineup
  // warning is deadline-critical and useless after kickoff. We still consume
  // a shared daily budget slot below so the afternoon scanners see it.
  if (isQuietHours(now)) {
    warn('  [groupme] quiet hours (11pm–7am PT) — holding post');
    return 'skipped';
  }

  const result = await postToGroupMe({
    botId,
    text,
    checkStatus: true,
    onMissingBotId: () => warn(`  [groupme] no Schefter bot id for ${league.slug} — printing instead:\n---\n${text}\n---`),
    onPosted: () => log('  [groupme] posted ✔'),
    onHttpError: (status) => warn(`  [groupme] HTTP ${status} — post failed`),
    onFetchError: (err) => warn(`  [groupme] fetch failed: ${err.message}`),
  });

  if (!result.posted) return 'skipped';

  if (redis) {
    try {
      await redis.set(guardKey, todayPt);
      await redis.expire(guardKey, GUARD_TTL_SECONDS);
      await consumeDailyPost(redis, now, league.navSlug);
    } catch (err) {
      warn(`  [redis] failed to record post: ${err.message}`);
    }
  }
  return 'posted';
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const now = new Date();
  log(`🏈 Schefter lineup check — ${now.toISOString()}${DRY_RUN ? ' (dry run)' : ''}`);

  if (!isInSeason(now) && !WEEK_OVERRIDE) {
    log('Off-season (PT month outside Sep–Jan) — nothing to check.');
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
