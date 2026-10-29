/**
 * The league data every request may read synchronously, loaded before the
 * route runs (called from src/middleware.ts).
 *
 * League data is read through src/utils/league-data.ts, which fetches it from
 * Vercel Blob in production. A handful of SYNC helpers are called from all
 * over the site — `getPlayerMap` / `getPlayer` / `getGlobalPlayerMap` alone
 * from ~50 places — and turning each into async would ripple through every
 * page. Instead their hot set is preloaded here: the player identity files
 * for the current league and season years, the NFL bye calendar, and the
 * league.json the layout's waiver-system check reads on every page. The loader keeps what it reads in
 * memory for as long as the instance stays warm, so after an instance's first
 * request this costs a few map lookups.
 *
 * Anything outside the hot set (a historical season, a league's own feeds) is
 * preloaded by the page that needs it, through the owning helper's
 * `preload…` export.
 */
import {
  getCurrentLeagueYear,
  getCurrentSeasonYear,
  getLeagueYearForSlug,
  getTestDateFromSearchParams,
} from './league-year';
import { preloadPlayerIdentity } from './player-map';
import { BYE_WEEKS_FILE } from './nfl-bye-weeks';
import { preloadLeagueData } from './league-data';
import { preloadWaiverSystem } from './waiver-system';

/**
 * League years whose identity files are in the hot set: today's league and
 * season years, plus a `?testDate=`'s when the request carries one.
 */
export function hotIdentityYears(now?: Date, testDate?: Date | null): number[] {
  const dates = testDate ? [now, testDate] : [now];
  return [...new Set(dates.flatMap((d) => [getCurrentLeagueYear(d), getCurrentSeasonYear(d)]))];
}

/** Leagues whose waiver feed `getWaiverSystem` reads (src/utils/waiver-system.ts). */
const WAIVER_LEAGUES = ['theleague', 'afl-fantasy'];

/**
 * Preload the hot set. Never throws: a store outage must not take every route
 * down with it — the sync helpers fall back on their own (and log).
 */
export async function preloadRequestLeagueData(url?: URL): Promise<void> {
  try {
    const testDate = url ? getTestDateFromSearchParams(url.searchParams) : null;
    await Promise.all([
      preloadPlayerIdentity(hotIdentityYears(undefined, testDate)),
      preloadLeagueData([BYE_WEEKS_FILE]),
      ...WAIVER_LEAGUES.map((slug) => preloadWaiverSystem(slug, getLeagueYearForSlug(slug, testDate ?? undefined))),
    ]);
  } catch (err) {
    console.error('[league-data] request preload failed:', err);
  }
}
