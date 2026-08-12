#!/usr/bin/env node
/**
 * Report how much head-to-head history a league's committed feeds actually
 * hold, per season.
 *
 * Reads the feeds directly rather than the derived franchise-history.json, so
 * it can be run BEFORE the aggregator to snapshot the starting point — which is
 * the whole point: the backfill workflow prints this before and after, and the
 * delta is the answer to "did MFL give us anything this time".
 *
 * H2H pairings are the one input rivalry pages cannot be derived without
 * (weekly-results.json is {franchiseId: score} with no opponent), and MFL's
 * archived exports for AFL 2007-2019 carry postseason weeks only.
 *
 * Usage:
 *   node scripts/report-h2h-coverage.mjs --league=afl
 *   node scripts/report-h2h-coverage.mjs --league=afl --json > before.json
 *   node scripts/report-h2h-coverage.mjs --league=afl --compare before.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const leagueArg = args.find((a) => a.startsWith('--league='))?.slice('--league='.length);
const SLUG = leagueArg === 'afl' ? 'afl-fantasy' : leagueArg || 'theleague';
const AS_JSON = args.includes('--json');
const COMPARE_PATH = args.find((a) => a.startsWith('--compare='))?.slice('--compare='.length);

const league = getLeagueBySlug(SLUG);
if (!league) {
  console.error(`Unknown --league=${SLUG}`);
  process.exit(1);
}

const FEEDS_DIR = path.join(ROOT, league.dataPath, 'mfl-feeds');
const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * Unique scored matchups per season, from either source that can carry
 * pairings. Keyed by week + the sorted franchise pair so the two feeds
 * overlapping does not double-count.
 */
function scanYear(year) {
  const dir = path.join(FEEDS_DIR, String(year));
  const schedule = readJson(path.join(dir, 'schedule.json'));
  const raw = readJson(path.join(dir, 'weekly-results-raw.json'));

  const games = new Set();
  const weeks = new Set();
  const add = (week, fr) => {
    if (fr.length < 2) return;
    const a = fr[0]?.id;
    const b = fr[1]?.id;
    if (!a || !b) return;
    const scoreA = Number(fr[0]?.score);
    const scoreB = Number(fr[1]?.score);
    if (!(scoreA > 0 && scoreB > 0)) return;
    games.add(`${week}:${[a, b].sort().join(':')}`);
    weeks.add(week);
  };

  for (const wk of toArray(schedule?.schedule?.weeklySchedule)) {
    for (const m of toArray(wk.matchup)) add(Number(wk.week), toArray(m.franchise));
  }
  for (const key of Object.keys(raw ?? {})) {
    const wr = raw[key]?.weeklyResults;
    for (const m of toArray(wr?.matchup)) add(Number(wr?.week), toArray(m.franchise));
  }

  const weeksInFeed = toArray(schedule?.schedule?.weeklySchedule).length || null;
  return { year, games: games.size, weeksWithGames: weeks.size, weeksInFeed };
}

const years = fs.existsSync(FEEDS_DIR)
  ? fs
      .readdirSync(FEEDS_DIR)
      .filter((d) => /^\d{4}$/.test(d))
      .map(Number)
      .sort((a, b) => a - b)
  : [];

const report = years.map(scanYear);
const total = report.reduce((sum, r) => sum + r.games, 0);

if (AS_JSON) {
  console.log(JSON.stringify({ league: SLUG, total, seasons: report }, null, 2));
  process.exit(0);
}

const before = COMPARE_PATH ? readJson(COMPARE_PATH) : null;
const beforeByYear = new Map((before?.seasons ?? []).map((s) => [s.year, s]));

const lines = [];
lines.push(`### Head-to-head coverage — ${SLUG}`);
lines.push('');
lines.push(`| Season | Games | Weeks with games | Weeks in feed |${before ? ' Change |' : ''}`);
lines.push(`|---|---:|---:|---:|${before ? '---:|' : ''}`);
for (const r of report) {
  const prev = beforeByYear.get(r.year);
  const delta = prev ? r.games - prev.games : 0;
  const changeCell = before ? ` ${delta > 0 ? `**+${delta}**` : delta < 0 ? `${delta}` : '—'} |` : '';
  lines.push(
    `| ${r.year} | ${r.games} | ${r.weeksWithGames} | ${r.weeksInFeed ?? '—'} |${changeCell}`
  );
}
lines.push('');
lines.push(`**Total games: ${total}**${before ? ` (was ${before.total}, ${total - before.total >= 0 ? '+' : ''}${total - before.total})` : ''}`);

if (before) {
  const gained = report.filter((r) => (beforeByYear.get(r.year)?.games ?? 0) < r.games);
  lines.push('');
  lines.push(
    gained.length
      ? `Recovered new matchups in ${gained.length} season(s): ${gained.map((g) => g.year).join(', ')}.`
      : 'No new matchups recovered — MFL served nothing beyond what was already committed.'
  );
}

const out = lines.join('\n');
console.log(out);

// Also write to the Actions job summary when running in CI, so the result is
// visible without opening the log.
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n');
}
