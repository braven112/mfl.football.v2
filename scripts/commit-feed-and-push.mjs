#!/usr/bin/env node
/**
 * Concurrent-safe commit + push for the Schefter feed files.
 *
 * Replaces the old `git add … && git commit && git pull --rebase && git push`
 * dance, which collided every cycle: multiple workflows append to
 * `schefter-feed.json` (marked `merge=binary`) on overlapping crons, so the
 * rebase hit an unresolvable binary conflict, the push failed, and the post
 * never reached the website (this is what froze the live feed for weeks).
 *
 * Instead we reconcile by content: snapshot what this run wrote, hard-reset to
 * the freshly fetched origin tip, re-apply our changes (feeds/history union by
 * post id via scripts/lib/merge-schefter-feed.mjs; every other path is taken
 * verbatim), commit, and push — retrying the whole cycle if origin advances
 * again under us. Nothing either side wrote is lost, regardless of timing.
 *
 * --files accepts files AND directories. Directory entries (e.g. the raw
 * `mfl-feeds` snapshots) are expanded to their individual changed paths, so
 * the speculation workflow's `git add <dir>` style commit works too.
 *
 * Usage:
 *   node scripts/commit-feed-and-push.mjs \
 *     --branch main \
 *     --message "chore: …" \
 *     --files "src/data/theleague/schefter-feed.json,data/theleague/mfl-feeds"
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
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
  return execFileSync('git', args, { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function gitText(args, opts = {}) {
  return git(args, opts).toString('utf8');
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

const isMergeable = (p) => /(?:schefter-feed|post-history)\.json$/.test(p);

/**
 * Flatten the requested entries (files and/or directories) into the individual
 * paths that actually changed this run, with a deleted flag. Uses a single
 * NUL-delimited `git status` so directory entries expand automatically and
 * paths with odd characters survive intact.
 */
function collectChanges(entries) {
  const out = gitText(['status', '--porcelain', '--untracked-files=all', '-z', '--', ...entries]);
  const tokens = out.split('\0');
  const changes = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (!tok) continue;
    const xy = tok.slice(0, 2);
    const path = tok.slice(3);
    // Rename/copy entries carry the source path in the next NUL field — skip it.
    if (xy[0] === 'R' || xy[0] === 'C') i += 1;
    const deleted = xy === ' D' || xy === 'D ' || xy[0] === 'D';
    changes.push({ path, deleted });
  }
  return changes;
}

function main() {
  const { branch, message, files } = parseArgs(process.argv.slice(2));
  if (!branch || !message || !files) {
    console.error('Usage: --branch <b> --message <m> --files <comma,separated,paths>');
    process.exit(2);
  }
  const entries = files.split(',').map((f) => f.trim()).filter(Boolean);

  const changes = collectChanges(entries);
  if (changes.length === 0) {
    console.log('No feed changes to commit.');
    return;
  }
  console.log(`Committing ${changes.length} changed path(s): ${changes.map((c) => c.path).join(', ')}`);

  // Snapshot exactly what THIS run produced before we touch the working tree.
  // Non-deleted files are kept as raw bytes so binary snapshots survive; merge
  // re-application reads them back as utf8.
  const ours = new Map();
  for (const c of changes) ours.set(c.path, c.deleted ? null : readFileSync(c.path));

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    fetchWithRetry(branch);
    // Rebuild on top of the freshly fetched origin tip (drops any commit from a
    // previous failed attempt — we re-merge our content onto the newest base).
    git(['reset', '--hard', 'FETCH_HEAD']);

    for (const c of changes) {
      if (c.deleted) {
        if (existsSync(c.path)) rmSync(c.path, { force: true });
        continue;
      }
      const oursBuf = ours.get(c.path);
      mkdirSync(dirname(c.path), { recursive: true });
      if (isMergeable(c.path)) {
        // Reconcile append-only feeds by post id against origin's version.
        const theirsText = existsSync(c.path) ? readFileSync(c.path, 'utf8') : '';
        const merged = theirsText
          ? mergeByPath(c.path, theirsText, oursBuf.toString('utf8'))
          : oursBuf.toString('utf8');
        writeFileSync(c.path, merged);
      } else {
        // Everything else (derived snapshots, raw mfl-feeds): take ours.
        writeFileSync(c.path, oursBuf);
      }
    }

    // Stage adds, modifications, AND deletions across the requested entries.
    git(['add', '-A', '--', ...entries]);
    if (gitText(['diff', '--cached', '--name-only']).trim() === '') {
      console.log('Our content already present on origin — nothing to push.');
      return;
    }

    git(['commit', '-m', message]);

    try {
      git(['push', 'origin', `HEAD:${branch}`]);
      console.log(`Pushed on attempt ${attempt}.`);
      return;
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString('utf8') : String(err.message || '');
      const line = stderr.split('\n').find(Boolean) || 'unknown';
      console.warn(`  Push attempt ${attempt} rejected (${line}) — re-fetching and re-merging.`);
      if (attempt < MAX_ATTEMPTS) sleepSec(2 * attempt);
    }
  }

  console.error(`Failed to push after ${MAX_ATTEMPTS} attempts.`);
  process.exit(1);
}

main();
