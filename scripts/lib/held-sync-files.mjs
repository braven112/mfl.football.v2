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
import { leagueYearFor } from './schefter-league-year.mjs';
import { ALL_LEAGUES } from '../../src/config/leagues-data.mjs';

export const SNAPSHOT_EVERY_MS = 24 * 60 * 60 * 1000;

/** Redis key the site reads a league's live injury report from. */
export const injuriesKey = (slug) => `mfl:injuries:${slug}`;

/**
 * - `injuries`: NFL injury designations, read per request by the rosters,
 *   lineup and free-agent pages through `loadLiveInjuryMap`.
 * - `theleague-salaries`: the enriched salary feed. No page reads it (they
 *   read the root src/data copy); only schefter-trade-speculation does, from
 *   disk, so a once-a-day snapshot is all it needs.
 * - `rosters`: the CURRENT league year's `rosters.json` and `transactions.json`,
 *   plus `derived/top-players.json`, which the sync recomputes from them. Every
 *   page that shows who holds whom reads them live — the roster cache
 *   (`getCachedRosterFranchises` / `getCachedRosters`, which fetches MFL
 *   itself) and the recent-transactions cache, which overlays the last 3 days
 *   on the file — so neither needs a Redis copy from this job: a copy would sit
 *   in the same Redis whose outage is the only time the fallback renders. An
 *   archive year is never held (it no longer moves, and nothing overlays it).
 *   One group, so the three always snapshot together and the committed
 *   leaderboard agrees with the committed rosters (tests/top-players-data).
 *   The live readers are pinned by tests/sync-noise-commit-guard.test.ts.
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
  {
    group: 'rosters',
    // m[1] the league's data dir, m[2] the feed year (absent for top-players).
    match: /^data\/([^/]+)\/(?:mfl-feeds\/(\d{4})\/(?:rosters|transactions)\.json|derived\/top-players\.json)$/,
    currentYearOnly: true,
  },
];

/** Redis key the Activity page reads a league's live MFL last-visit map from. */
export const lastVisitKey = (slug) => `mfl:owner-last-visit:${slug}`;

/**
 * Owner-activity sync (scripts/hold-owner-last-visit.mjs): each franchise's MFL
 * `lastVisit`, read per request by the Activity pages through
 * src/utils/owner-last-visit-live.ts. A run where any owner logged in used to
 * be a commit, and so a production build, three or four times a day.
 */
export const LAST_VISIT_GROUPS = [
  {
    group: 'owner-last-visit',
    match: /^data\/([^/]+)\/owner-last-visit\.json$/,
    redisKey: (m) => lastVisitKey(m[1]),
  },
];

/** Every league's last-visit file on disk, changed or not — see currentInjuryFiles. */
export function currentLastVisitFiles(paths) {
  return paths
    .map((p) => p.match(LAST_VISIT_GROUPS[0].match))
    .filter(Boolean)
    .map((m) => ({ path: m[0], key: lastVisitKey(m[1]) }));
}

/**
 * Is `year` the league year MFL is live in for the league whose data lives in
 * `data/<dir>`? Each league's own rollover (registry `leagueYearRollover`: the
 * AFL's is June 1), so from Feb 14 to June 1 the AFL's new-year files — which
 * nothing overlays yet — commit as before. An unknown directory is never
 * current, so it commits as before too.
 */
export function isCurrentLeagueYear(dir, year, now = new Date()) {
  const league = ALL_LEAGUES.find((l) => l.dataPath === `data/${dir}`);
  return !!league && year === leagueYearFor(league, now);
}

const snapshotKey = (group) => `mfl:held-sync:snapshot-at:${group}`;

/** Tracked files the run modified (`git status --porcelain` lines); new files are never held. */
export function modifiedPaths(porcelain) {
  return porcelain
    .split('\n')
    .filter((line) => /^( M|M |MM)/.test(line))
    .map((line) => line.slice(3).trim());
}

/**
 * Group the modified paths by held group, keeping each path's regex match. A
 * `currentYearOnly` group takes a year-keyed path only when `isCurrent` says
 * that year is live; anything else is left for the commit.
 */
export function heldChanges(paths, groups = HELD_GROUPS, { isCurrent = isCurrentLeagueYear } = {}) {
  const out = new Map();
  for (const p of paths) {
    for (const g of groups) {
      const m = p.match(g.match);
      if (!m) continue;
      if (g.currentYearOnly && m[2] && !isCurrent(m[1], Number(m[2]))) continue;
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
