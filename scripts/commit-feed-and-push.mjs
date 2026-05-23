#!/usr/bin/env node
/**
 * Concurrent-safe commit + push for the Schefter feed files.
 *
 * Replaces the old `git add … && git commit && git pull --rebase && git push`
 * dance, which collided every cycle: multiple workflows append to
 * `schefter-feed.json` (marked `merge=binary`) on overlapping crons, so the
 * rebase hit an unresolvable binary conflict, the push failed, and the post
 * never reached the website.
 *
 * Instead we reconcile by content: snapshot what this run wrote, hard-reset to
 * the freshly fetched origin tip, re-apply our posts via an id-aware union
 * merge (scripts/lib/merge-schefter-feed.mjs), commit, and push — retrying the
 * whole cycle if origin advances again under us. Nothing either side wrote is
 * lost, regardless of timing.
 *
 * Usage:
 *   node scripts/commit-feed-and-push.mjs \
 *     --branch main \
 *     --message "chore: …" \
 *     --files "src/data/theleague/schefter-feed.json,data/schefter/post-history.json"
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { mergeByPath } from './lib/merge-schefter-feed.mjs';

const MAX_ATTEMPTS = 5;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--branch') out.branch = argv[++i];
    else if (a === '--message') out.message = argv[++i];
    else if (a === '--files') out.files = argv[++i];
  }
  return out;
}

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function sleepSec(sec) {
  // Synchronous sleep without spawning — keeps the retry loop simple.
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, Math.max(0, sec) * 1000);
}

function fetchWithRetry(branch) {
  let delay = 2;
  for (let i = 1; i <= 4; i += 1) {
    try {
      git(['fetch', 'origin', branch]);
      return;
    } catch (err) {
      if (i === 4) throw err;
      console.warn(`  git fetch failed (attempt ${i}): ${String(err.message).split('\n')[0]} — retrying in ${delay}s`);
      sleepSec(delay);
      delay *= 2;
    }
  }
}

function main() {
  const { branch, message, files } = parseArgs(process.argv.slice(2));
  if (!branch || !message || !files) {
    console.error('Usage: --branch <b> --message <m> --files <comma,separated,paths>');
    process.exit(2);
  }
  const fileList = files.split(',').map((f) => f.trim()).filter(Boolean);

  // Which requested files actually changed this run?
  const dirty = fileList.filter((f) => {
    try {
      return git(['status', '--porcelain', '--', f]).trim() !== '';
    } catch {
      return false;
    }
  });
  if (dirty.length === 0) {
    console.log('No feed changes to commit.');
    return;
  }
  console.log(`Committing ${dirty.length} changed file(s): ${dirty.join(', ')}`);

  // Snapshot what THIS run produced before we touch the working tree.
  const ours = new Map();
  for (const f of dirty) ours.set(f, readFileSync(f, 'utf8'));

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    fetchWithRetry(branch);
    // Rebuild on top of the freshly fetched origin tip (drops any commit from a
    // previous failed attempt — we re-merge our content onto the newest base).
    git(['reset', '--hard', 'FETCH_HEAD']);

    for (const f of dirty) {
      const theirsText = existsSync(f) ? readFileSync(f, 'utf8') : '';
      const mergedText = theirsText ? mergeByPath(f, theirsText, ours.get(f)) : ours.get(f);
      writeFileSync(f, mergedText);
    }

    git(['add', '--', ...dirty]);
    if (git(['diff', '--cached', '--name-only']).trim() === '') {
      console.log('Our content already present on origin — nothing to push.');
      return;
    }

    git(['commit', '-m', message]);

    try {
      git(['push', 'origin', `HEAD:${branch}`]);
      console.log(`Pushed on attempt ${attempt}.`);
      return;
    } catch (err) {
      const line = String(err.stderr || err.message || '').split('\n').find(Boolean) || 'unknown';
      console.warn(`  Push attempt ${attempt} rejected (${line}) — re-fetching and re-merging.`);
      if (attempt < MAX_ATTEMPTS) sleepSec(2 * attempt);
    }
  }

  console.error(`Failed to push after ${MAX_ATTEMPTS} attempts.`);
  process.exit(1);
}

main();
