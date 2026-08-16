/**
 * Which archived MFL feed files must NOT be copied into the serverless function.
 *
 * Several utils read feeds with `join(process.cwd(), dataPath, 'mfl-feeds', …)`
 * — a path Vercel's file tracer cannot resolve, so it gives up and copies the
 * ENTIRE `data/` tree into the function. That was 166 MB of a 263 MB bundle
 * against a 250 MB limit, and it is pure duplication: pages that render
 * historical seasons reach them through `import.meta.glob`, which compiles the
 * JSON into `dist/server/chunks/` at build time. The raw copy is only needed by
 * the handful of `fs` readers, and every one of those reads the current or
 * prior season:
 *
 *   - rosters.astro's `feedYears` is `[currentLeagueYear, currentSeasonYear]`
 *   - schefter-og tries `[year, year - 1]`
 *   - live-scoring scans newest-first and stops at the first complete season
 *
 * So keep the newest few seasons per league and drop the rest.
 *
 * Two properties worth preserving if you change this:
 *
 *   - It is derived from what is on disk, never pinned to a year, so it needs
 *     no maintenance at either league's rollover.
 *   - `SEASONS_KEPT` is 3, not 2, on purpose. A new year's directory is created
 *     at rollover before it holds real data, and it must not be able to push a
 *     season that is still being read out of the bundle.
 *
 * Excluding a file here can only affect `fs` reads — anything a glob pulls in
 * is compiled into `dist/` and unaffected.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Seasons per league whose raw feeds stay reachable at request time. */
export const SEASONS_KEPT = 3;

/**
 * Per-season MFL exports that no season of belongs in the function, because
 * nothing in src/ references them by any path — static, dynamic or glob.
 */
export const NEVER_SHIPPED_FEEDS = ['option07.json'];

const LEAGUE_DIRS = ['theleague', 'afl-fantasy'];

function walkFiles(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
}

/**
 * @param {{ root?: string, leagues?: string[], seasonsKept?: number }} [opts]
 * @returns {string[]} repo-relative paths to exclude from the Vercel function
 */
export function archivedFeedFiles(opts = {}) {
  const { root = '', leagues = LEAGUE_DIRS, seasonsKept = SEASONS_KEPT } = opts;
  const excluded = [];

  for (const league of leagues) {
    const feedsDir = join(root, 'data', league, 'mfl-feeds');
    let years;
    try {
      years = readdirSync(feedsDir).filter((n) => /^\d{4}$/.test(n));
    } catch {
      continue; // league has no feed archive — nothing to exclude
    }
    // Newest first, numerically: a lexical sort would be fine for 4-digit years
    // but silently wrong the moment anything else lands in here.
    years.sort((a, b) => Number(b) - Number(a));

    for (const year of years.slice(seasonsKept)) {
      const yearDir = join(feedsDir, year);
      try {
        if (statSync(yearDir).isDirectory()) walkFiles(yearDir, excluded);
      } catch {
        // raced a sync job writing the dir — skip rather than fail the build
      }
    }

    for (const year of years.slice(0, seasonsKept)) {
      for (const name of NEVER_SHIPPED_FEEDS) {
        const p = join(feedsDir, year, name);
        try {
          statSync(p);
          excluded.push(p);
        } catch {
          // not every season has one
        }
      }
    }
  }

  return excluded;
}
