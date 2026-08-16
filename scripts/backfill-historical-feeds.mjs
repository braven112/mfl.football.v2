#!/usr/bin/env node
/**
 * Backfill missing historical MFL feeds for TheLeague or AFL Fantasy.
 *
 * MFL league IDs are per-year: a league keeps its current ID only for seasons
 * it renewed under it, so querying an old year with the current ID silently
 * returns a DIFFERENT league's data. This script reads history.league from a
 * verified-current cached league.json (which contains the URL + league ID for
 * every season the league has lived under on MFL) and, per year, fetches
 * whichever feeds we don't yet have on disk — always with that year's correct
 * host + league ID.
 *
 * What it pulls per year:
 *   league.json, standings.json, schedule.json (H2H pairings — needed for
 *   rivalry pages), transactions.json, draftResults.json, auctionResults.json,
 *   playoff-brackets.json, weekly-results-raw.json + weekly-results.json.
 *
 * Usage:
 *   node scripts/backfill-historical-feeds.mjs                       # TheLeague, fill gaps only
 *   node scripts/backfill-historical-feeds.mjs --league=afl          # AFL Fantasy
 *   node scripts/backfill-historical-feeds.mjs --force               # refetch everything
 *   node scripts/backfill-historical-feeds.mjs --force --year=2015   # refetch one year (repeatable)
 *   node scripts/backfill-historical-feeds.mjs --dry-run             # preview
 *
 * If anything new comes back, re-run the league's derived-data scripts
 * (TheLeague: pnpm compute:franchise-history).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEAGUES } from '../src/config/leagues-data.mjs';
import { normalizeWeeklyResults } from './lib/normalize-weekly-results.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Per-league backfill config. `historySourceYear` is a year whose cached
// league.json is verified to belong to THIS league (old cached years may be
// contaminated with another league's data) and carries the full history block.
const BACKFILL_LEAGUES = {
  theleague: { registry: LEAGUES.theleague, historySourceYear: '2025' },
  afl: { registry: LEAGUES['afl-fantasy'], historySourceYear: '2026' },
};

const args = process.argv.slice(2);
const LEAGUE_KEY = (args.find((a) => a.startsWith('--league=')) ?? '--league=theleague')
  .slice('--league='.length);
const LEAGUE = BACKFILL_LEAGUES[LEAGUE_KEY];
if (!LEAGUE) {
  console.error(`Unknown --league=${LEAGUE_KEY} (expected: ${Object.keys(BACKFILL_LEAGUES).join(' | ')})`);
  process.exit(1);
}

const FEEDS_DIR = path.join(ROOT, LEAGUE.registry.dataPath, 'mfl-feeds');
const CURRENT_LEAGUE_JSON = path.join(FEEDS_DIR, `${LEAGUE.historySourceYear}/league.json`);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const ONLY_YEARS = args
  .filter((a) => a.startsWith('--year='))
  .map((a) => Number(a.slice('--year='.length)))
  .filter((y) => Number.isInteger(y));

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

const isInvalidFeed = (data) =>
  !data ||
  data.error ||
  /Invalid league/i.test(JSON.stringify(data?.error || ''));

const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

// A feed can be well-formed JSON, carry no `error` key, and still be useless.
// AFL's archived 2007-2019 schedules are exactly that: `schedule.weeklySchedule`
// is present with all 17 weeks, but the regular-season weeks hold ZERO matchup
// entries (MFL only kept weeks 14-17). isInvalidFeed saw no `error` key, called
// it "already valid", and every gap-fill run skipped it — so the hole was never
// retried and ~60% of AFL's head-to-head history stayed missing.
//
// H2H pairings are the one thing rivalry/highlight pages cannot be derived
// without (weekly-results.json is {franchiseId: score} with no opponent).
//
// "Empty" is too weak a test: AFL's 2016 schedule DOES carry weeks 14-17, so a
// mere some()-has-pairings check passes and the 13 missing regular-season weeks
// stay missing. What marks a hole is an EMPTY week sitting before a POPULATED
// one. Trailing empty weeks are legitimate (season in progress, or a league
// that plays fewer weeks than the feed lists), so only leading/interior gaps
// count. Cost of a false positive: that year re-requests on each run — bounded,
// and loud (the log says why), which beats caching a hole forever.
const countsToGapFlag = (perWeekPairCounts) => {
  const lastPopulated = perWeekPairCounts.findLastIndex((n) => n > 0);
  if (lastPopulated < 0) return true; // nothing at all — definitely a gap
  return perWeekPairCounts.slice(0, lastPopulated).some((n) => n === 0);
};

const schedulePairsPerWeek = (data) =>
  toArray(data?.schedule?.weeklySchedule).map((wk) =>
    toArray(wk.matchup).filter((m) => toArray(m.franchise).length >= 2).length
  );

const scheduleIsComplete = (data) => !countsToGapFlag(schedulePairsPerWeek(data));

const totalPairs = (perWeek) => perWeek.reduce((a, b) => a + b, 0);

// Raw weeklyResults comes back in two shapes: `matchup[]` (pairs, what we want)
// and a flat `franchise[]` carrying only id/score/opt_pts — no opponent, no
// result. The flat shape is what archive-year regular seasons return, and it
// cannot be paired back up, so it counts as zero pairings for that week.
const weeklyRawPairsPerWeek = (weeks) =>
  toArray(weeks).map((wk) =>
    toArray(wk?.weeklyResults?.matchup).filter((m) => toArray(m.franchise).length >= 2).length
  );

const weeklyRawIsComplete = (weeks) => !countsToGapFlag(weeklyRawPairsPerWeek(weeks));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return { ok: true, data: JSON.parse(text), raw: text };
  } catch {
    return { ok: false, data: null, raw: text };
  }
}

// Single-call endpoints. Schedule is the new one — gives per-week H2H pairings
// that we need for rivalry pages.
const SIMPLE_ENDPOINTS = [
  { type: 'league', file: 'league.json' },
  { type: 'leagueStandings', file: 'standings.json' },
  {
    type: 'schedule',
    file: 'schedule.json',
    isComplete: scheduleIsComplete,
    // Never trade a fuller cached schedule for a thinner fresh one: AFL's
    // archive years already hold weeks 14-17, and MFL answering with less
    // than that would otherwise wipe the playoff pairings we do have.
    countPairs: (data) => totalPairs(schedulePairsPerWeek(data)),
  },
  { type: 'transactions', file: 'transactions.json', extra: 'W=YTD&TRANS_TYPE=*' },
  { type: 'draftResults', file: 'draftResults.json' },
  { type: 'auctionResults', file: 'auctionResults.json' },
  { type: 'playoffBrackets', file: 'playoff-brackets.json' },
];

// MFL's schedule export is owner-gated: "Private league access restricted to
// league owners." Without an APIKEY a private league's archived seasons return
// the week skeleton with the matchups stripped — `{"week":"1"}` and no matchup
// key — which looks exactly like "MFL no longer has this data" and is why the
// AFL's 2007-2019 regular season appeared lost. Same env spelling as
// fetch-mfl-feeds.mjs / fetch-trade-bait.mjs; both are accepted because the
// workflows disagree about which one they export.
const getNonEmpty = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const MFL_API_KEY =
  getNonEmpty(process.env.MFL_APIKEY) || getNonEmpty(process.env.MFL_API_KEY);

function buildUrl(host, year, leagueId, type, extra) {
  const base = `https://${host}/${year}/export?TYPE=${type}&L=${leagueId}&JSON=1`;
  const withExtra = extra ? `${base}&${extra}` : base;
  return MFL_API_KEY ? `${withExtra}&APIKEY=${encodeURIComponent(MFL_API_KEY)}` : withExtra;
}

// Workflow logs are visible to anyone who can see the repo — never print a key.
const redactUrl = (url) => String(url).replace(/APIKEY=[^&]+/, 'APIKEY=***');

// Attempt one endpoint, return outcome string + whether anything was written.
// `isComplete` / `countPairs` (optional) let an endpoint declare what "actually
// has the data we need" means beyond "parsed and has no error key" — see
// scheduleIsComplete.
async function attemptEndpoint(
  host, year, leagueId, type, file, extra, dest, { isComplete, countPairs } = {}
) {
  let cached = null;
  if (!FORCE && fs.existsSync(dest)) {
    const existing = readJson(dest);
    if (!isInvalidFeed(existing)) {
      if (isComplete && !isComplete(existing)) {
        cached = existing;
        console.log(`  ↻ ${file} — cached copy is missing weeks, refetching`);
      } else {
        return { skipped: true, reason: 'already valid' };
      }
    }
  }
  if (DRY_RUN) {
    return { dryRun: true };
  }
  const url = buildUrl(host, year, leagueId, type, extra);
  try {
    const result = await fetchJson(url);
    if (!result.ok) return { error: 'not JSON (HTML error page)' };
    if (isInvalidFeed(result.data)) return { error: 'invalid league' };
    if (cached && countPairs) {
      const before = countPairs(cached);
      const after = countPairs(result.data);
      if (after < before) {
        return { skipped: true, reason: `kept cached copy (${before} pairings vs ${after} fresh)` };
      }
      if (after === before) {
        return { skipped: true, reason: `refetch returned the same ${after} pairings — MFL has no more` };
      }
    }
    fs.writeFileSync(dest, JSON.stringify(result.data, null, 2));
    return { written: true, bytes: result.raw.length };
  } catch (err) {
    return { error: err.message };
  } finally {
    await sleep(500);
  }
}

// Last resort for a schedule MFL will not serve whole.
//
// The season-wide `TYPE=schedule` call is the ONLY one we have ever made, and
// for AFL 2007-2019 it answers with bare `{"week":"1"}` elements — no matchup
// key at all — for every regular-season week. Those pairings exist nowhere else
// in any committed feed, and they cannot be reconstructed: AFL teams play more
// than one game in some weeks (the in-season Cup), so there is no one-game-per-
// week matching to solve and no conservation law to pin a unique answer.
//
// `TYPE=schedule&W=n` is a different query against the same archive, and MFL's
// per-week and season-wide exports are not always backed by the same stored
// record. It costs one request per missing week and is the only untried way to
// get the real games rather than invented ones. If it returns nothing either,
// the data is genuinely gone and we say so.
async function repairScheduleByWeek(host, year, leagueId, dest, maxWeek = 17) {
  const existing = readJson(dest);
  const perWeek = schedulePairsPerWeek(existing);
  const missing = [];
  // -1 means NO week has pairings, which is the fully-stripped archive this
  // repair exists for. Treating that as "last populated = -1" made `i < -1`
  // vacuously false, so `missing` stayed empty and the fallback reported "no
  // week-level gaps" on precisely the season countsToGapFlag calls a definite
  // gap. When nothing is populated, every week is a candidate.
  const lastPopulated = perWeek.findLastIndex((n) => n > 0);
  const chaseThrough = lastPopulated === -1 ? Math.max(perWeek.length, maxWeek) : lastPopulated;
  for (let i = 0; i < Math.max(perWeek.length, maxWeek); i++) {
    // Otherwise only chase weeks before the last populated one — trailing
    // empties are a season in progress, not a hole.
    if (i < chaseThrough && (perWeek[i] ?? 0) === 0) missing.push(i + 1);
  }
  if (missing.length === 0) return { skipped: true, reason: 'no week-level gaps' };
  if (DRY_RUN) return { dryRun: true, weeksToFetch: missing.length };

  const byWeek = new Map(
    toArray(existing?.schedule?.weeklySchedule).map((wk) => [String(wk.week), wk])
  );
  let recovered = 0;
  for (const week of missing) {
    try {
      const result = await fetchJson(buildUrl(host, year, leagueId, 'schedule', `W=${week}`));
      if (!result.ok || isInvalidFeed(result.data)) continue;
      const fetched = toArray(result.data?.schedule?.weeklySchedule).find(
        (wk) => String(wk.week) === String(week)
      );
      const pairs = toArray(fetched?.matchup).filter((m) => toArray(m.franchise).length >= 2);
      if (pairs.length === 0) continue;
      byWeek.set(String(week), fetched);
      recovered += pairs.length;
    } catch {
      // A single bad week must not abort the rest.
    }
    await sleep(500);
  }

  if (recovered === 0) {
    return { skipped: true, reason: `per-week schedule empty for ${missing.length} week(s) — MFL has no record` };
  }
  const merged = {
    ...(existing ?? {}),
    schedule: {
      ...(existing?.schedule ?? {}),
      weeklySchedule: [...byWeek.values()].sort((a, b) => Number(a.week) - Number(b.week)),
    },
  };
  fs.writeFileSync(dest, JSON.stringify(merged, null, 2));
  return { written: true, recovered, weeks: missing.length };
}

// Fetch all 17 weeks of weekly results and produce both raw and normalized
// outputs, matching the format produced by scripts/fetch-mfl-feeds.mjs.
async function fetchWeeklyResults(host, year, leagueId, yearDir) {
  const rawPath = path.join(yearDir, 'weekly-results-raw.json');
  const normPath = path.join(yearDir, 'weekly-results.json');

  let cachedRaw = null;
  if (!FORCE && fs.existsSync(rawPath) && fs.existsSync(normPath)) {
    const existingRaw = readJson(rawPath);
    if (Array.isArray(existingRaw) && existingRaw.length > 0) {
      // Length alone is the same trap attemptEndpoint fell into: all 17 weeks
      // can be present while the regular-season ones carry the flat, opponent-
      // less franchise[] shape. Require actual pairings before calling it cached.
      if (weeklyRawIsComplete(existingRaw)) {
        return { skipped: true, reason: 'already cached' };
      }
      cachedRaw = existingRaw;
      console.log('  ↻ weekly-results — cached copy is missing H2H pairings, refetching');
    }
  }

  if (DRY_RUN) {
    return { dryRun: true, weeksToFetch: 17 };
  }

  const rawWeeks = [];
  for (let week = 1; week <= 17; week++) {
    const url = buildUrl(host, year, leagueId, 'weeklyResults', `W=${week}`);
    try {
      const result = await fetchJson(url);
      if (!result.ok) continue;
      if (isInvalidFeed(result.data)) continue;
      rawWeeks.push(result.data);
    } catch {
      // skip
    }
    await sleep(500);
  }

  if (rawWeeks.length === 0) {
    return { error: 'no weeks returned' };
  }

  // Same no-regression guard as attemptEndpoint — a refetch that comes back
  // with fewer pairings than we already hold must not overwrite the cache.
  if (cachedRaw) {
    const before = totalPairs(weeklyRawPairsPerWeek(cachedRaw));
    const after = totalPairs(weeklyRawPairsPerWeek(rawWeeks));
    if (after < before) {
      return { skipped: true, reason: `kept cached copy (${before} pairings vs ${after} fresh)` };
    }
    if (after === before) {
      return { skipped: true, reason: `refetch returned the same ${after} pairings — MFL has no more` };
    }
  }

  fs.writeFileSync(rawPath, JSON.stringify(rawWeeks, null, 2));

  // Shared normalizer — handles both MFL payload shapes (matchup[] and the
  // older flat franchise[] used by archive-year regular seasons).
  fs.writeFileSync(normPath, JSON.stringify(normalizeWeeklyResults(rawWeeks), null, 2));

  return { written: true, weeks: rawWeeks.length };
}

const current = readJson(CURRENT_LEAGUE_JSON);
if (!current) {
  console.error(`Cannot read ${CURRENT_LEAGUE_JSON}`);
  process.exit(1);
}
if (String(current.league?.id ?? '') !== LEAGUE.registry.id) {
  console.error(
    `History source ${CURRENT_LEAGUE_JSON} has league id ${current.league?.id} — ` +
    `expected ${LEAGUE.registry.id}. Refusing to backfill from a contaminated file.`
  );
  process.exit(1);
}

const historyEntries = current.league?.history?.league ?? [];
const yearList = historyEntries
  .map((e) => {
    const m = String(e.url).match(/^https?:\/\/(www\d+\.myfantasyleague\.com)\/(\d+)\/home\/(\d+)/);
    if (!m) return null;
    return { year: Number(e.year), host: m[1], leagueId: m[3] };
  })
  .filter(Boolean)
  .filter((e) => ONLY_YEARS.length === 0 || ONLY_YEARS.includes(e.year))
  .sort((a, b) => a.year - b.year);

console.log(`Found ${yearList.length} historical league entries.`);
console.log(`Mode: ${DRY_RUN ? 'dry-run' : FORCE ? 'force-refetch' : 'fill gaps only'}`);
console.log(
  MFL_API_KEY
    ? 'Auth: APIKEY present — private-league schedules should resolve.'
    : 'Auth: NO APIKEY. MFL restricts private-league schedule exports to owners, ' +
      'so archived seasons will return weeks with no matchups. Set MFL_APIKEY to fix.'
);

let totalWritten = 0;
let totalSkipped = 0;
let totalErrors = 0;
let totalDryRun = 0;

for (const entry of yearList) {
  const yearDir = path.join(FEEDS_DIR, String(entry.year));
  fs.mkdirSync(yearDir, { recursive: true });
  console.log(`\n[${entry.year}] host=${entry.host} leagueId=${entry.leagueId}`);

  // Simple per-endpoint loop
  for (const { type, file, extra, isComplete, countPairs } of SIMPLE_ENDPOINTS) {
    const dest = path.join(yearDir, file);
    const outcome = await attemptEndpoint(
      entry.host, entry.year, entry.leagueId, type, file, extra, dest,
      { isComplete, countPairs }
    );
    if (outcome.skipped) { console.log(`  ◦ ${file} — ${outcome.reason}`); totalSkipped++; }
    else if (outcome.dryRun) { console.log(`  [dry-run] would fetch ${type} → ${file}`); totalDryRun++; }
    else if (outcome.written) { console.log(`  ✓ ${type} → ${file} (${outcome.bytes} bytes)`); totalWritten++; }
    else if (outcome.error) { console.log(`  ✗ ${type} → ${outcome.error}`); totalErrors++; }

    // A season-wide schedule that came back with interior holes gets one more
    // chance, week by week. These are the head-to-head pairings the rivalry
    // pages are built from, and nothing else can supply them.
    if (type === 'schedule') {
      const repair = await repairScheduleByWeek(entry.host, entry.year, entry.leagueId, dest);
      if (repair.written) {
        console.log(`  ✓ schedule (per-week) → recovered ${repair.recovered} matchups across ${repair.weeks} week(s)`);
        totalWritten++;
      } else if (repair.dryRun) {
        console.log(`  [dry-run] would fetch ${repair.weeksToFetch} individual schedule week(s)`);
        totalDryRun++;
      } else if (repair.skipped && repair.reason !== 'no week-level gaps') {
        console.log(`  ◦ schedule (per-week) — ${repair.reason}`);
        totalSkipped++;
      }
    }
  }

  // Weekly results: special-cased because it needs 17 separate fetches.
  const wkOutcome = await fetchWeeklyResults(entry.host, entry.year, entry.leagueId, yearDir);
  if (wkOutcome.skipped) { console.log(`  ◦ weekly-results — ${wkOutcome.reason}`); totalSkipped++; }
  else if (wkOutcome.dryRun) { console.log(`  [dry-run] would fetch ${wkOutcome.weeksToFetch} weeks of weeklyResults`); totalDryRun++; }
  else if (wkOutcome.written) { console.log(`  ✓ weeklyResults → weekly-results-raw.json + weekly-results.json (${wkOutcome.weeks} weeks)`); totalWritten++; }
  else if (wkOutcome.error) { console.log(`  ✗ weeklyResults → ${wkOutcome.error}`); totalErrors++; }
}

console.log(
  `\nDone. written=${totalWritten} skipped=${totalSkipped} errors=${totalErrors}` +
  (DRY_RUN ? ` dry-run=${totalDryRun}` : '')
);
if (totalWritten > 0) {
  console.log(`\nIf any years got new data, re-run: pnpm compute:franchise-history`);
}
