/**
 * The site's half of accounting-season-data.ts: fetch the files it reads
 * through the league-data loader (Vercel Blob in production), then run its
 * sync assemblers over what came back.
 *
 * Kept apart from accounting-season-data.ts because that module is also run
 * by node scripts under tsx, which read off disk and cannot import the
 * Vite-only loader (it uses `import.meta.glob`).
 */
import type { LeagueDefinition } from '../config/leagues';
import { loadLeagueData } from './league-data';
import {
  franchisePaths,
  loadFranchises,
  loadPayoutSeasonData,
  payoutSeasonPaths,
  type PayoutSeasonData,
  type SeasonDataReader,
} from './accounting-season-data';

/**
 * Load `paths` and return a sync reader over them. A missing file — or one the
 * store could not serve — reads as null, which the assemblers already treat as
 * "absent": one unreadable feed degrades a prize to unresolved instead of
 * failing the page.
 */
export async function loadSeasonDataReader(paths: Iterable<string>): Promise<SeasonDataReader> {
  const loaded = new Map<string, unknown>();
  await Promise.all(
    [...new Set(paths)].map(async (p) => {
      loaded.set(p, await loadLeagueData(p).catch(() => null));
    }),
  );
  return (repoPath) => loaded.get(repoPath) ?? null;
}

/** `loadPayoutSeasonData`, reading through the loader. */
export async function fetchPayoutSeasonData(league: LeagueDefinition, year: number): Promise<PayoutSeasonData> {
  const read = await loadSeasonDataReader(payoutSeasonPaths(league, year));
  return loadPayoutSeasonData(league, year, read);
}

/** `loadFranchises`, reading through the loader. */
export async function fetchFranchises(
  league: LeagueDefinition,
  year: number,
): Promise<Array<{ id: string; name: string }>> {
  const read = await loadSeasonDataReader(franchisePaths(league, year));
  return loadFranchises(league, year, read);
}
