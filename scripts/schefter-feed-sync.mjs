#!/usr/bin/env node
/**
 * Move Schefter feeds between Redis (the live copy) and their committed files.
 *
 *   node scripts/schefter-feed-sync.mjs pull
 *     Bring every league's feed file up to Redis's copy. Every workflow that
 *     writes a feed runs this right after checkout, so its scripts start from
 *     the live feed rather than the daily snapshot in git.
 *
 *   node scripts/schefter-feed-sync.mjs paths
 *     Print every league's committed feed path, comma-separated (the
 *     snapshot step's --files list).
 *
 *   node scripts/schefter-feed-sync.mjs snapshot-due
 *     Exit 0 when the committed snapshot is a day old or older (the caller
 *     then commits the pulled files), exit 1 when it is still fresh.
 *
 * With no Redis credentials both are no-ops (exit 0 / "not due"), so a job in
 * an environment without them keeps the old git-only behaviour.
 *
 * See scripts/lib/schefter-feed-store.mjs for the design.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedLeagues, feedStoreConfig, pullFeedFile } from './lib/schefter-feed-store.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_EVERY_MS = 24 * 60 * 60 * 1000;

/** Commit time (ms) of the newest commit touching any feed file, or 0. */
export function lastSnapshotMs(paths, git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })) {
  try {
    const out = git(['log', '-1', '--format=%ct', '--', ...paths]).trim();
    return out ? Number(out) * 1000 : 0;
  } catch {
    return 0;
  }
}

export function snapshotDue(lastMs, nowMs = Date.now()) {
  return !lastMs || nowMs - lastMs >= SNAPSHOT_EVERY_MS;
}

async function pull() {
  const redis = feedStoreConfig();
  if (!redis) {
    console.log('[feed-sync] no Redis credentials — feed files stay as checked out.');
    return;
  }
  for (const { slug, feedPath } of feedLeagues()) {
    try {
      const changed = await pullFeedFile(redis, slug, path.join(root, feedPath));
      console.log(`[feed-sync] ${slug}: ${changed ? 'updated from Redis' : 'already current'}`);
    } catch (err) {
      // Warn, don't fail: a Redis outage must not stop the news. The job then
      // writes on top of the snapshot, and its posts still merge in safely
      // (union by id, watermarks max) whether they land in Redis or in git.
      console.warn(`::warning::[feed-sync] ${slug}: pull failed — ${err.message}`);
    }
  }
}

function snapshotDueCli() {
  if (!feedStoreConfig()) {
    console.log('[feed-sync] no Redis credentials — the feed is committed on every write; no snapshot needed.');
    process.exitCode = 1;
    return;
  }
  const last = lastSnapshotMs(feedLeagues().map((l) => l.feedPath));
  const due = snapshotDue(last);
  console.log(`[feed-sync] last snapshot ${last ? new Date(last).toISOString() : 'never'} — ${due ? 'due' : 'not due'}`);
  process.exitCode = due ? 0 : 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cmd = process.argv[2];
  if (cmd === 'pull') await pull();
  else if (cmd === 'snapshot-due') snapshotDueCli();
  else if (cmd === 'paths') console.log(feedLeagues().map((l) => l.feedPath).join(','));
  else {
    console.error('Usage: schefter-feed-sync.mjs pull | snapshot-due | paths');
    process.exitCode = 2;
  }
}
