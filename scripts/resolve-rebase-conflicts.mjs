#!/usr/bin/env node
/**
 * Resolve the mechanical conflict classes of a `git rebase origin/main`, and
 * say exactly what is left for a human (or Claude) to integrate by hand.
 *
 * Run it whenever the rebase stops on conflicts:
 *
 *   node scripts/resolve-rebase-conflicts.mjs            # resolve what can be, list the rest
 *   node scripts/resolve-rebase-conflicts.mjs --dry-run  # plan only
 *
 * What it does per class (scripts/lib/rebase-conflicts.mjs decides the class):
 *   generated-data    → take MAIN's copy, `git add`
 *   ratchet-baseline  → take MAIN's copy, `git add`, and remind you to re-measure
 *   lockfile          → take MAIN's copy; once package.json is clean, `pnpm install`, `git add`
 *   package-json / docs / source → listed with the CLAUDE.md rule, left to you
 *
 * It never runs `git rebase --continue` — you do, after the manual files are
 * resolved and added, so the commit that lands is one you looked at.
 *
 * Exit 0 when every conflict is resolved; 1 when manual ones remain (or the
 * lock could not be regenerated); 2 when not in a rebase/merge at all.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { mainSide, orderConflicts } from './lib/rebase-conflicts.mjs';

const dryRun = process.argv.includes('--dry-run');

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

const gitDir = git(['rev-parse', '--git-dir']);
const mode = existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply'))
  ? 'rebase'
  : existsSync(join(gitDir, 'MERGE_HEAD'))
    ? 'merge'
    : null;

if (!mode) {
  console.error('Not in a rebase or merge — nothing to resolve.');
  process.exit(2);
}

const side = mainSide(mode);
// Index stage that holds MAIN's version: 2 is "ours", 3 is "theirs".
const mainStage = side === 'ours' ? '2' : '3';

/**
 * Take main's side of one conflicted path. A delete/modify conflict has no
 * entry for main's stage, and `git checkout --<side>` errors on it
 * ("does not have our version") — so check the stages first and, when main
 * deleted the file, delete it here too rather than throwing out of the loop.
 * Returns a one-line description of what happened.
 */
function takeMain(file) {
  const stages = git(['ls-files', '-u', '--', file])
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split(/\s+/)[2]);
  if (!stages.includes(mainStage)) {
    git(['rm', '--quiet', '--cached', '--', file]);
    try {
      rmSync(file);
    } catch {
      /* already gone from the worktree */
    }
    return `main deleted it — removed`;
  }
  git(['checkout', `--${side}`, '--', file]);
  git(['add', '--', file]);
  return `took main (--${side}), git add`;
}

const conflicted = git(['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
if (conflicted.length === 0) {
  console.log(`No conflicted files. Continue with: git ${mode} --continue`);
  process.exit(0);
}

console.log(`${mode}: ${conflicted.length} conflicted file(s). MAIN is --${side} here.\n`);

const plan = orderConflicts(conflicted);
const manual = [];
let remeasure = false;
let lockPending = false;

for (const c of plan) {
  if (!c.auto) {
    manual.push(c);
    continue;
  }
  if (c.klass === 'lockfile') {
    lockPending = true;
    continue;
  }
  if (dryRun) {
    console.log(`[${c.klass}] ${c.file}\n    → take main (--${side}), git add`);
  } else {
    try {
      console.log(`[${c.klass}] ${c.file}\n    → ${takeMain(c.file)}`);
    } catch (err) {
      // One bad file must not abort the plan: report it, keep going, and
      // hand it to the manual list so the exit code says work remains.
      console.log(`[${c.klass}] ${c.file}\n    → FAILED: ${err.message.split('\n')[0]}`);
      manual.push({ file: c.file, klass: c.klass, action: `Automatic resolve failed; take main's side by hand (git checkout --${side} -- ${c.file}, or git rm --cached if main deleted it).` });
      continue;
    }
  }
  if (c.klass === 'ratchet-baseline') remeasure = true;
}

if (lockPending) {
  const pkgStillConflicted = manual.some((c) => c.klass === 'package-json');
  console.log(`[lockfile] pnpm-lock.yaml\n    → take main (--${side}); then pnpm install; git add`);
  if (!dryRun) {
    try {
      takeMain('pnpm-lock.yaml');
    } catch (err) {
      console.log(`    FAILED to take main's lock: ${err.message.split('\n')[0]}`);
    }
    if (pkgStillConflicted) {
      console.log('    package.json is still conflicted — resolve it, then run `pnpm install && git add pnpm-lock.yaml`.');
      manual.push({ file: 'pnpm-lock.yaml', klass: 'lockfile', action: 'Regenerate after package.json: pnpm install && git add pnpm-lock.yaml' });
    } else {
      try {
        execFileSync('pnpm', ['install'], { stdio: 'inherit' });
        git(['add', '--', 'pnpm-lock.yaml']);
      } catch {
        console.log('    pnpm install failed — fix and re-run `pnpm install && git add pnpm-lock.yaml`.');
        manual.push({ file: 'pnpm-lock.yaml', klass: 'lockfile', action: 'pnpm install failed; regenerate and add by hand.' });
      }
    }
  }
}

if (manual.length) {
  console.log('\nLeft for manual resolution (CLAUDE.md "Merge conflicts — always rebase, resolve autonomously"):');
  for (const c of manual) console.log(`  [${c.klass}] ${c.file}\n      ${c.action}`);
  console.log('\nAfter editing: git add <file> for each, then `git ' + mode + ' --continue`.');
}
if (remeasure) {
  console.log('\nRatchet baselines were taken from main to clear markers. Before the final push:\n  node scripts/ratchet.mjs --write   # re-measures on the post-rebase tree');
}
if (dryRun) console.log('\n(dry run — nothing changed)');

process.exit(manual.length ? 1 : 0);
