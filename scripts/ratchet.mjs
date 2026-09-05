#!/usr/bin/env node
/**
 * Re-measure every ratchet baseline and, with --write, retighten it.
 *
 * The repo pins three counts that may only go DOWN:
 *   - tests/fixtures/typecheck-baseline.json         (`astro check` error total)
 *   - tests/fixtures/page-fork-baseline.json         (forked sibling routes)
 *   - tests/fixtures/clientrouter-init-baseline.json (DOMContentLoaded-only client init)
 *
 * Each has a test that fails when the count moves in EITHER direction, so
 * that progress retightens the baseline instead of leaving slack. Until now
 * "retighten" meant: read the failure, open the fixture, edit a number by
 * hand, remember the recordedAt date. After a rebase both baselines are
 * stale at once and the manual step is done twice under pressure.
 *
 * This is the one command for it. Measurement is the SAME code the tests
 * use (scripts/lib/ratchet-measures.mjs), so a baseline this writes is the
 * number the test will measure.
 *
 *   node scripts/ratchet.mjs               # measure, compare, exit 1 on drift
 *   node scripts/ratchet.mjs --write       # also retighten baselines that fell
 *   node scripts/ratchet.mjs --skip-types  # forks only (astro check takes ~2.5 min)
 *
 * --write only ever tightens. A count that ROSE is a regression and is
 * reported, never written: fix the code. The typecheck baseline's `notes`
 * and `clearedClasses` are preserved untouched — write a fresh `provenance`
 * line yourself if the drop deserves one.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import {
  clearedClassRegressions,
  collectClientRouterOffenders,
  collectSiblings,
  decolour,
  describeRoute,
  forkedRoutes,
  inBandRoutes,
  parseDiagnostics,
  parseErrorTotal,
  runAstroCheck,
} from './lib/ratchet-measures.mjs';

const ROOT = process.cwd();
const TYPECHECK_BASELINE = 'tests/fixtures/typecheck-baseline.json';
const FORK_BASELINE = 'tests/fixtures/page-fork-baseline.json';
const CLIENTROUTER_BASELINE = 'tests/fixtures/clientrouter-init-baseline.json';

const args = new Set(process.argv.slice(2));
const write = args.has('--write');
const skipTypes = args.has('--skip-types');

const today = new Date().toISOString().slice(0, 10);
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const writeJson = (rel, data) => writeFileSync(join(ROOT, rel), JSON.stringify(data, null, 2) + '\n');

let drift = false;
let regressions = false;

// ---------------------------------------------------------------------------
// Forked sibling pages
// ---------------------------------------------------------------------------
{
  const baseline = readJson(FORK_BASELINE);
  const siblings = collectSiblings(join(ROOT, 'src/pages'), ALL_LEAGUES.map((l) => l.slug));
  const forkedNow = forkedRoutes(siblings, baseline.thinPageMaxLines);
  const recorded = new Set(baseline.forkedRoutes);
  const added = [...forkedNow.keys()].filter((r) => !recorded.has(r)).sort();
  const stale = baseline.forkedRoutes.filter((r) => !forkedNow.has(r));

  console.log(`page forks: ${forkedNow.size} forked route(s) now, ${recorded.size} in baseline`);
  if (added.length) {
    regressions = true;
    console.log(`  NEW forks (a regression — unify them, do not add to the baseline):`);
    for (const r of added) console.log(`    ${describeRoute(r, forkedNow.get(r))}`);
  }
  if (stale.length) {
    drift = true;
    console.log(`  unified since the baseline was recorded (${write ? 'removing' : 'run --write to remove'}):`);
    for (const r of stale) console.log(`    ${r}`);
    if (write) {
      baseline.forkedRoutes = baseline.forkedRoutes.filter((r) => forkedNow.has(r));
      baseline.recordedAt = today;
      writeJson(FORK_BASELINE, baseline);
      console.log(`  wrote ${FORK_BASELINE}`);
    }
  }
  // The test's third assertion: nothing may sit in the empty band around the
  // 80-line threshold. Not writable — the band has to be re-argued in review.
  const inBand = inBandRoutes(siblings, baseline.emptyBand);
  if (inBand.length) {
    regressions = true;
    console.log(`  in the empty band (${baseline.emptyBand.largestThinRoute}–${baseline.emptyBand.smallestForkedRoute} lines) — finish the extraction or re-argue the threshold in the fixture; --write cannot decide this:`);
    for (const r of inBand) console.log(`    ${r}`);
  }
  if (!added.length && !stale.length && !inBand.length) console.log('  at baseline');
}

// ---------------------------------------------------------------------------
// ClientRouter init offenders
// ---------------------------------------------------------------------------
{
  const baseline = readJson(CLIENTROUTER_BASELINE);
  const now = collectClientRouterOffenders(join(ROOT, 'src'));
  const recorded = new Set(baseline.files);
  const added = now.filter((f) => !recorded.has(f));
  const stale = baseline.files.filter((f) => !now.includes(f));
  console.log(`clientrouter init: ${now.length} DOMContentLoaded-only file(s) now, ${recorded.size} in baseline`);
  if (added.length) {
    regressions = true;
    console.log('  NEW offenders (a regression — init on astro:page-load instead):');
    for (const f of added) console.log(`    ${f}`);
  }
  if (stale.length) {
    drift = true;
    console.log(`  fixed since recorded (${write ? 'removing' : 'run --write to remove'}):`);
    for (const f of stale) console.log(`    ${f}`);
    if (write) {
      baseline.files = baseline.files.filter((f) => now.includes(f));
      baseline.recordedAt = today;
      writeJson(CLIENTROUTER_BASELINE, baseline);
      console.log(`  wrote ${CLIENTROUTER_BASELINE}`);
    }
  }
  if (!added.length && !stale.length) console.log('  at baseline');
}

// ---------------------------------------------------------------------------
// astro check error total
// ---------------------------------------------------------------------------
if (skipTypes) {
  console.log('type errors: skipped (--skip-types)');
} else {
  const baseline = readJson(TYPECHECK_BASELINE);
  console.log('type errors: running astro check (~2.5 min)…');
  const output = runAstroCheck({ cwd: ROOT });
  const total = parseErrorTotal(output);
  console.log(`type errors: ${total} now, ${baseline.total} in baseline`);
  // Same cleared-class check as pnpm test:types — a lower total can hide a
  // class that was driven to zero coming back, and that is a regression the
  // test rejects even when the ratchet would read it as progress.
  const cleared = clearedClassRegressions(parseDiagnostics(decolour(output)), baseline.clearedClasses);
  if (cleared.length) {
    regressions = true;
    console.log('  cleared error class(es) came back — a regression whatever the total says:');
    for (const c of cleared) console.log(`    ${c.key}: ${c.hits.length}  (${c.fix})`);
  }
  if (cleared.length) {
    console.log('  not writing the baseline while a cleared class is red.');
  } else if (total > baseline.total) {
    regressions = true;
    console.log(`  ROSE by ${total - baseline.total} — a regression. Fix the new errors; never raise the baseline.`);
    console.log('  To see them: NODE_OPTIONS=--max-old-space-size=12288 npx astro check --minimumSeverity error');
  } else if (total < baseline.total) {
    drift = true;
    console.log(`  fell by ${baseline.total - total} (${write ? 'retightening' : 'run --write to retighten'})`);
    if (write) {
      baseline.total = total;
      baseline.recordedAt = today;
      writeJson(TYPECHECK_BASELINE, baseline);
      console.log(`  wrote ${TYPECHECK_BASELINE} — add a provenance note under "notes" saying what removed them.`);
    }
  } else {
    console.log('  at baseline');
  }
}

if (regressions) process.exit(1);
if (drift && !write) process.exit(1);
