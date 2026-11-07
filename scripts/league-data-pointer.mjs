#!/usr/bin/env node
/**
 * Move the live league-data pointer: how a data sync updates what the site
 * reads without a Vercel build, and how a bad sync is undone.
 * Design: src/config/league-data-live.mjs.
 *
 *   node scripts/league-data-pointer.mjs show
 *   node scripts/league-data-pointer.mjs history
 *   node scripts/league-data-pointer.mjs publish --source roster-sync
 *       Upload every sync-owned file the store lacks, then the overlay, then
 *       point the site at it. Does nothing when the overlay is unchanged.
 *   node scripts/league-data-pointer.mjs rollback [--steps N]
 *       Point back at the pointer N publishes ago (default 1). The current
 *       pointer is dropped, so a second rollback goes further back.
 *   node scripts/league-data-pointer.mjs clear
 *       Remove the pointer: every deploy serves the data it was built with.
 *
 * Needs the Upstash REST env (KV_REST_API_URL/TOKEN or equivalents) for every
 * command, and BLOB_READ_WRITE_TOKEN for publish. The site picks a change up
 * within LIVE_CHECK_INTERVAL_MS (one minute) per server instance.
 */
import { LEAGUE_DATA_SCHEMA, LIVE_HISTORY_KEY, LIVE_POINTER_KEY, parsePointer } from '../src/config/league-data-live.mjs';
import { LIVE_HISTORY_LENGTH, buildOverlay, makePointer, planRollback } from './lib/league-data-live-ops.mjs';
import { existingBlobs, upload } from './lib/league-data-blob.mjs';
import { getRedisConfig, redisCommand } from './lib/redis.mjs';
import { syncPublishedPatterns } from './lib/sync-published.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function redis() {
  const config = getRedisConfig();
  if (!config) throw new Error('No Upstash REST credentials (KV_REST_API_URL / KV_REST_API_TOKEN).');
  return config;
}

async function readLive(r) {
  return parsePointer(await redisCommand(r, ['GET', LIVE_POINTER_KEY]));
}

async function readHistory(r) {
  const raw = (await redisCommand(r, ['LRANGE', LIVE_HISTORY_KEY, 0, -1])) ?? [];
  return raw.map((v) => {
    try {
      return typeof v === 'string' ? JSON.parse(v) : v;
    } catch {
      return null;
    }
  });
}

const describe = (p) =>
  p ? `${p.overlay} from ${p.source ?? '?'} at ${p.publishedAt} (schema ${p.schema}, ${p.patterns.length} patterns)` : 'none';

/** Make `next` live, keeping the one it replaces at the head of the history. */
async function setLive(r, next, current) {
  if (current) {
    await redisCommand(r, ['LPUSH', LIVE_HISTORY_KEY, JSON.stringify(current)]);
    await redisCommand(r, ['LTRIM', LIVE_HISTORY_KEY, 0, LIVE_HISTORY_LENGTH - 1]);
  }
  await redisCommand(r, ['SET', LIVE_POINTER_KEY, JSON.stringify(next)]);
}

async function publish(r) {
  const source = arg('source');
  if (!source) throw new Error('publish needs --source <name> (e.g. roster-sync)');
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('publish needs BLOB_READ_WRITE_TOKEN');
  const patterns = syncPublishedPatterns();
  const overlay = buildOverlay(patterns);
  const current = await readLive(r);
  const same =
    current?.overlay === overlay.hash &&
    current.schema === LEAGUE_DATA_SCHEMA &&
    current.patterns.join('\n') === patterns.join('\n');
  if (same) {
    console.log(`[league-data] unchanged: ${describe(current)}`);
    return;
  }

  const { list, put } = await import('@vercel/blob');
  const { hashes } = await existingBlobs(list);
  const missing = {};
  for (const [path, hash] of Object.entries(overlay.files)) {
    if (hashes.has(hash)) continue;
    hashes.add(hash);
    missing[path] = hash;
  }
  const { uploaded } = await upload(missing, put);
  // The overlay goes up LAST, and the pointer after it: a reader never sees a
  // pointer to an overlay, or an overlay naming a file, the store lacks.
  if (!hashes.has(overlay.hash)) await upload({ overlay: overlay.hash }, put, () => overlay.body);

  const next = makePointer({ overlay: overlay.hash, patterns, source });
  await setLive(r, next, current);
  console.log(
    `[league-data] live: ${describe(next)} — ${Object.keys(overlay.files).length} files, ${uploaded} uploaded`,
  );
}

async function rollback(r) {
  const steps = Number(arg('steps', '1'));
  const history = await readHistory(r);
  const { target, drop } = planRollback(history, steps);
  const current = await readLive(r);
  for (let i = 0; i < drop; i++) await redisCommand(r, ['LPOP', LIVE_HISTORY_KEY]);
  await redisCommand(r, ['SET', LIVE_POINTER_KEY, JSON.stringify({ ...target, source: `rollback:${target.source ?? '?'}` })]);
  console.log(`[league-data] rolled back from ${describe(current)}`);
  console.log(`[league-data] live: ${describe(target)}`);
}

async function main() {
  const r = redis();
  const cmd = process.argv[2];
  if (cmd === 'show') return console.log(describe(await readLive(r)));
  if (cmd === 'history') {
    const history = await readHistory(r);
    console.log(`live: ${describe(await readLive(r))}`);
    history.forEach((p, i) => console.log(`${i + 1}: ${describe(parsePointer(p))}`));
    return;
  }
  if (cmd === 'publish') return publish(r);
  if (cmd === 'rollback') return rollback(r);
  if (cmd === 'clear') {
    const current = await readLive(r);
    if (current) await redisCommand(r, ['LPUSH', LIVE_HISTORY_KEY, JSON.stringify(current)]);
    await redisCommand(r, ['DEL', LIVE_POINTER_KEY]);
    console.log(`[league-data] cleared (was ${describe(current)}); deploys serve their own data`);
    return;
  }
  throw new Error('usage: league-data-pointer.mjs show | history | publish --source <name> | rollback [--steps N] | clear');
}

main().catch((err) => {
  console.error('[league-data]', err?.message ?? err);
  process.exit(1);
});
