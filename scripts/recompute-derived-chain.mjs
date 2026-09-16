#!/usr/bin/env node
/**
 * The franchise-history derived chain — recomputed, and committed, as ONE unit.
 *
 *   compute-franchise-history.mjs --league=<each>   franchise-history.json
 *                                                    + season-ledger.json
 *   compute-owner-tenures.mjs                        owner-tenures.json      (reads the ledger)
 *   compute-division-strength.mjs                    division-strength.json  (reads ledger + tenures
 *                                                                             + live schedule.json)
 *
 * Every file is derived from the ones above it, and the data tests demand
 * row-for-row agreement between them: season-ledger.test.ts compares each
 * attributed ledger row to its yearByYear entry, division-strength-data.test.ts
 * carries every played ledger row into a division unchanged. So committing a
 * SUBSET of a regenerated chain breaks main.
 *
 * Sept 2026: three workflows each committed a different subset. The Schefter
 * nightly committed TheLeague's franchise-history.json but not its ledger;
 * fetch-owner-names committed tenures + division strength against whatever
 * ledger was on disk; and nothing committed the AFL's history at all, while
 * roster-sync kept committing the 2026 schedules division strength replays. It
 * held only because 2026 had no results yet. Recomputing the whole chain from
 * the week-1 feeds passes every guard suite; any partial commit fails one.
 *
 * This script is the only thing a committing workflow may call.
 * tests/derived-chain-lane.test.ts fails on a workflow that runs a producer
 * directly or names a chain file instead of committing `--print-outputs`.
 * prebuild.mjs runs the same producers at deploy time and commits nothing.
 *
 * MILESTONE POSTS. The committed franchise-history.json is the baseline
 * diffNewAwards compares against, so an award written into a committed snapshot
 * without its post is never posted. `--emit-milestone-posts` is forwarded to the
 * history runs, which do exactly that diff and write the posts into the feed
 * that `--print-outputs` lists beside the snapshot. It refuses to run when a
 * snapshot on disk already differs from HEAD, because the diff would then be
 * against a snapshot nobody committed.
 *
 * Usage:
 *   node scripts/recompute-derived-chain.mjs --emit-milestone-posts   # a lane that commits
 *   node scripts/recompute-derived-chain.mjs                          # look, don't post
 *   node scripts/recompute-derived-chain.mjs --print-outputs [--sep=' ']
 *   node scripts/recompute-derived-chain.mjs --print-guard-tests
 *
 * Committing by hand: start from main's derived files, run with
 * --emit-milestone-posts, run the guard tests, and commit every path
 * --print-outputs lists (git ignores the ones that did not change).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { EMIT_MILESTONE_POSTS_FLAG } from './lib/franchise-milestone-posts.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Per-league derived files the chain writes, in dependency order. */
export const CHAIN_FILES = [
  'franchise-history.json',
  'season-ledger.json',
  'owner-tenures.json',
  'division-strength.json',
];

/**
 * The data suites a lane must pass before it commits. Every one reads a chain
 * file from disk and compares it against another chain file or against the
 * feeds, so a lane that fails them commits nothing and main keeps the last set
 * that agreed:
 *
 *   season-ledger                      each attributed row vs its yearByYear
 *                                      entry, and the row count vs the feeds'
 *                                      own standings
 *   owner-tenures-data                 every ledger row on exactly one owner
 *   division-strength-data             every played ledger row in exactly one
 *                                      division, carried through unchanged
 *   owner-boundary-parity              the shared attributor over the real
 *                                      ledger, plus the no-local-walk-back scan
 *   owners-registry                    the registry owner tenures are built from
 *   franchise-history-season-complete  the snapshot's own seasonComplete verdict
 *   theleague-division-titles          division titles vs that season's feeds
 *   historical-divisions               divisions vs each year's league.json
 *   playoff-field-size                 the ledger vs the bracket feeds
 *   rivalries                          the head-to-head ledger in the snapshot
 *   afl-awards                         awards-history vs the AFL snapshot on
 *                                      which slot won each title/division
 *
 * NOT here: `tests/record-book.test.ts`. The record book is a different
 * producer (`compute-record-book.mjs`, built straight from the feeds and
 * deliberately not from the snapshot), the chain never writes it, and that
 * suite pins its own season constants — so gating on it would let a stale
 * record book block a chain commit that is perfectly consistent.
 */
export const CHAIN_GUARD_TESTS = [
  'tests/season-ledger.test.ts',
  'tests/owner-tenures-data.test.ts',
  'tests/division-strength-data.test.ts',
  'tests/owner-boundary-parity.test.ts',
  'tests/owners-registry.test.ts',
  'tests/franchise-history-season-complete-data.test.ts',
  'tests/theleague-division-titles.test.ts',
  'tests/historical-divisions.test.ts',
  'tests/playoff-field-size.test.ts',
  'tests/rivalries.test.ts',
  'tests/afl-awards.test.ts',
];

/**
 * Leagues that run the pipeline: the ones with a committed franchise history.
 * Same structural skip every consumer uses, which is how best-ball-1 stays out.
 */
export const chainLeagues = (root = ROOT) =>
  ALL_LEAGUES.filter((league) =>
    fs.existsSync(path.join(root, league.dataPath, 'derived', 'franchise-history.json'))
  );

export const chainSteps = ({ emitMilestonePosts = false, root = ROOT } = {}) => [
  ...chainLeagues(root).map((league) => ({
    label: `franchise-history + season-ledger (${league.slug})`,
    script: 'scripts/compute-franchise-history.mjs',
    args: [`--league=${league.slug}`, ...(emitMilestonePosts ? [EMIT_MILESTONE_POSTS_FLAG] : [])],
  })),
  // Both iterate every league themselves, skipping one with no ledger.
  { label: 'owner-tenures', script: 'scripts/compute-owner-tenures.mjs', args: [] },
  { label: 'division-strength', script: 'scripts/compute-division-strength.mjs', args: [] },
];

const derivedPath = (league, file) => path.posix.join(league.dataPath, 'derived', file);

/** Repo-relative derived files, every league × every chain file. */
export const chainDerivedFiles = (root = ROOT) =>
  chainLeagues(root).flatMap((league) => CHAIN_FILES.map((file) => derivedPath(league, file)));

/**
 * Everything a lane commits: the derived files plus each chain league's
 * Schefter feed, the only other file a history run writes (milestone posts).
 * The feed path comes from the registry.
 */
export const chainOutputs = (root = ROOT) => [
  ...chainDerivedFiles(root),
  ...chainLeagues(root)
    .map((league) => league.schefterFeedPath)
    .filter(Boolean),
];

const withoutGeneratedAt = (text) => {
  const value = JSON.parse(text);
  if (value && typeof value === 'object' && !Array.isArray(value)) delete value.generatedAt;
  return JSON.stringify(value);
};

/**
 * True when two serializations differ only in their top-level `generatedAt`.
 *
 * Deliberately NOT `jsonEquivalent(a, b, { ignoreKeys: ['generatedAt'] })` from
 * scripts/lib/canonical-json.mjs, which is the right tool one layer down: it is
 * order-BLIND because MFL returns arrays in arbitrary order, so a producer whose
 * row order genuinely changed reads as equal there. These files are written by
 * our own deterministic code, this decides whether to throw away bytes already
 * on disk, and a reordered `yearByYear` is a real rewrite — so the comparison
 * here is order-sensitive.
 */
export const isTimestampOnlyChange = (before, after) => {
  if (before === after) return true;
  try {
    return withoutGeneratedAt(before) === withoutGeneratedAt(after);
  } catch {
    return false;
  }
};

const headContent = (file) => {
  try {
    return execFileSync('git', ['show', `HEAD:${file}`], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null; // untracked, or not a git checkout
  }
};

/**
 * Put back the committed bytes of any derived file whose only change is its
 * timestamp. Every producer stamps `generatedAt` on every run, so without this
 * a quiet day commits a timestamp-only rewrite of several megabytes (the
 * nightly did exactly that to franchise-history.json every day).
 */
/**
 * The file's current bytes, or null if it is not there. Reads and handles the
 * failure rather than asking `existsSync` first: the answer to that question is
 * already stale by the time the read runs (CodeQL js/file-system-race), and a
 * producer that wrote nothing should skip, not throw.
 */
const currentContent = (abs) => {
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
};

function restoreTimestampOnlyRewrites() {
  const restored = [];
  for (const file of chainDerivedFiles()) {
    const abs = path.join(ROOT, file);
    const current = currentContent(abs);
    if (current === null) continue;
    const committed = headContent(file);
    if (committed === null) continue;
    if (current !== committed && isTimestampOnlyChange(committed, current)) {
      fs.writeFileSync(abs, committed);
      restored.push(file);
    }
  }
  return restored;
}

/**
 * The milestone baseline must be what is committed, or awards go unposted.
 *
 * Fails closed on a snapshot that is on disk but NOT in HEAD, too: the producer
 * would diff against that uncommitted file and treat everything in it as
 * already posted. Genuinely absent from both is fine — the producer's own
 * "no previous snapshot" path then seeds silently and emits nothing.
 */
function assertSnapshotsCommitted() {
  const dirty = chainLeagues()
    .map((league) => derivedPath(league, 'franchise-history.json'))
    .filter((file) => {
      const committed = headContent(file);
      const current = currentContent(path.join(ROOT, file));
      if (committed === null) return current !== null;
      // Tracked but missing on disk is not a safe baseline either — the
      // producer would read no previous badges and post nothing.
      return current === null || current !== committed;
    });
  if (dirty.length > 0) {
    console.error(
      `[derived-chain] ${EMIT_MILESTONE_POSTS_FLAG} needs the committed snapshot as its baseline, ` +
        `but these already differ from HEAD:\n  ${dirty.join('\n  ')}\n` +
        `Restore them (git checkout -- <file>) and re-run, or the awards in them are never posted.`
    );
    process.exit(1);
  }
}

function main() {
  const args = process.argv.slice(2);
  const sep = args.find((a) => a.startsWith('--sep='))?.slice('--sep='.length) ?? ',';

  if (args.includes('--print-outputs')) {
    console.log(chainOutputs().join(sep));
    return;
  }
  if (args.includes('--print-guard-tests')) {
    console.log(CHAIN_GUARD_TESTS.join(' '));
    return;
  }

  const emitMilestonePosts = args.includes(EMIT_MILESTONE_POSTS_FLAG);
  if (emitMilestonePosts) assertSnapshotsCommitted();

  for (const step of chainSteps({ emitMilestonePosts })) {
    console.log(`\n[derived-chain] ▶ ${step.label}`);
    const result = spawnSync(process.execPath, [step.script, ...step.args], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      console.error(
        `[derived-chain] ✗ ${step.label} failed (exit ${result.status}). ` +
          `The chain is all-or-nothing: commit none of it.`
      );
      process.exit(result.status || 1);
    }
  }

  const restored = restoreTimestampOnlyRewrites();
  if (restored.length > 0) {
    console.log(`\n[derived-chain] timestamp-only, restored to HEAD:\n  ${restored.join('\n  ')}`);
  }
  console.log('\n[derived-chain] done — commit every path --print-outputs lists, together.');
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
