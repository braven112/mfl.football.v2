#!/usr/bin/env node
/**
 * Prebuild orchestrator — runs build steps and network fetches
 * with maximum parallelism while respecting dependency order.
 *
 * Sequential (must run first, in order):
 *   1. build:styles
 *   2. build:bookmarklets
 *   3. update:salary:all
 *
 * Parallel (independent network fetches, run concurrently after sequential):
 *   - fetch:live:lineups
 *   - fetch:trade-bait
 *   - fetch:adp
 */

import { exec, execSync } from 'child_process';

const SEQUENTIAL = [
  { name: 'build:styles', cmd: 'pnpm run build:styles' },
  { name: 'build:bookmarklets', cmd: 'pnpm run build:bookmarklets' },
  { name: 'update:salary:all', cmd: 'pnpm run update:salary:all' },
  { name: 'compute:franchise-history', cmd: 'pnpm run compute:franchise-history' },
  { name: 'compute:afl-free-agents', cmd: 'pnpm run compute:afl-free-agents' },
  // compute:franchise-history above defaults to TheLeague, so the AFL's copy
  // was only ever refreshed by hand or by the backfill workflow — it went stale
  // against its own committed feeds between runs. Adding the record book to
  // this list without this made that asymmetry worse, since the book would
  // rebuild every deploy while the history it sits beside did not.
  { name: 'compute:afl-franchise-history', cmd: 'pnpm run compute:afl-franchise-history' },
  // Reads the same committed feeds as the history step; the record book is a
  // small top-N slice written to its own derived file.
  { name: 'compute:afl-record-book', cmd: 'pnpm run compute:afl-record-book' },
  // Rolls every season's players.json into one identity table. Must run after
  // the feed sync so the current season is current; the older seasons in it
  // never change. getGlobalPlayerMap() reads only this file — see the note
  // there on why deriving it at request time was costing 23.5 MB per cold
  // start and dragging all of data/ into the serverless bundle.
  { name: 'compute:player-identity-union', cmd: 'pnpm run compute:player-identity-union' },
  // Rebuilds the frozen roster payloads for every HISTORICAL TheLeague season
  // (current league/season years stay live on the page). Runs after the
  // identity union for the same reason as it: the committed feeds it reads
  // never change for past seasons, so this is a no-op unless the payload
  // logic in scripts/lib/roster-season-payload.mjs changed.
  { name: 'compute:roster-payloads', cmd: 'pnpm run compute:roster-payloads' },
];

const PARALLEL = [
  // Pure local compute (feeds already on disk, no network, independent
  // output dir) — overlaps with the network fetches instead of serializing
  // onto the build critical path.
  { name: 'compute:schedule-strength', cmd: 'pnpm run compute:schedule-strength' },
  { name: 'fetch:live:lineups', cmd: 'pnpm run fetch:live:lineups' },
  { name: 'fetch:trade-bait', cmd: 'pnpm run fetch:trade-bait' },
  { name: 'fetch:adp', cmd: 'pnpm run fetch:adp' },
  { name: 'fetch:nfl-draft-date', cmd: 'pnpm run fetch:nfl-draft-date' },
  { name: 'fetch:nfl-news-digest', cmd: 'pnpm run fetch:nfl-news-digest' },
  { name: 'fetch:nfl-dark-logos', cmd: 'pnpm run fetch:nfl-dark-logos' },
  { name: 'fetch:college-dark-logos', cmd: 'pnpm run fetch:college-dark-logos' },
];

const run = (label, cmd) => {
  const start = Date.now();
  try {
    execSync(cmd, { stdio: 'inherit' });
    console.log(`  ✓ ${label} (${Date.now() - start}ms)`);
  } catch (err) {
    console.error(`  ✗ ${label} failed (${Date.now() - start}ms)`);
    // Non-fatal: let build continue even if a fetch fails
  }
};

const totalStart = Date.now();
console.log('[prebuild] Starting sequential steps…');
for (const { name, cmd } of SEQUENTIAL) {
  run(name, cmd);
}

console.log('[prebuild] Starting parallel fetches…');
// exec (not execSync) for true parallelism; awaited at top level so the
// script's lifetime explicitly covers every child instead of relying on the
// event loop staying alive. Failures stay non-fatal (resolve, never reject).
await Promise.all(
  PARALLEL.map(
    ({ name, cmd }) =>
      new Promise((resolve) => {
        const start = Date.now();
        const child = exec(cmd, (err) => {
          if (err) {
            console.error(`  ✗ ${name} failed (${Date.now() - start}ms)`);
          } else {
            console.log(`  ✓ ${name} (${Date.now() - start}ms)`);
          }
          resolve();
        });
        // Pipe output
        child.stdout?.pipe(process.stdout);
        child.stderr?.pipe(process.stderr);
      })
  )
);
console.log(`[prebuild] Done in ${Date.now() - totalStart}ms`);
