#!/usr/bin/env node
/**
 * Move the live league-data pointer: how a data sync updates what the site
 * reads without a Vercel build, and how a bad sync is undone.
 * Design: src/config/league-data-live.mjs.
 *
 *   node scripts/league-data-pointer.mjs show
 *   node scripts/league-data-pointer.mjs history
 *   node scripts/league-data-pointer.mjs hydrate
 *       Before a sync fetches: take the live files from the store wherever
 *       they differ from this checkout and git has not changed them since, so
 *       the run starts from what the site serves rather than the last daily
 *       commit (git keeps one data commit a day; see held-sync-files.mjs).
 *   node scripts/league-data-pointer.mjs publish --source roster-sync
 *       Upload every sync-owned file the store lacks, then the overlay, then
 *       point the site at it. When the overlay is unchanged it only re-stamps
 *       the pointer as confirmed. Writes `overlay=<hash>` to $GITHUB_OUTPUT.
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
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { LEAGUE_DATA_SCHEMA, LIVE_HISTORY_KEY, LIVE_POINTER_KEY, parsePointer } from '../src/config/league-data-live.mjs';
import { LIVE_HISTORY_LENGTH, buildOverlay, makePointer, planHydrate, planRollback } from './lib/league-data-live-ops.mjs';
import { BLOB_PREFIX, hashContent } from './lib/league-data-store.mjs';
import { existingBlobs, upload } from './lib/league-data-blob.mjs';
import { getRedisConfig, redisCommand } from './lib/redis.mjs';
import { isSyncPublishedStoreFile, syncPublishedPatterns } from './lib/sync-published.mjs';

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

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/** A step output for the workflow, when running in GitHub Actions. */
function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
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
  const gitBase = git(['rev-parse', 'HEAD']);
  const current = await readLive(r);
  const same =
    current?.overlay === overlay.hash &&
    current.schema === LEAGUE_DATA_SCHEMA &&
    current.patterns.join('\n') === patterns.join('\n');
  if (same) {
    // Nothing new: confirm the pointer is current (LIVE_MAX_AGE_MS) and move
    // its gitBase on, without a history entry.
    await redisCommand(r, [
      'SET',
      LIVE_POINTER_KEY,
      JSON.stringify({ ...current, refreshedAt: new Date().toISOString(), gitBase }),
    ]);
    console.log(`[league-data] unchanged, confirmed: ${describe(current)}`);
    output('overlay', overlay.hash);
    return;
  }

  const { list, put } = await import('@vercel/blob');
  const { hashes, base: storeBase } = await existingBlobs(list);
  const missing = {};
  for (const [path, hash] of Object.entries(overlay.files)) {
    if (hashes.has(hash)) continue;
    hashes.add(hash);
    missing[path] = hash;
  }
  const { uploaded, base: uploadedBase } = await upload(missing, put);
  // The overlay goes up LAST, and the pointer after it: a reader never sees a
  // pointer to an overlay, or an overlay naming a file, the store lacks.
  let overlayBase = null;
  if (!hashes.has(overlay.hash)) ({ base: overlayBase } = await upload({ overlay: overlay.hash }, put, () => overlay.body));
  const base = storeBase ?? uploadedBase ?? overlayBase ?? undefined;

  const next = makePointer({ overlay: overlay.hash, patterns, source, base, gitBase });
  await setLive(r, next, current);
  console.log(
    `[league-data] live: ${describe(next)} — ${Object.keys(overlay.files).length} files, ${uploaded} uploaded`,
  );
  output('overlay', overlay.hash);
}

/**
 * Start this checkout from the live data (see the header). Writes
 * `hydrated=true` to $GITHUB_OUTPUT when the checkout now matches the live
 * pointer (or there was nothing to take), `false` when it could not — and then
 * the run must not publish, or it would put the older git copies back live.
 */
async function hydrate(r) {
  const pointer = await readLive(r);
  if (!pointer) {
    console.log('[league-data] no live pointer — starting from git');
    output('hydrated', 'true');
    return;
  }
  if (pointer.schema !== LEAGUE_DATA_SCHEMA || !pointer.base || !pointer.gitBase) {
    console.log(`[league-data] pointer cannot seed a run (${describe(pointer)}) — starting from git`);
    output('hydrated', pointer.schema === LEAGUE_DATA_SCHEMA ? 'false' : 'true');
    return;
  }
  const head = git(['rev-parse', 'HEAD']);
  let changedInGit = new Set();
  if (pointer.gitBase !== head) {
    // The checkout is shallow; fetch just the base commit so the trees diff.
    git(['fetch', '--quiet', '--depth=1', 'origin', pointer.gitBase]);
    changedInGit = new Set(git(['diff', '--name-only', pointer.gitBase, head]).split('\n').filter(Boolean));
  }
  const getJson = async (hash) => {
    const res = await fetch(`${pointer.base}${BLOB_PREFIX}${hash}.json`);
    if (!res.ok) throw new Error(`store returned ${res.status} for ${hash}`);
    return Buffer.from(await res.arrayBuffer());
  };
  const files = JSON.parse((await getJson(pointer.overlay)).toString()).files ?? {};
  // Only paths this run itself would publish: a store file under today's sync
  // patterns, relative and with no `..`, so whatever the overlay names can
  // never write outside the data it owns.
  const patterns = syncPublishedPatterns();
  const take = planHydrate(
    files,
    (p) => (existsSync(p) ? hashContent(readFileSync(p)) : null),
    changedInGit,
    (p) => !p.split('/').includes('..') && isSyncPublishedStoreFile(p, patterns),
  );
  for (const { path, hash } of take) {
    const body = await getJson(hash);
    if (hashContent(body) !== hash) throw new Error(`store copy of ${path} does not match ${hash}`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
  console.log(
    `[league-data] hydrated ${take.length} file(s) from ${describe(pointer)}; ${changedInGit.size} path(s) changed in git since kept`,
  );
  output('hydrated', 'true');
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
  if (cmd === 'hydrate') return hydrate(r);
  if (cmd === 'rollback') return rollback(r);
  if (cmd === 'clear') {
    const current = await readLive(r);
    if (current) await redisCommand(r, ['LPUSH', LIVE_HISTORY_KEY, JSON.stringify(current)]);
    await redisCommand(r, ['DEL', LIVE_POINTER_KEY]);
    console.log(`[league-data] cleared (was ${describe(current)}); deploys serve their own data`);
    return;
  }
  throw new Error(
    'usage: league-data-pointer.mjs show | history | hydrate | publish --source <name> | rollback [--steps N] | clear',
  );
}

main().catch((err) => {
  console.error('[league-data]', err?.message ?? err);
  process.exit(1);
});
