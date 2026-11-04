#!/usr/bin/env node
/**
 * Write each past season's end-of-season rosters, for every league whose
 * rosters page offers old seasons.
 *
 * MFL's rosters export for an old league year has lost every player whose
 * contract has since expired (scripts/lib/season-end-rosters.mjs explains
 * why and how this rebuilds them). For each completed season this writes
 *
 *   data/<league>/mfl-feeds/<year>/rosters-season-end.json
 *
 * in the rosters.json shape: the export plus every player the season's
 * last-regular-season-week lineups name that the export lost. A season the
 * export already covers in full gets no file, and a stale one is removed.
 * The rosters pages read this file in place of rosters.json when it exists;
 * TheLeague's derived payloads (compute-roster-season-payloads.mjs) do too.
 *
 * The fetcher never writes this filename, so a backfill of rosters.json
 * leaves it alone. Re-run after one: `pnpm compute:season-end-rosters`.
 */

import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { getCurrentYears } from './lib/league-years.mjs';
import { writeJsonIfChanged } from './lib/canonical-json.mjs';
import {
  lineupsForWeek,
  restoreSeasonEndRosters,
  seasonSigningPrices,
} from './lib/season-end-rosters.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Leagues whose rosters page offers past seasons from committed feeds. */
const LEAGUES = ['theleague', 'afl-fantasy'];

export const SEASON_END_FILE = 'rosters-season-end.json';

const readJson = (path) => {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.warn(`[season-end-rosters] failed to read ${path}: ${e.message}`);
  }
  return null;
};

/**
 * The week whose lineups define "finished the season on the team": the last
 * regular-season week, after which only playoff teams still set lineups and
 * eliminated owners start clearing benches.
 */
const seasonEndWeek = (leagueFeed) => {
  const week = Number(leagueFeed?.league?.lastRegularSeasonWeek);
  return Number.isFinite(week) && week > 0 ? week : null;
};

/**
 * TheLeague froze each season's contracts into src/data/mfl-player-salaries-
 * <year>.json; for the seasons fetched while the contracts still existed it
 * holds the salary and years MFL's export has since lost.
 */
const frozenContracts = (slug, year) => {
  if (slug !== 'theleague') return new Map();
  const file = readJson(join(ROOT, 'src', 'data', `mfl-player-salaries-${year}.json`));
  const contracts = new Map();
  for (const p of file?.players ?? []) {
    const salary = Number(p?.salary);
    if (!p?.id || !p.franchiseId || p.franchiseId === 'FA' || !(salary > 0)) continue;
    contracts.set(p.id, { salary, contractYear: p.contractYear });
  }
  return contracts;
};

/** One season's restored feed, or null when the export already covers it. */
export function buildSeasonEndRosters(yearDir, contracts = new Map()) {
  const rosters = readJson(join(yearDir, 'rosters.json'));
  const weekly = readJson(join(yearDir, 'weekly-results-raw.json'));
  const week = seasonEndWeek(readJson(join(yearDir, 'league.json')));
  if (!rosters?.rosters || !weekly || !week) return null;

  const lineups = lineupsForWeek(weekly, week);
  if (!lineups.size) return null;
  const prices = seasonSigningPrices(
    readJson(join(yearDir, 'auctionResults.json')),
    readJson(join(yearDir, 'transactions.json')),
  );
  const { feed, restored } = restoreSeasonEndRosters(rosters, lineups, prices, contracts);
  if (!restored) return null;
  return { feed: { ...feed, seasonEnd: { week, restored } }, restored, week };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const { currentLeagueYear, currentSeasonYear } = getCurrentYears();
  const liveYears = new Set([String(currentLeagueYear), String(currentSeasonYear)]);

  for (const slug of LEAGUES) {
    const feedsDir = join(ROOT, getLeagueBySlug(slug).dataPath, 'mfl-feeds');
    const years = readdirSync(feedsDir).filter((name) => /^\d{4}$/.test(name)).sort();
    const summary = [];
    for (const year of years) {
      const yearDir = join(feedsDir, year);
      const outPath = join(yearDir, SEASON_END_FILE);
      const result = liveYears.has(year) ? null : buildSeasonEndRosters(yearDir, frozenContracts(slug, year));
      if (!result) {
        if (existsSync(outPath)) rmSync(outPath);
        continue;
      }
      writeJsonIfChanged(outPath, result.feed);
      summary.push(`${year}:+${result.restored}`);
    }
    console.log(`[season-end-rosters] ${slug} ${summary.join(' ') || 'nothing to restore'}`);
  }
}
