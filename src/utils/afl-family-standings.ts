/**
 * The route half of the AFL-family standings page (components/afl-family/
 * StandingsPage), shared by /afl-fantasy/standings and the custom-site demo's
 * /keeper/standings.
 *
 * It lives outside the component because two of its answers are REDIRECTS,
 * and `Astro.redirect()` only redirects from a page. The feeds come in from
 * the route too: a glob specifier cannot be a runtime variable.
 */
import type { LeagueDefinition } from '../config/leagues';
import { getCurrentSeasonYear } from './league-year';
import { getStandingsFeedWithLiveRefresh, type StandingsFeed } from './live-standings';

/** Re-key an eager feed glob (`…/mfl-feeds/2025/standings.json`) by season. */
export function feedsByYear<T = any>(glob: Record<string, unknown>): Map<number, T> {
  const out = new Map<number, T>();
  for (const [path, mod] of Object.entries(glob)) {
    const year = path.match(/\/(\d{4})\/[^/]+$/)?.[1];
    if (year) out.set(Number(year), mod as T);
  }
  return out;
}

export interface StandingsFeeds {
  standings: Map<number, StandingsFeed>;
  fetchMeta: Map<number, { lastFetched?: string }>;
  weeklyResults: Map<number, any>;
  league: Map<number, any>;
}

export type StandingsRoute =
  | { redirect: string }
  | {
      selectedYear: number;
      availableYears: number[];
      feed: StandingsFeed;
      lastFetched: Date | null;
    };

/**
 * Which season to show, and its standings (the committed snapshot, refreshed
 * live for the current season) — or where to send a request for a season
 * that has none.
 */
export async function resolveStandingsRoute(
  url: URL,
  league: LeagueDefinition,
  baseUrl: string,
  feeds: StandingsFeeds,
): Promise<StandingsRoute> {
  const availableYears = [...feeds.standings.keys()].sort((a, b) => b - a);
  const currentSeasonYear = getCurrentSeasonYear();
  const defaultYear = availableYears.includes(currentSeasonYear) ? currentSeasonYear : availableYears[0] || currentSeasonYear;
  const requestedYear = url.searchParams.get('year');
  const selectedYear = requestedYear ? parseInt(requestedYear, 10) : defaultYear;
  if (!availableYears.includes(selectedYear)) return { redirect: `${baseUrl}/standings?year=${defaultYear}` };

  const { feed, live, fetchedAt } = await getStandingsFeedWithLiveRefresh({
    league,
    year: selectedYear,
    committedFeed: feeds.standings.get(selectedYear),
  });
  if (!feed || !feed.leagueStandings || (feed as { error?: unknown }).error) {
    return { redirect: `${baseUrl}/standings?year=${defaultYear}` };
  }
  // "Last updated": the live fetch time when live data is in play, otherwise
  // the committed snapshot's fetch timestamp.
  const meta = feeds.fetchMeta.get(selectedYear);
  const lastFetched = live ? fetchedAt : meta?.lastFetched ? new Date(meta.lastFetched) : null;
  return { selectedYear, availableYears, feed, lastFetched };
}
