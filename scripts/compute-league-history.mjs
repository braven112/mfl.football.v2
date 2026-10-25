#!/usr/bin/env node
/**
 * League History dataset — every game and franchise-season of one league, each
 * season credited to the owner who ran it. Read by the Record Book
 * (`/<league>/history/record-book`) through src/utils/league-history/record-book.mjs.
 *
 * Built straight from the feeds for the same reason compute-record-book.mjs
 * is: franchise-history.json is owner-scoped and drops seasons played under a
 * slot's previous owner. Seasons come from season-ledger.json (all owners) and
 * owner credit from owner-tenures.json, so this runs AFTER the
 * franchise-history chain in prebuild. It is not part of that chain and the
 * chain never writes it (tests/derived-chain-lane.test.ts): its data test checks
 * the file against itself, so a chain commit can never leave it red.
 *
 * Output: <league dataPath>/derived/league-history.json
 *
 * Usage:
 *   node scripts/compute-league-history.mjs --league=theleague
 *   node scripts/compute-league-history.mjs --league=afl-fantasy
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { bracketKindFromName } from '../src/utils/afl-bracket-kind.mjs';
import { gamesFromSchedule } from '../src/utils/record-book.mjs';
import { buildHistoryDataset } from '../src/utils/league-history/dataset.mjs';
import { writeJsonIfChanged } from './lib/canonical-json.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const argOf = (name, fallback) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const rawLeague = argOf('league', 'theleague');
const SLUG = rawLeague === 'afl' ? 'afl-fantasy' : rawLeague;
const league = getLeagueBySlug(SLUG);
if (!league) {
  console.error(`Unknown --league=${rawLeague}`);
  process.exit(1);
}

const DATA = path.join(ROOT, league.dataPath);
const FEEDS = path.join(DATA, 'mfl-feeds');
const OUT = path.join(DATA, 'derived', 'league-history.json');

const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

const ledger = readJson(path.join(DATA, 'derived', 'season-ledger.json'));
const ownerTenures = readJson(path.join(DATA, 'derived', 'owner-tenures.json'));
if (!ledger?.rows?.length) {
  console.log(`[league-history] ${SLUG}: no season-ledger.json, nothing to build`);
  process.exit(0);
}

const years = fs.existsSync(FEEDS)
  ? fs.readdirSync(FEEDS).filter((y) => /^\d{4}$/.test(y)).sort()
  : [];

const games = [];
const firstPlayoffWeeks = {};
for (const year of years) {
  const dir = path.join(FEEDS, year);
  const schedule = readJson(path.join(dir, 'schedule.json'));
  if (!schedule) continue;
  // The AFL Cup is an in-season knockout from as early as week 4, so it does
  // not mark the postseason (same rule as compute-record-book.mjs).
  const starts = toArray(readJson(path.join(dir, 'playoff-brackets.json'))?.playoffBrackets?.playoffBracket)
    .filter((b) => bracketKindFromName(b.name, String(b.id)) !== 'cup')
    .map((b) => Number(b.startWeek))
    .filter((n) => Number.isFinite(n) && n > 0);
  const firstPlayoffWeek = starts.length ? Math.min(...starts) : Infinity;
  if (Number.isFinite(firstPlayoffWeek)) firstPlayoffWeeks[Number(year)] = firstPlayoffWeek;
  games.push(
    ...gamesFromSchedule(schedule, { nameOf: (id) => id, year: Number(year), firstPlayoffWeek, toArray })
  );
}

const dataset = buildHistoryDataset({
  league: SLUG,
  games,
  ledgerRows: ledger.rows,
  ownerTenures,
  firstPlayoffWeeks,
});

// One game and one season per line: small enough to import, and a new week of
// results is a few added lines in git rather than a rewritten blob.
const serialize = (file) => {
  const { games: rows, seasons, ...head } = file;
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  lines.push(`  "seasons": [\n${seasons.map((s) => `    ${JSON.stringify(s)}`).join(',\n')}\n  ]`);
  lines.push(`  "games": [\n${rows.map((g) => `    ${JSON.stringify(g)}`).join(',\n')}\n  ]`);
  return `{\n${lines.join(',\n')}\n}\n`;
};

const wrote = writeJsonIfChanged(OUT, serialize({ generatedAt: new Date().toISOString(), ...dataset }), {
  ignoreKeys: ['generatedAt'],
});
console.log(
  `[league-history] ${SLUG}: ${dataset.games.length} games, ${dataset.seasons.length} seasons ` +
    `(${dataset.firstSeason}-${dataset.lastSeason}) -> ${path.relative(ROOT, OUT)}${wrote ? '' : ' (unchanged)'}`
);
