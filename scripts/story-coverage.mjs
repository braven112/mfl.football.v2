#!/usr/bin/env node
/**
 * Storybook coverage report for src/components/shared/.
 *
 *   node scripts/story-coverage.mjs            # summary + the backlog
 *   node scripts/story-coverage.mjs --all      # every bucket, file by file
 *   node scripts/story-coverage.mjs --write    # retighten the baseline
 *
 * Buckets and what they mean: scripts/lib/story-coverage.mjs. The guard that
 * reads the same classifier: tests/story-coverage.test.ts.
 *
 * `--write` only ever SHRINKS the backlog baseline (drops entries that got a
 * story, became a page, or were deleted). A component that is new to the
 * backlog is refused, not recorded — a new presentational shared component
 * ships with a story, or with an `exempt` reason a reviewer can read.
 */
import fs from 'node:fs';
import path from 'node:path';
import { measureStoryCoverage, SHARED_DIR } from './lib/story-coverage.mjs';

const ROOT = process.cwd();
const BASELINE = 'tests/fixtures/story-coverage-baseline.json';
const args = process.argv.slice(2);

const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE), 'utf8'));
const { buckets } = measureStoryCoverage(ROOT, { exempt: baseline.exempt });
const total = Object.values(buckets).reduce((n, l) => n + l.length, 0);
const short = (f) => f.replace(`${SHARED_DIR}/`, '');

const LABELS = {
  story: 'has its own story',
  covered: 'rendered inside a storied component',
  page: 'page body — not storyable',
  dataBound: 'resolves its own data — not storyable',
  nonVisual: 'renders nothing visible',
  exempt: 'exempt (reason in the baseline)',
  backlog: 'BACKLOG — storyable, no story yet',
};

console.log(`Shared components: ${total}`);
for (const [k, label] of Object.entries(LABELS)) {
  console.log(`  ${String(buckets[k].length).padStart(4)}  ${label}`);
}
const inSnapshots = buckets.story.length + buckets.covered.length;
const storyable = inSnapshots + buckets.backlog.length;
console.log(`\nIn a snapshot: ${inSnapshots} of ${storyable} storyable (${Math.round((100 * inSnapshots) / storyable)}%)`);

const show = args.includes('--all') ? Object.keys(LABELS) : ['backlog'];
for (const k of show) {
  if (!buckets[k].length) continue;
  console.log(`\n${LABELS[k]}:`);
  const byDir = {};
  for (const f of buckets[k]) (byDir[path.dirname(short(f))] ??= []).push(path.basename(f));
  for (const [d, l] of Object.entries(byDir)) console.log(`  ${d === '.' ? '(top level)' : d + '/'}  ${l.join(', ')}`);
}

if (args.includes('--write')) {
  const added = buckets.backlog.filter((f) => !baseline.backlog.includes(f));
  if (added.length) {
    console.error(`\nRefusing to grow the backlog. New presentational shared components need a story:\n  ${added.join('\n  ')}`);
    process.exit(1);
  }
  const next = baseline.backlog.filter((f) => buckets.backlog.includes(f));
  const dropped = baseline.backlog.length - next.length;
  baseline.backlog = next;
  baseline.recordedAt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(ROOT, BASELINE), JSON.stringify(baseline, null, 2) + '\n');
  console.log(`\nwrote ${BASELINE}: backlog ${next.length} (${dropped} retired)`);
}
