#!/usr/bin/env node
/**
 * Backfill AFL Fantasy championship history (2003–present).
 *
 * Two modes:
 *
 *   --offline   (default)  Read whatever is on disk under
 *                          data/afl-fantasy/mfl-feeds/<year>/. Extracts the
 *                          champion + runner-up from playoff-brackets.json
 *                          when present, or from weekly-results.json
 *                          (filtering isPlayoff=1 in the championship week)
 *                          when present. Years with no usable cached data
 *                          are reported as gaps.
 *
 *   --online   Hits MFL's public export API to fill gaps. Uses the per-year
 *              host + leagueId map from data/afl-fantasy/year-host-map.json
 *              (AFL had a different host + league ID for every year 2003-2015
 *              before settling on www44/L=19621 in 2016).
 *
 * Output: data/afl-fantasy/championship-history.json
 *
 * The shape mirrors data/theleague/championship-history.json:
 *   { championships: [ { year, champion, runnerUp, championName, runnerUpName, source } ] }
 *
 * Champion = franchise with higher `points` in the final round of bracket "1".
 *
 * Pre-2020 caveat: MFL's playoffBracket export returns seeds only (no
 * franchise_id, no points) for those seasons. The script falls back to
 * weeklyResults for those years. The championship week is computed as
 * `startWeek + startWeekGames - 1` from the playoffBrackets metadata.
 *
 * Sanity check: The script verifies that each year's fetched playoff data
 * actually maps to AFL by cross-checking franchise IDs against
 * data/afl-fantasy/mfl-feeds/<year>/league.json (when available). Mismatches
 * (like the 2011 cache that was fetched with TheLeague year ID 48815) are
 * detected and reported.
 *
 * Usage:
 *   node scripts/backfill-afl-championship-history.mjs              # offline
 *   node scripts/backfill-afl-championship-history.mjs --online     # live MFL
 *   node scripts/backfill-afl-championship-history.mjs --year 2011  # one year
 *
 * Refs AFL_DUPLICATION_PLAN §6 Phase 2.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const FEEDS_DIR = path.join(ROOT, 'data/afl-fantasy/mfl-feeds');
const HOST_MAP_PATH = path.join(ROOT, 'data/afl-fantasy/year-host-map.json');
const OUTPUT_PATH = path.join(ROOT, 'data/afl-fantasy/championship-history.json');

const args = process.argv.slice(2);
const ONLINE = args.includes('--online');
const REBUILD_HOST_MAP = args.includes('--rebuild-host-map');
const yearArgIdx = args.indexOf('--year');
const SINGLE_YEAR = yearArgIdx >= 0 ? parseInt(args[yearArgIdx + 1], 10) : null;

const FIRST_YEAR = 2003;
// Last completed fantasy season. NFL fantasy seasons run Aug → Feb of the
// following calendar year, so the current-calendar-year season is never
// "complete" — always take the prior year.
const LAST_YEAR = new Date().getFullYear() - 1;

function log(msg) {
  console.log(`[backfill] ${msg}`);
}

function warn(msg) {
  console.warn(`[backfill] WARN: ${msg}`);
}

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const parseNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// --- Champion extraction from a playoff-brackets.json payload ------------------

function extractFromPlayoffBracket(playoffBrackets) {
  const bracketsList =
    playoffBrackets?.brackets || playoffBrackets?.playoffBrackets?.brackets;
  const champBracket = bracketsList?.['1']?.playoffBracket;
  if (!champBracket) return null;

  const rounds = toArray(champBracket.playoffRound);
  if (!rounds.length) return null;

  const finalRound = rounds[rounds.length - 1];
  const finalGame = toArray(finalRound.playoffGame)[0];
  if (!finalGame?.home || !finalGame?.away) return null;

  const homeId = finalGame.home.franchise_id;
  const awayId = finalGame.away.franchise_id;
  if (!homeId || !awayId) return null;

  const homePts = parseNum(finalGame.home.points);
  const awayPts = parseNum(finalGame.away.points);
  if (homePts === 0 && awayPts === 0) return null;

  const winner = homePts >= awayPts ? finalGame.home : finalGame.away;
  const loser = homePts >= awayPts ? finalGame.away : finalGame.home;

  return {
    champion: winner.franchise_id,
    runnerUp: loser.franchise_id,
    source: 'playoffBracket',
  };
}

function getChampionshipWeek(playoffBracketsMeta) {
  const meta = playoffBracketsMeta?.brackets?.['1'];
  if (!meta) return null;
  const startWeek = parseNum(meta.startWeek);
  const startWeekGames = parseNum(meta.startWeekGames);
  if (!startWeek) return null;
  // championship week = startWeek + (number of rounds - 1). number of rounds is
  // log2(startWeekGames * 2)-ish; since playoffBrackets meta exposes
  // `playoffRounds` for some leagues, but for AFL the bracket teams are 4 ->
  // 2 rounds, so champ week = startWeek + 1. For 8-team brackets (3 rounds)
  // champ week = startWeek + 2. Walk the rounds when possible.
  const rounds = toArray(meta.playoffBracket?.playoffRound);
  if (rounds.length) {
    const finalRound = rounds[rounds.length - 1];
    const week = parseNum(finalRound.week);
    if (week) return week;
  }
  return startWeek + Math.max(0, startWeekGames - 1);
}

function extractFromWeeklyResults(weeklyResults, championshipWeek) {
  const weeks = toArray(weeklyResults?.weeklyResults?.matchup) ||
                toArray(weeklyResults?.weeks);
  // weeklyResults shape varies. The MFL export form is:
  //   weeklyResults.matchup[] each with franchise[]
  // The cached "weekly-results.json" shape is different (compact, week+scores).
  // For the championship game we need MFL raw export.
  if (!championshipWeek) return null;
  for (const matchup of weeks) {
    if (matchup?.week && parseNum(matchup.week) !== championshipWeek) continue;
    const franchises = toArray(matchup.franchise);
    if (franchises.length !== 2) continue;
    if (matchup.isPlayoff !== '1' && matchup.bracket !== '1') continue;
    const [a, b] = franchises;
    const aPts = parseNum(a.score);
    const bPts = parseNum(b.score);
    if (aPts === 0 && bPts === 0) continue;
    const winner = aPts >= bPts ? a : b;
    const loser = aPts >= bPts ? b : a;
    return {
      champion: winner.id,
      runnerUp: loser.id,
      source: 'weeklyResults',
    };
  }
  return null;
}

async function loadFranchiseNames(year) {
  const leaguePath = path.join(FEEDS_DIR, String(year), 'league.json');
  const data = await readJson(leaguePath);
  if (!data?.league?.franchises?.franchise) return new Map();
  const map = new Map();
  for (const f of toArray(data.league.franchises.franchise)) {
    map.set(f.id, f.name);
  }
  return map;
}

// Cross-check that the cached year actually corresponds to AFL by comparing
// the cached fetch.meta.json's leagueId against the canonical map.
async function detectCacheLeagueIdMismatch(year, hostMap) {
  const expected = hostMap.years[String(year)]?.leagueId;
  if (!expected) return null;
  const meta = await readJson(path.join(FEEDS_DIR, String(year), 'fetch.meta.json'));
  const cached = meta?.leagueId;
  if (cached && cached !== expected) {
    return { cached, expected };
  }
  return null;
}

// --- Online fetch -------------------------------------------------------------

async function fetchMfl(host, year, leagueId, type, extra = '') {
  const url = `https://${host}.myfantasyleague.com/${year}/export?TYPE=${type}&L=${leagueId}&JSON=1${extra}`;
  log(`fetching ${url}`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'mfl.football.v2 backfill (+https://github.com/braven112/mfl.football.v2)',
    },
  });
  if (!res.ok) {
    throw new Error(`MFL ${url} returned ${res.status}`);
  }
  return res.json();
}

async function backfillYearOnline(year, hostMap) {
  const entry = hostMap.years[String(year)];
  if (!entry) {
    warn(`no host map entry for ${year}, skipping`);
    return null;
  }

  const { host, leagueId } = entry;

  // Try playoffBracket first (works 2020+)
  try {
    const bracket = await fetchMfl(host, year, leagueId, 'playoffBracket', '&BRACKET_ID=1');
    const result = extractFromPlayoffBracket(bracket?.playoffBracket || bracket);
    if (result) return { year, ...result };
  } catch (err) {
    warn(`playoffBracket fetch for ${year} failed: ${err.message}`);
  }

  // Fallback for pre-2020: get the playoffBrackets metadata to find the
  // championship week, then fetch weeklyResults for that week.
  try {
    const brackets = await fetchMfl(host, year, leagueId, 'playoffBrackets');
    const champWeek = getChampionshipWeek(brackets);
    if (!champWeek) {
      warn(`no championship week determinable for ${year}`);
      return null;
    }
    const weekly = await fetchMfl(
      host,
      year,
      leagueId,
      'weeklyResults',
      `&W=${champWeek}`
    );
    const result = extractFromWeeklyResults(weekly, champWeek);
    if (result) return { year, ...result };
  } catch (err) {
    warn(`weeklyResults fetch for ${year} failed: ${err.message}`);
  }

  return null;
}

// --- Offline (read cache) -----------------------------------------------------

async function backfillYearOffline(year) {
  const yearDir = path.join(FEEDS_DIR, String(year));
  const bracketCached = await readJson(path.join(yearDir, 'playoff-brackets.json'));
  if (bracketCached) {
    const result = extractFromPlayoffBracket(bracketCached);
    if (result) return { year, ...result };
  }
  // weekly-results.json on disk is the compact form (week+scores) — not
  // useful for championship participants because it lacks isPlayoff. Fall
  // through.
  return null;
}

// --- Driver -------------------------------------------------------------------

async function main() {
  const hostMap = await readJson(HOST_MAP_PATH);
  if (!hostMap?.years) {
    throw new Error(`year-host-map.json is missing or malformed at ${HOST_MAP_PATH}`);
  }

  if (REBUILD_HOST_MAP) {
    await rebuildHostMap(hostMap);
    return;
  }

  const yearsToProcess = SINGLE_YEAR
    ? [SINGLE_YEAR]
    : Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);

  // Existing entries — preserve known-good rows and only fill gaps.
  const existing = await readJson(OUTPUT_PATH);
  const existingByYear = new Map();
  for (const entry of existing?.championships || []) {
    existingByYear.set(entry.year, entry);
  }

  const champions = [];
  const gaps = [];

  for (const year of yearsToProcess) {
    if (existingByYear.has(year) && !ONLINE) {
      champions.push(existingByYear.get(year));
      continue;
    }

    // Sanity check the cache before trusting it
    const mismatch = await detectCacheLeagueIdMismatch(year, hostMap);
    if (mismatch) {
      warn(
        `${year} cached fetch.meta.json says leagueId=${mismatch.cached} but expected ${mismatch.expected} — cache is suspect, will not use offline`
      );
    }

    let extracted = null;
    if (ONLINE) {
      extracted = await backfillYearOnline(year, hostMap);
    }
    if (!extracted && !mismatch) {
      extracted = await backfillYearOffline(year);
    }

    if (!extracted) {
      // Keep prior known-good if nothing new; otherwise mark gap
      if (existingByYear.has(year)) {
        champions.push(existingByYear.get(year));
      } else {
        gaps.push(year);
      }
      continue;
    }

    const names = await loadFranchiseNames(year);
    const enriched = {
      year: extracted.year,
      champion: extracted.champion,
      runnerUp: extracted.runnerUp,
      championName: names.get(extracted.champion) || extracted.champion,
      runnerUpName: names.get(extracted.runnerUp) || extracted.runnerUp,
      source: extracted.source,
    };
    champions.push(enriched);
    log(`${year}: ${enriched.championName} (${enriched.champion}) def. ${enriched.runnerUpName} (${enriched.runnerUp})  [${enriched.source}]`);
  }

  champions.sort((a, b) => a.year - b.year);

  const output = {
    $comment: existing?.$comment ||
      'AFL Fantasy league championship history. Mirrors data/theleague/championship-history.json shape.',
    championships: champions,
  };
  if (gaps.length) {
    output.$gaps = {
      $comment:
        'Years not yet backfilled. Run with --online in a network-enabled environment to fill them in.',
      missingYears: gaps,
    };
  }

  await writeJson(OUTPUT_PATH, output);
  log(`wrote ${champions.length} entries (gaps: ${gaps.length}) to ${path.relative(ROOT, OUTPUT_PATH)}`);
}

async function rebuildHostMap(hostMap) {
  // Read 2024 league.json (the latest committed) and rebuild from
  // league.history.league[]. Keeps the comment, replaces years.
  const league2024 = await readJson(path.join(FEEDS_DIR, '2024', 'league.json'));
  const history = league2024?.league?.history?.league;
  if (!Array.isArray(history)) {
    throw new Error('Could not read league.history.league from 2024 league.json');
  }
  const years = {};
  for (const h of history) {
    const m = h?.url?.match(/\/\/(www\d+)\.myfantasyleague\.com\/(\d+)\/home\/(\d+)/);
    if (!m) continue;
    years[m[2]] = { host: m[1], leagueId: m[3] };
  }
  // Always include 2024+ since they're the current host
  if (!years['2024']) years['2024'] = { host: 'www44', leagueId: '19621' };
  if (!years['2025']) years['2025'] = { host: 'www44', leagueId: '19621' };
  if (!years['2026']) years['2026'] = { host: 'www44', leagueId: '19621' };

  const rebuilt = { ...hostMap, years };
  await writeJson(HOST_MAP_PATH, rebuilt);
  log(`rebuilt host map: ${Object.keys(years).length} years`);
}

main().catch((err) => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
