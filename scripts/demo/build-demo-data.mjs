#!/usr/bin/env node
/**
 * The custom-site demo's prebuild (docs/plans/custom-site-demo.md).
 *
 * Replaces scripts/prebuild.mjs on the demo branch. It DELETES the real
 * league's data from the build checkout and writes a fictional league in its
 * place, at the same paths, so every page and every derivation script reads
 * fiction without a single edit:
 *
 *   1. read the NFL facts it needs (players, weekly points) — and nothing else
 *      league-specific — from the real feeds, into memory;
 *   2. record the real names the leak scan must never find in the output;
 *   3. wipe every league-identity file, keeping only NFL-fact files;
 *   4. simulate the fictional seasons and write them as MFL-shaped feeds, plus
 *      the identity files, art, owners and championships;
 *   5. run the site's own derivation scripts over the fiction.
 *
 * DESTRUCTIVE by design, so it refuses to run outside a Vercel build unless
 * explicitly told the checkout is disposable. Offline by design: it runs under
 * scripts/demo/lib/guard-preload.mjs, which refuses every network call, and
 * every child step inherits that preload. Any failure is FATAL — unlike the
 * normal prebuild, which swallows step failures — because a half-run demo
 * build may still be carrying real data.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadSeasonFacts } from './lib/nfl-facts.mjs';
import { simulateLeague } from './lib/simulate.mjs';
import { DEMO_DIVISIONS, DEMO_FRANCHISES, DEMO_LEAGUE_NAME } from './lib/franchises.mjs';
import { createRng } from './lib/rng.mjs';
import * as feeds from './lib/mfl-feeds.mjs';
import * as identity from './lib/identity-files.mjs';
import { collectDenylist } from './lib/denylist.mjs';
import { nflWeekStartInstant } from '../../src/utils/nfl-week-starts.mjs';
import { LEAGUES } from '../../src/config/leagues-data.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PRELOAD = path.join(ROOT, 'scripts/demo/lib/guard-preload.mjs');
const LEAGUE = 'theleague';
const DATA = path.join(ROOT, 'data', LEAGUE);
const FEEDS = path.join(DATA, 'mfl-feeds');
const SRC_DATA = path.join(ROOT, 'src/data');
const PUBLIC = path.join(ROOT, 'public');
/** Scratch output that must never be bundled or committed. */
export const DEMO_WORK_DIR = path.join(ROOT, '.demo-build');

/** Seasons of fictional history, ending with the league year in progress. */
const SEASON_COUNT = 6;
/** The fictional league's MFL id: not any real league's, so no cache key can alias one. */
const DEMO_MFL_ID = '99001';
const SEED = 'demo-dynasty-v1';

/** Per-season files that are NFL facts, carried over untouched. */
const NFL_FACT_FEEDS = new Set([
  'players.json',
  'nflSchedule.json',
  'nflSchedule-full.json',
  'projectedScores.json',
  'playerScores.json',
  'playerScores-ytd.json',
  'playerScores-by-week.json',
  'player-scores-weekly.json',
  'fantasyPointsAllowed.json',
  'adp-dynasty.json',
  'adp-redraft.json',
  'injuries.json',
]);

/** Root-level data/theleague files that are NFL facts (or league-neutral). */
const NFL_FACT_ROOT_FILES = [
  'espn-college-ids.json',
  'rsp-player-ids.json',
  'broadcast-mappings.json',
  'historical-salary-curves.json',
];

const log = (msg) => console.log(`[demo-build] ${msg}`);

function assertSafeToRun() {
  if (!globalThis.fetch || !String(globalThis.fetch).includes('DemoBuildNetworkError')) {
    throw new Error('build-demo-data must run under scripts/demo/lib/guard-preload.mjs (node --import).');
  }
  const onVercel = process.env.VERCEL === '1';
  const acknowledged = process.env.DEMO_BUILD_DISPOSABLE_CHECKOUT === '1';
  if (!onVercel && !acknowledged) {
    throw new Error(
      'build-demo-data DELETES the real league data from this checkout. It runs on Vercel builds of the ' +
        'demo branch. To run it locally, use a throwaway worktree and set DEMO_BUILD_DISPOSABLE_CHECKOUT=1.',
    );
  }
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });

function leagueYears() {
  return fs
    .readdirSync(FEEDS)
    .filter((d) => /^\d{4}$/.test(d))
    .map(Number)
    .sort((a, b) => a - b);
}

/** Snapshot the NFL-fact files into memory before the wipe. */
function captureNflFacts(years) {
  const perYear = new Map();
  for (const y of years) {
    const dir = path.join(FEEDS, String(y));
    const files = new Map();
    for (const name of NFL_FACT_FEEDS) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) files.set(name, fs.readFileSync(p));
    }
    perYear.set(y, files);
  }
  const root = new Map();
  for (const name of NFL_FACT_ROOT_FILES) {
    const p = path.join(DATA, name);
    if (fs.existsSync(p)) root.set(name, fs.readFileSync(p));
  }
  return { perYear, root };
}

/** Every path that carries the real league's identity. Deleted, then (partly) regenerated. */
function wipeRealLeague() {
  rm(DATA);
  rm(path.join(SRC_DATA, LEAGUE, 'schefter-archive'));
  rm(path.join(SRC_DATA, LEAGUE, 'power-rankings'));
  for (const f of fs.readdirSync(path.join(SRC_DATA, LEAGUE))) {
    if (/^mfl-(player-salaries|salary-averages)-\d{4}\.json$/.test(f)) rm(path.join(SRC_DATA, LEAGUE, f));
  }
  for (const f of fs.readdirSync(SRC_DATA)) {
    if (/^mfl-(player-salaries|salary-averages)-\d{4}\.json$/.test(f)) rm(path.join(SRC_DATA, f));
  }
  rm(path.join(SRC_DATA, 'salary-history', LEAGUE));
  rm(path.join(SRC_DATA, String(LEAGUES[LEAGUE].id)));
  rm(path.join(SRC_DATA, 'mfl-feeds', LEAGUE));
  rm(path.join(SRC_DATA, 'whats-new-archive'));
  rm(path.join(PUBLIC, 'assets', LEAGUE));
  rm(path.join(PUBLIC, 'assets', 'whats-new'));
  rm(path.join(ROOT, 'data', 'schefter', LEAGUE));
}

/** Seconds since epoch at the start of an NFL week. */
const weekStart = (year, week) => Math.floor(new Date(nflWeekStartInstant(year, week)).getTime() / 1000);

function writeSeasonFeeds(season, years, generatedAt) {
  const dir = path.join(FEEDS, String(season.year));
  const baseUrl = `https://${LEAGUES[LEAGUE].mflHost}/${season.year}`;
  writeJson(path.join(dir, 'league.json'), feeds.leagueFeed({
    season,
    leagueId: DEMO_MFL_ID,
    leagueName: DEMO_LEAGUE_NAME,
    franchises: DEMO_FRANCHISES,
    divisions: DEMO_DIVISIONS,
    assetBase: '/assets/theleague',
    years: years.filter((y) => y <= season.year),
    baseUrl,
  }));
  writeJson(path.join(dir, 'rosters.json'), feeds.rostersFeed(season));
  writeJson(path.join(dir, 'standings.json'), feeds.standingsFeed(season));
  writeJson(path.join(dir, 'schedule.json'), feeds.scheduleFeed(season, DEMO_FRANCHISES));
  writeJson(path.join(dir, 'weekly-results-raw.json'), feeds.weeklyResultsRawFeed(season));
  writeJson(path.join(dir, 'weekly-results.json'), feeds.weeklyResultsFeed(season));
  writeJson(path.join(dir, 'transactions.json'), feeds.transactionsFeed(season));
  writeJson(path.join(dir, 'draftResults.json'), feeds.draftResultsFeed(season));
  writeJson(path.join(dir, 'auctionResults.json'), feeds.auctionResultsFeed(season));
  writeJson(path.join(dir, 'futureDraftPicks.json'), feeds.futureDraftPicksFeed(season));
  writeJson(path.join(dir, 'salaryAdjustments.json'), feeds.salaryAdjustmentsFeed(season));
  writeJson(path.join(dir, 'playoff-brackets.json'), feeds.playoffBracketsFeed(season, DEMO_LEAGUE_NAME));
  writeJson(path.join(dir, 'calendar.json'), feeds.calendarFeed(season, weekStart));
  writeJson(path.join(dir, 'tradeBait.json'), []);
  writeJson(path.join(dir, 'fetch.meta.json'), feeds.fetchMetaFeed(season, DEMO_MFL_ID, generatedAt));
}

/**
 * The salary snapshot files (`mfl-player-salaries-<yr>.json` and
 * `mfl-salary-averages-<yr>.json`) — the shapes update-salary-averages.mjs
 * writes, computed from the simulated rosters instead of a live fetch.
 */
function writeSalaryFiles(season, generatedAt) {
  const metadata = {
    leagueId: DEMO_MFL_ID,
    season: String(season.year),
    week: Math.max(1, season.lastWeek),
    detectedWeek: season.lastWeek,
    freezeWeek: 14,
    frozenWeek: 14,
    sources: { rosters: 'demo-generator', players: 'demo-generator', weeklyResults: 'demo-generator' },
    fetchedAt: generatedAt,
  };
  const points = new Map();
  for (const w of season.weekly) {
    for (const [home, away] of w.games) {
      for (const p of [...home.players, ...away.players]) {
        points.set(p.id, (points.get(p.id) ?? 0) + Number(p.score));
      }
    }
  }
  const players = [];
  for (const [fid, roster] of season.rosters) {
    for (const [pid, c] of roster) {
      const p = season.players.get(pid);
      if (!p) continue;
      players.push({
        id: pid,
        name: p.name,
        position: p.position,
        salary: c.salary,
        franchiseId: fid,
        status: c.status,
        contractYear: String(c.contractYear),
        points: Math.round((points.get(pid) ?? 0) * 100) / 100,
        team: p.team,
        draftYear: p.draftYear,
      });
    }
  }
  const salaries = { metadata, players };
  const positions = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'PK', 'Def']) {
    const list = players.filter((p) => p.position === pos).sort((a, b) => b.salary - a.salary);
    const avg = (n) => (list.length ? list.slice(0, n).reduce((s, p) => s + p.salary, 0) / Math.min(n, list.length) : 0);
    positions[pos] = {
      totalPlayers: list.length,
      top3Average: Math.round(avg(3) * 100) / 100,
      top5Average: Math.round(avg(5) * 100) / 100,
      topPlayers: list.slice(0, 5).map((p) => ({ id: p.id, name: p.name, salary: p.salary, franchiseId: p.franchiseId })),
    };
  }
  const averages = { metadata: { ...metadata, description: 'Top salary averages (demo league)', generatedAt }, positions };
  for (const dir of [SRC_DATA, path.join(SRC_DATA, LEAGUE), DATA]) {
    writeJson(path.join(dir, `mfl-player-salaries-${season.year}.json`), salaries);
    writeJson(path.join(dir, `mfl-salary-averages-${season.year}.json`), averages);
  }
}

/** Run one of the site's own npm scripts under the offline preload. Fatal on failure. */
function runStep(npmScript, args = []) {
  const started = Date.now();
  const env = {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${PRELOAD}`.trim(),
  };
  execFileSync('pnpm', ['run', '--silent', npmScript, ...(args.length ? ['--', ...args] : [])], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });
  log(`✓ ${npmScript} (${Date.now() - started}ms)`);
}

/** The derivation steps, in scripts/prebuild.mjs order, TheLeague only. */
const DERIVED_STEPS = [
  ['build:styles'],
  ['build:bookmarklets'],
  ['compute:franchise-history'],
  ['compute:player-identity-union'],
  ['compute:roster-payloads'],
  ['compute:top-players'],
  ['compute:schedule-strength'],
  ['compute:playoff-performance'],
  ['compute:owner-tenures'],
  ['compute:division-strength'],
];

export async function buildDemoData() {
  assertSafeToRun();
  const generatedAt = new Date().toISOString();

  // 1. NFL facts only.
  const allYears = leagueYears();
  const currentYear = allYears[allYears.length - 1];
  const years = allYears.filter((y) => y > currentYear - SEASON_COUNT);
  const facts = new Map(allYears.filter((y) => y >= years[0] - 1).map((y) => [y, loadSeasonFacts(FEEDS, y)]));
  const currentWeek = facts.get(currentYear).lastScoredWeek;
  const nflFacts = captureNflFacts(years);
  log(`seasons ${years[0]}–${currentYear}, current week ${currentWeek}`);

  // 2. What the leak scan must never find.
  const realConfig = readJson(path.join(SRC_DATA, `${LEAGUE}.config.json`));
  const realRegistry = readJson(path.join(SRC_DATA, 'owners-registry.json'));
  const denylist = collectDenylist({ root: ROOT, league: LEAGUE, realConfig, realRegistry });
  writeJson(path.join(DEMO_WORK_DIR, 'denylist.json'), denylist);
  const renames = identity.renamePairs(realConfig, DEMO_FRANCHISES);
  log(`denylist: ${denylist.terms.length} real names recorded`);

  // 3. Wipe.
  wipeRealLeague();
  log('real league data removed');

  // 4. Simulate and write.
  const seasons = simulateLeague({
    years,
    facts,
    currentYear,
    currentWeek,
    franchises: DEMO_FRANCHISES,
    rng: createRng(SEED),
    weekStart,
  });
  for (const season of seasons) {
    season.weekStart = (week) => weekStart(season.year, week);
    writeSeasonFeeds(season, years, generatedAt);
    writeSalaryFiles(season, generatedAt);
    for (const [name, bytes] of nflFacts.perYear.get(season.year) ?? []) {
      fs.writeFileSync(path.join(FEEDS, String(season.year), name), bytes);
    }
  }
  for (const [name, bytes] of nflFacts.root) fs.writeFileSync(path.join(DATA, name), bytes);

  writeJson(path.join(SRC_DATA, `${LEAGUE}.config.json`), identity.leagueConfig({
    franchises: DEMO_FRANCHISES,
    divisions: DEMO_DIVISIONS,
    assetDomain: '',
  }));
  writeJson(path.join(SRC_DATA, `${LEAGUE}.assets.json`), identity.leagueAssets({
    franchises: DEMO_FRANCHISES,
    divisions: DEMO_DIVISIONS,
    firstYear: years[0],
    generatedAt,
  }));
  for (const [rel, contents] of identity.artFiles(DEMO_FRANCHISES, DEMO_LEAGUE_NAME, DEMO_DIVISIONS)) {
    writeText(path.join(PUBLIC, rel), contents);
  }
  writeJson(path.join(SRC_DATA, 'owners-registry.json'), identity.ownersRegistry(realRegistry, {
    franchises: DEMO_FRANCHISES,
    firstYear: years[0],
    league: LEAGUE,
  }));
  writeJson(path.join(DATA, 'championship-history.json'), identity.championshipHistory(seasons, DEMO_FRANCHISES));

  const { writeContentReplacements } = await import('./lib/content.mjs');
  writeContentReplacements({ root: ROOT, seasons, franchises: DEMO_FRANCHISES, renames, currentYear, generatedAt, writeJson, writeText });
  log('fictional league written');

  // 5. The site's own derivations, over the fiction.
  for (const [step, ...args] of DERIVED_STEPS) runStep(step, args);
  log('done');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await buildDemoData();
}
