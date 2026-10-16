/**
 * Roster-sync outputs that change often, are read live (or barely read), and
 * so are held out of the sync commit — every commit to `main` is a production
 * build, and these were the files keeping most roster syncs committing.
 *
 * A held file still gets written by its fetcher as before. Just before the
 * commit, scripts/hold-sync-files.mjs publishes it to Redis (when it has a
 * live reader) and puts the committed copy back, so the commit carries only
 * real league changes. Once a day each group is let through instead, so git
 * keeps a recent snapshot: it is the fallback the site renders when Redis is
 * unreachable and the input of any script that reads the file from disk.
 *
 * With no Redis credentials, or on any Redis error, nothing is held and the
 * files commit exactly as before.
 *
 * Dependency-free (raw REST via ./redis.mjs), like the commit step it feeds.
 */
import { redisCommand } from './redis.mjs';

export const SNAPSHOT_EVERY_MS = 24 * 60 * 60 * 1000;

/** Redis key the site reads a league's live injury report from. */
export const injuriesKey = (slug) => `mfl:injuries:${slug}`;

/**
 * - `injuries`: NFL injury designations, read per request by the rosters,
 *   lineup and free-agent pages through `loadLiveInjuryMap`.
 * - `theleague-salaries`: the enriched salary feed. No page reads it (they
 *   read the root src/data copy); only schefter-trade-speculation does, from
 *   disk, so a once-a-day snapshot is all it needs.
 */
export const HELD_GROUPS = [
  {
    group: 'injuries',
    match: /^data\/([^/]+)\/mfl-feeds\/\d{4}\/injuries\.json$/,
    redisKey: (m) => injuriesKey(m[1]),
  },
  {
    group: 'theleague-salaries',
    match: /^src\/data\/theleague\/mfl-player-salaries-\d{4}\.json$/,
  },
];

const snapshotKey = (group) => `mfl:held-sync:snapshot-at:${group}`;

/** Tracked files the run modified (`git status --porcelain` lines); new files are never held. */
export function modifiedPaths(porcelain) {
  return porcelain
    .split('\n')
    .filter((line) => /^( M|M |MM)/.test(line))
    .map((line) => line.slice(3).trim());
}

/** Group the modified paths by held group, keeping each path's regex match. */
export function heldChanges(paths, groups = HELD_GROUPS) {
  const out = new Map();
  for (const p of paths) {
    for (const g of groups) {
      const m = p.match(g.match);
      if (!m) continue;
      if (!out.has(g.group)) out.set(g.group, { def: g, files: [] });
      out.get(g.group).files.push({ path: p, match: m });
      break;
    }
  }
  return out;
}

export function snapshotDue(lastMs, nowMs = Date.now()) {
  return !lastMs || nowMs - lastMs >= SNAPSHOT_EVERY_MS;
}

/**
 * Each league's current injury report on disk: the newest year's file per
 * league, from every path the run has (not just the modified ones). Publishing
 * from the git diff missed a report that reverted: committed A, a sync
 * publishes B and restores A, the next report is A again, `writeJsonIfChanged`
 * leaves the file alone, git sees no change and Redis keeps serving B.
 */
export function currentInjuryFiles(paths) {
  const newest = new Map();
  for (const p of paths) {
    const m = p.match(/^data\/([^/]+)\/mfl-feeds\/(\d{4})\/injuries\.json$/);
    if (!m) continue;
    const prev = newest.get(m[1]);
    if (!prev || Number(m[2]) > prev.year) newest.set(m[1], { path: p, key: injuriesKey(m[1]), year: Number(m[2]) });
  }
  return [...newest.values()].map(({ path, key }) => ({ path, key }));
}

/**
 * Publish every live-read file to Redis, changed or not, so one failed run is
 * repaired by the next. Returns false on any failure (malformed file included)
 * — the caller then holds nothing that depends on Redis.
 */
export async function publishLiveFiles(files, { redis, readFile, command = redisCommand, log = () => {} }) {
  try {
    for (const f of files) {
      // Store the parsed value's JSON so a malformed file fails here, not on the site.
      const body = JSON.stringify(JSON.parse(readFile(f.path)));
      await command(redis, ['SET', f.key, body]);
    }
    return true;
  } catch (err) {
    log(`[held-sync] publish failed: ${err.message} — live-read files commit as before`);
    return false;
  }
}

/**
 * Decide each held group's fate. Returns `{ restore: string[], commit: string[] }`:
 * paths to put back to their committed copy, and paths left for the commit.
 * `published` is publishLiveFiles' result: a group with a live reader is held
 * only when its report reached Redis. `command` is the Redis REST call.
 */
export async function planHeldFiles(changes, { redis, published, command = redisCommand, nowMs = Date.now(), log = () => {} }) {
  const restore = [];
  const commit = [];
  for (const [group, { def, files }] of changes) {
    const paths = files.map((f) => f.path);
    if (def.redisKey && !published) {
      log(`[held-sync] ${group}: not published — committing ${paths.length} file(s)`);
      commit.push(...paths);
      continue;
    }
    try {
      const last = Number(await command(redis, ['GET', snapshotKey(group)])) || 0;
      if (snapshotDue(last, nowMs)) {
        await command(redis, ['SET', snapshotKey(group), String(nowMs)]);
        log(`[held-sync] ${group}: daily snapshot due — committing ${paths.length} file(s)`);
        commit.push(...paths);
      } else {
        log(`[held-sync] ${group}: held ${paths.length} file(s) out of the commit`);
        restore.push(...paths);
      }
    } catch (err) {
      log(`[held-sync] ${group}: ${err.message} — committing as before`);
      commit.push(...paths);
    }
  }
  return { restore, commit };
}
