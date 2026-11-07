/**
 * The files the roster sync writes — and, once it publishes them straight to
 * the league-data store, changes WITHOUT a Vercel build (plan: "Data syncs
 * without a Vercel build", phases 0-2).
 *
 * A page that compiles one of these into the function with a static import or
 * an `import.meta.glob` would keep showing the deploy's copy after a sync
 * moved the data on, so every reader goes through src/utils/league-data.ts.
 * tests/sync-published-reads.test.ts enforces that.
 *
 * Derived from the registry, like the sync's own league list: a launched league
 * joins on its registry entry alone.
 */
import { leaguesFor } from './league-jobs.mjs';
import { SKIP_DIRS, STORE_ROOTS } from './league-data-store.mjs';
import { globToRegExp } from '../../src/config/league-data-live.mjs';

/** Repo-relative globs (`*` one segment, `**` any depth), POSIX separators. */
export function syncPublishedPatterns(leagues = leaguesFor('mfl-sync')) {
  const perLeague = leagues.flatMap((l) => {
    const dir = String(l.dataPath).replace(/^\.?\//, '').replace(/\/+$/, '');
    return [`${dir}/mfl-feeds/**`, `${dir}/derived/**`];
  });
  return [
    ...perLeague,
    // scripts/update-salary-averages.mjs (contract leagues).
    'src/data/mfl-player-salaries-*.json',
    'src/data/mfl-salary-averages-*.json',
    'src/data/*/mfl-player-salaries-*.json',
    'src/data/*/mfl-salary-averages-*.json',
    'src/data/salary-history/**',
    'src/data/mfl-season-state.json',
    // scripts/fetch-live-odds.mjs (the off-season snapshot).
    'src/data/nfl/live-odds.json',
  ];
}

/**
 * Whether `path` is a file the store publishes under `patterns`: a JSON file
 * (the store is JSON-only — `rules-from-mfl.md` sits under `derived/**` but is
 * still bundled) outside the directories the store skips. Exactly the files a
 * live pointer can carry, so exactly the changes that need no build.
 */
export function isSyncPublishedStoreFile(path, patterns = syncPublishedPatterns()) {
  const p = String(path).replace(/^\.?\//, '');
  if (!p.endsWith('.json')) return false;
  if (!STORE_ROOTS.some((r) => p.startsWith(`${r}/`))) return false;
  if (p.split('/').some((seg) => SKIP_DIRS.has(seg))) return false;
  return patterns.some((g) => globToRegExp(g).test(p));
}

/**
 * The line a sync's commit carries once its data is live through the pointer
 * (scripts/league-data-pointer.mjs published it). scripts/vercel-ignore-build.mjs
 * skips the build for a commit that carries it and changes nothing else.
 */
export const leagueDataMarker = (overlay) => `[league-data: ${overlay}]`;

/** The overlay hash a commit message's marker names, or null. */
export function parseLeagueDataMarker(message) {
  return String(message ?? '').match(/\[league-data: ([0-9a-f]{32})\]/)?.[1] ?? null;
}
