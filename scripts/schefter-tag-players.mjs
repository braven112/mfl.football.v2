#!/usr/bin/env node
/**
 * Schefter player tagging — stamp `playerIds` onto feed posts that only name
 * players in prose, so My Watch List can highlight them.
 *
 * Runs after every scanner in the Schefter Scan workflow (and once by hand as
 * the backfill). Idempotent: a post is re-read on every run, but only a post
 * that gains an id is rewritten, and the file is written only when the feed
 * changed semantically (writeJsonIfChanged), so a quiet run is a no-op commit.
 *
 * Usage:
 *   node scripts/schefter-tag-players.mjs                # every league
 *   node scripts/schefter-tag-players.mjs --league afl   # one league
 *   node scripts/schefter-tag-players.mjs --dry-run      # report, write nothing
 *
 * The matcher is src/utils/schefter-player-tagger.mjs — read its header for
 * the rules (full names only, ambiguity → tag all unless the text narrows it,
 * never a team defense).
 */

import { promises as fs } from 'node:fs';
import { SCHEFTER_LEAGUES, getSchefterLeague } from './lib/schefter-leagues.mjs';
import { leagueYearFor } from './lib/schefter-league-year.mjs';
import { writeJsonIfChanged } from './lib/canonical-json.mjs';
import { buildPlayerNameIndex, tagFeed } from '../src/utils/schefter-player-tagger.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const leagueArg = (() => {
  const i = args.indexOf('--league');
  return i >= 0 ? args[i + 1] : null;
})();

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Load the players export for the league year, falling back a year when it is not there yet. */
async function loadPlayers(league) {
  const year = leagueYearFor(league);
  for (const y of [year, year - 1]) {
    const json = await readJson(league.playersPath(y));
    const rows = json?.players?.player;
    if (rows) return { year: y, rows: Array.isArray(rows) ? rows : [rows] };
  }
  return { year, rows: [] };
}

async function tagLeague(league) {
  const feed = await readJson(league.feedPath);
  if (!feed?.posts) {
    console.log(`  [${league.slug}] no feed at ${league.feedPath} — skipping.`);
    return;
  }
  const { year, rows } = await loadPlayers(league);
  if (rows.length === 0) {
    console.log(`  [${league.slug}] no players export for ${year} — skipping.`);
    return;
  }
  const index = buildPlayerNameIndex(rows);
  const { feed: tagged, changed } = tagFeed(feed, index);
  const withIds = tagged.posts.filter((p) => Array.isArray(p.playerIds) && p.playerIds.length > 0).length;
  console.log(
    `  [${league.slug}] ${feed.posts.length} posts, ${changed} gained ids this run, ${withIds} carry ids.`,
  );
  if (changed === 0 || DRY_RUN) return;
  const wrote = writeJsonIfChanged(league.feedPath, tagged);
  console.log(`  [${league.slug}] ${wrote ? 'wrote' : 'unchanged'} ${league.feedPath}`);
}

async function main() {
  const leagues = leagueArg ? [getSchefterLeague(leagueArg)] : SCHEFTER_LEAGUES;
  console.log(`[schefter-tag-players] ${DRY_RUN ? 'dry run — ' : ''}${leagues.length} league(s)`);
  for (const league of leagues) await tagLeague(league);
}

main().catch((err) => {
  // Tagging is an enrichment; a failure here must never fail the scan job.
  console.warn('[schefter-tag-players] failed:', err?.message ?? err);
  process.exit(0);
});
