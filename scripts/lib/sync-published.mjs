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
