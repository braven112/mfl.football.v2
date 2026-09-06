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
 *
 * PREVIEW BUILDS RUN A SLIM SUBSET. Build CPU Minutes were 91% of the Vercel
 * bill (see scripts/vercel-ignore-build.mjs for the numbers), and every preview
 * of a CSS-only change was re-running 8 network fetches and 10 recomputes whose
 * outputs are already committed to the repo. Steps marked `previewSkip` are
 * skipped when VERCEL_ENV=preview, so the build reads the committed artifact
 * instead — which is exactly what `pnpm dev` does locally.
 *
 * Verified before marking any step: running the compute steps against a clean
 * tree reproduced the committed files byte-for-byte apart from their
 * `generatedAt` stamp. The one genuine difference is compute:afl-free-agents,
 * whose input is live — a preview showing free agents from the last production
 * build is the accepted trade, not a bug.
 *
 * TWO ESCAPE HATCHES, because a slim preview is wrong when the PR is about the
 * pipeline itself:
 *   - PREBUILD_FULL=1 forces the complete run.
 *   - A diff touching scripts/ (a compute/fetch script or scripts/lib/) forces
 *     it automatically — otherwise a PR changing how a file is derived would
 *     preview against the OLD derived file and look like it did nothing.
 */

import { exec, execSync } from 'child_process';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

const SEQUENTIAL = [
  { name: 'build:styles', cmd: 'pnpm run build:styles' },
  { name: 'build:bookmarklets', cmd: 'pnpm run build:bookmarklets' },
  { name: 'update:salary:all', cmd: 'pnpm run update:salary:all' },
  { name: 'compute:franchise-history', cmd: 'pnpm run compute:franchise-history', previewSkip: true },
  { name: 'compute:afl-free-agents', cmd: 'pnpm run compute:afl-free-agents', previewSkip: true },
  // compute:franchise-history above defaults to TheLeague, so the AFL's copy
  // was only ever refreshed by hand or by the backfill workflow — it went stale
  // against its own committed feeds between runs. Adding the record book to
  // this list without this made that asymmetry worse, since the book would
  // rebuild every deploy while the history it sits beside did not.
  { name: 'compute:afl-franchise-history', cmd: 'pnpm run compute:afl-franchise-history', previewSkip: true },
  // Reads the same committed feeds as the history step; the record book is a
  // small top-N slice written to its own derived file.
  { name: 'compute:afl-record-book', cmd: 'pnpm run compute:afl-record-book', previewSkip: true },
  // Rolls every season's players.json into one identity table. Must run after
  // the feed sync so the current season is current; the older seasons in it
  // never change. getGlobalPlayerMap() reads only this file — see the note
  // there on why deriving it at request time was costing 23.5 MB per cold
  // start and dragging all of data/ into the serverless bundle.
  { name: 'compute:player-identity-union', cmd: 'pnpm run compute:player-identity-union', previewSkip: true },
  // Same artifact for the AFL. Its Draft Results page reaches back to 2003,
  // but AFL players.json only exists from 2011 — so this union is the AFL
  // half of the lookup and TheLeague's is the fallback for the rest (MFL
  // player ids are global, so the two compose).
  { name: 'compute:player-identity-union:afl', cmd: 'pnpm run compute:player-identity-union:afl', previewSkip: true },
  // Rebuilds the frozen roster payloads for every HISTORICAL TheLeague season
  // (current league/season years stay live on the page). Runs after the
  // identity union for the same reason as it: the committed feeds it reads
  // never change for past seasons, so this is a no-op unless the payload
  // logic in scripts/lib/roster-season-payload.mjs changed.
  { name: 'compute:roster-payloads', cmd: 'pnpm run compute:roster-payloads', previewSkip: true },
];

const PARALLEL = [
  // Pure local compute (feeds already on disk, no network, independent
  // output dir) — overlaps with the network fetches instead of serializing
  // onto the build critical path.
  { name: 'compute:schedule-strength', cmd: 'pnpm run compute:schedule-strength', previewSkip: true },
  // Reads only committed mfl-feeds + championship-history.json, so it has no
  // ordering relationship with anything else here.
  { name: 'compute:playoff-performance', cmd: 'pnpm run compute:playoff-performance', previewSkip: true },
  // Reads the season ledgers that compute:franchise-history (SEQUENTIAL, above)
  // writes. PARALLEL starts only after SEQUENTIAL finishes, so the dependency
  // holds without serializing this onto the critical path.
  // Chained, not two entries: compute:division-strength reads the owner tenures
  // the first command writes, and PARALLEL has no intra-list ordering — two
  // separate entries would race and the division report would be built against
  // whatever owner file happened to be on disk. Chaining keeps the dependency
  // without moving either onto the sequential critical path. (Both read the
  // season ledgers that compute:franchise-history writes in SEQUENTIAL above;
  // PARALLEL starts only after SEQUENTIAL finishes, so that half holds already.)
  {
    name: 'compute:owner-tenures → division-strength',
    cmd: 'pnpm run compute:owner-tenures && pnpm run compute:division-strength',
    previewSkip: true,
  },
  { name: 'fetch:live:lineups', cmd: 'pnpm run fetch:live:lineups', previewSkip: true },
  { name: 'fetch:trade-bait', cmd: 'pnpm run fetch:trade-bait', previewSkip: true },
  { name: 'fetch:adp', cmd: 'pnpm run fetch:adp', previewSkip: true },
  { name: 'fetch:ranking-sources', cmd: 'pnpm run fetch:ranking-sources', previewSkip: true },
  { name: 'fetch:nfl-draft-date', cmd: 'pnpm run fetch:nfl-draft-date', previewSkip: true },
  { name: 'fetch:espn-ids', cmd: 'pnpm run fetch:espn-ids', previewSkip: true },
  { name: 'fetch:nfl-news-digest', cmd: 'pnpm run fetch:nfl-news-digest', previewSkip: true },
  { name: 'fetch:nfl-dark-logos', cmd: 'pnpm run fetch:nfl-dark-logos', previewSkip: true },
  { name: 'fetch:college-dark-logos', cmd: 'pnpm run fetch:college-dark-logos', previewSkip: true },
];

/**
 * Scripts whose contents decide what a skippable step produces, derived from the
 * steps themselves rather than hand-listed — add a step and its script is
 * watched automatically, which a prefix list silently would not do (the first
 * version of this missed prebuild.mjs itself).
 */
export const pipelineScripts = () => {
  const { scripts = {} } = JSON.parse(readFileSync('package.json', 'utf8'));
  const files = new Set(['scripts/prebuild.mjs']);

  for (const step of [...SEQUENTIAL, ...PARALLEL]) {
    if (!step.previewSkip) continue;
    for (const [, task] of step.cmd.matchAll(/pnpm run ([\w:-]+)/g)) {
      const path = scripts[task]?.match(/(scripts\/[\w./-]+)/)?.[1];
      if (path) files.add(path);
    }
  }
  return files;
};

/**
 * True when a changed file could alter what a skipped step would have written.
 *
 * Three shapes, because the scripts are only the entry points:
 *   - the derived script set above, plus this orchestrator;
 *   - scripts/lib/, which they all import from;
 *   - any .mjs under src/. That is exactly the node-shared surface the compute
 *     scripts pull their real logic from — owner-tenures, division-strength,
 *     playoff-entry-brackets, leagues-data and nine others. Pages are .astro
 *     and .ts and cannot reach a derived file, so this stays narrow (34 files)
 *     while covering the whole dependency.
 */
export const isPipelineFile = (file, scripts = pipelineScripts()) =>
  scripts.has(file) ||
  file.startsWith('scripts/lib/') ||
  (file.startsWith('src/') && file.endsWith('.mjs'));

/**
 * Files changed on this branch relative to main, or null if that cannot be
 * determined — in which case the caller must run everything.
 *
 * Compared against origin/main, NOT VERCEL_GIT_PREVIOUS_SHA. That variable is
 * the last successful DEPLOYMENT, so on a branch's second push the diff covers
 * only that push: a pipeline change made in push 1 would go slim from push 2
 * onward, previewing against stale derived files. Vercel clones shallow, so
 * main is fetched at depth 1 first, and the comparison is two-dot (no merge
 * base exists in a shallow clone) — that over-reports by including what main
 * moved on, which errs toward FULL.
 */
export const changedVsMain = (runner = execSync) => {
  const git = (cmd) => runner(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    try {
      git('git rev-parse --verify origin/main');
    } catch {
      git('git fetch --depth=1 origin main:refs/remotes/origin/main');
    }
    return git('git diff --name-only origin/main HEAD')
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
};

/**
 * Why this build is slim, or null to run everything.
 *
 * Every uncertain case resolves to FULL: not a preview, an explicit override,
 * an unresolvable diff, or a diff that touches the pipeline.
 */
export const resolveSlimReason = (env = process.env, changed = changedVsMain()) => {
  if (env.VERCEL_ENV !== 'preview') return null;
  if (env.PREBUILD_FULL === '1') return null;
  if (changed === null) return null;
  if (changed.some((f) => isPipelineFile(f))) return null;
  return 'preview build — reading committed data artifacts';
};

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

async function main() {
const totalStart = Date.now();

const slimReason = resolveSlimReason();
/** Drop the steps this build does not need to run. */
const applicable = (steps) => (slimReason ? steps.filter((s) => !s.previewSkip) : steps);

const sequential = applicable(SEQUENTIAL);
const parallel = applicable(PARALLEL);

if (slimReason) {
  const skipped = SEQUENTIAL.length + PARALLEL.length - sequential.length - parallel.length;
  console.log(`[prebuild] SLIM: ${slimReason}`);
  console.log(`[prebuild] Skipping ${skipped} step(s). PREBUILD_FULL=1 to run everything.`);
  for (const { name } of [...SEQUENTIAL, ...PARALLEL].filter((s) => s.previewSkip)) {
    console.log(`  – skipped ${name}`);
  }
}

console.log('[prebuild] Starting sequential steps…');
for (const { name, cmd } of sequential) {
  run(name, cmd);
}

console.log('[prebuild] Starting parallel fetches…');
// exec (not execSync) for true parallelism; awaited at top level so the
// script's lifetime explicitly covers every child instead of relying on the
// event loop staying alive. Failures stay non-fatal (resolve, never reject).
await Promise.all(
  parallel.map(
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
}

// Only run when executed directly, so tests can import the decision helpers.
// pathToFileURL, not `file://` + argv[1] — import.meta.url is percent-encoded,
// so a repo path with a space breaks a naive comparison.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
