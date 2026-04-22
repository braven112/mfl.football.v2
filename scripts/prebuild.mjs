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

import { execSync } from 'child_process';

const SEQUENTIAL = [
  { name: 'build:styles', cmd: 'pnpm run build:styles' },
  { name: 'build:bookmarklets', cmd: 'pnpm run build:bookmarklets' },
  { name: 'update:salary:all', cmd: 'pnpm run update:salary:all' },
];

const PARALLEL = [
  { name: 'fetch:live:lineups', cmd: 'pnpm run fetch:live:lineups' },
  { name: 'fetch:trade-bait', cmd: 'pnpm run fetch:trade-bait' },
  { name: 'fetch:adp', cmd: 'pnpm run fetch:adp' },
  { name: 'fetch:nfl-draft-date', cmd: 'pnpm run fetch:nfl-draft-date' },
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
// Use Promise.all with child_process.exec for true parallelism
import('child_process').then(({ exec }) => {
  const promises = PARALLEL.map(
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
  );

  Promise.all(promises).then(() => {
    console.log(`[prebuild] Done in ${Date.now() - totalStart}ms`);
  });
});
