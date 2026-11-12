#!/usr/bin/env node
/**
 * Playoff odds — weekly derived data for every league with a registry
 * `playoffOdds` format.
 *
 * Runs the rest of the regular season 10,000 times (src/utils/playoff-odds.mjs)
 * from the committed MFL feeds and writes
 * data/<league>/derived/playoff-odds-<year>-w<NN>.json, where NN is the
 * UPCOMING week (last completed + 1), the same convention as The Gauntlet's
 * files. One file feeds every surface — the Playoff Odds page, the standings
 * Playoff tab and the Saturday Matchup Preview — so they never disagree.
 *
 * The draw is seeded and the file carries no clock, so a re-run over unchanged
 * feeds writes nothing (writeJsonIfChanged).
 *
 * Usage:
 *   node scripts/compute-playoff-odds.mjs
 *   node scripts/compute-playoff-odds.mjs --league theleague --dry-run
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import { writeJsonIfChanged } from './lib/canonical-json.mjs';
import { tryLoadJSON } from './article-utils/data-loaders.mjs';
import { getSeasonYear } from './article-utils/week-resolver.mjs';
import { buildOddsInput, playoffOddsReport } from '../src/utils/playoff-odds.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export function playoffOddsPath(league, year, week) {
  return path.join(league.dataPath, 'derived', `playoff-odds-${year}-w${String(week).padStart(2, '0')}.json`);
}

function parseArgs(argv) {
  const opts = { league: null, year: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--league') opts.league = argv[++i];
    else if (a.startsWith('--league=')) opts.league = a.slice('--league='.length);
    else if (a === '--year') opts.year = Number.parseInt(argv[++i], 10);
    else if (a === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

/** Compute one league's odds; returns the written payload, or null when there is nothing to say. */
export async function runLeague(slug, { year = getSeasonYear(), dryRun = false } = {}) {
  const league = LEAGUES[slug];
  if (!league?.playoffOdds) return null;
  const feedDir = path.join(projectRoot, league.dataPath, 'mfl-feeds', String(year));
  const [leagueJson, standings, schedule] = await Promise.all([
    tryLoadJSON(path.join(feedDir, 'league.json')),
    tryLoadJSON(path.join(feedDir, 'standings.json')),
    tryLoadJSON(path.join(feedDir, 'schedule.json')),
  ]);
  if (!leagueJson || !schedule) {
    console.log(`  [${slug}] ${year}: no league.json/schedule.json — skipping`);
    return null;
  }

  const input = buildOddsInput({ league: leagueJson, standings, schedule, format: league.playoffOdds });
  if (input.completedWeek < 1) {
    console.log(`  [${slug}] ${year}: no completed week yet — skipping`);
    return null;
  }
  if (input.remaining.length === 0) {
    // The regular season is over: the last week's file stays as the final word.
    console.log(`  [${slug}] ${year}: regular season complete — keeping the last file`);
    return null;
  }

  const report = playoffOddsReport(input);
  const payload = { league: slug, year, ...report };
  const rel = playoffOddsPath(league, year, report.week);
  if (dryRun) {
    console.log(`  [${slug}] dry-run — would write ${rel}`);
  } else {
    const wrote = writeJsonIfChanged(path.join(projectRoot, rel), payload);
    console.log(`  [${slug}] ${wrote ? 'wrote' : 'unchanged'} ${rel}`);
  }
  return payload;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const slugs = Object.keys(LEAGUES).filter((s) => LEAGUES[s].playoffOdds && (!opts.league || s === opts.league));
  if (opts.league && slugs.length === 0) {
    console.error(`--league ${opts.league} has no playoffOdds format in the registry`);
    process.exit(1);
  }
  console.log(`\n🏈 Playoff odds — ${slugs.join(', ')}\n`);
  for (const slug of slugs) {
    try {
      await runLeague(slug, { year: opts.year ?? undefined, dryRun: opts.dryRun });
    } catch (err) {
      // One league's bad feed must not cost the others their odds.
      console.error(`  [${slug}] failed: ${err.message}`);
    }
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
