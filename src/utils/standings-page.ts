/**
 * Data loading for the shared standings page
 * (`src/components/shared/standings/StandingsPage.astro`).
 *
 * The ROUTE owns everything that has to live in a page: the lazy globs (a
 * static import specifier cannot be a runtime variable), `Astro.redirect()`
 * (a component cannot redirect) and the preferred-team cookie write (a
 * component cannot set a cookie). Everything else is here, so each league's
 * route stays a thin wrapper and no two leagues re-derive the same season
 * logic.
 *
 * Standings are RESULTS-shaped, so the default season is
 * `getCurrentSeasonYear()` (the Labor Day clock), never the league year.
 */
import type { LeagueDefinition } from '../config/leagues';
import type { StandingsFranchise } from '../types/standings';
import { getCurrentSeasonYear } from './league-year';
import { getStandingsFeedWithLiveRefresh, type StandingsFeed } from './live-standings';
import { loadSeasonFeed, seasonsFromGlob, type LazyFeedGlob } from './mfl-feed-glob';
import { getDivisionChampionDetails } from './standings';
import { HISTORICAL_TEAM_ICON_FALLBACK } from './team-names';

export type StandingsView = 'division' | 'league' | 'all_play';

/** The league config shape every standings producer takes. */
export type StandingsConfig = Parameters<typeof getDivisionChampionDetails>[1];

/** The view query param, defaulting to the division view. */
export function parseStandingsView(raw: string | null): StandingsView {
  return raw === 'league' || raw === 'all_play' ? raw : 'division';
}

export interface StandingsSeasonChoice {
  /** Newest first — the order the year selector lists them. */
  availableYears: number[];
  defaultYear: number;
  selectedYear: number;
  /** False when the requested year has no feed: the route redirects to `defaultYear`. */
  valid: boolean;
}

/**
 * Which season to show. The current season when it has a feed, else the
 * newest one on disk. A requested year the glob does not carry is invalid.
 */
export function chooseStandingsSeason(
  standingsFeeds: LazyFeedGlob,
  requested: string | null,
  currentSeasonYear: number = getCurrentSeasonYear()
): StandingsSeasonChoice {
  const availableYears = seasonsFromGlob(standingsFeeds).sort((a, b) => b - a);
  const defaultYear = availableYears.includes(currentSeasonYear)
    ? currentSeasonYear
    : availableYears[0] || currentSeasonYear;
  const selectedYear = requested ? parseInt(requested, 10) : defaultYear;
  return { availableYears, defaultYear, selectedYear, valid: availableYears.includes(selectedYear) };
}

export interface LoadedStandingsSeason {
  /** MFL's rows, in MFL's order. Null when the feed is missing or an error. */
  franchises: StandingsFranchise[] | null;
  /** Live fetch time for the current season, else the committed snapshot's. */
  lastFetched: Date | null;
}

/**
 * The season's standings: the committed snapshot, refreshed live from MFL for
 * the current season (60s TTL, falls back to the snapshot on any failure).
 */
export async function loadStandingsSeason(options: {
  league: LeagueDefinition;
  year: number;
  standingsFeeds: LazyFeedGlob;
  fetchMetaFeeds?: LazyFeedGlob;
  /**
   * Refresh the current season live from MFL. Default true. False for a
   * league whose columns are partly DERIVED from other committed feeds
   * (archies): MFL's live export there has no `pf` or `h2hpct` and runs ahead
   * of the committed weekly scores, so a live overall record would sit beside
   * a division record a week older. The sync writes all three together.
   */
  liveRefresh?: boolean;
}): Promise<LoadedStandingsSeason> {
  const { league, year, standingsFeeds, fetchMetaFeeds, liveRefresh = true } = options;
  const committedFeed = ((await loadSeasonFeed(standingsFeeds, year)) ?? undefined) as
    | StandingsFeed
    | undefined;
  const { feed, live, fetchedAt } = liveRefresh
    ? await getStandingsFeedWithLiveRefresh({ league, year, committedFeed })
    : { feed: committedFeed, live: false, fetchedAt: null };
  if (!feed || !feed.leagueStandings || feed.error) return { franchises: null, lastFetched: null };

  const fetchMeta = fetchMetaFeeds
    ? ((await loadSeasonFeed(fetchMetaFeeds, year)) as { lastFetched?: string } | null)
    : null;
  const lastFetched = live
    ? fetchedAt
    : fetchMeta?.lastFetched
      ? new Date(fetchMeta.lastFetched)
      : null;

  const rows = feed.leagueStandings.franchise as StandingsFranchise[] | StandingsFranchise | undefined;
  return { franchises: Array.isArray(rows) ? rows : rows ? [rows] : [], lastFetched };
}

export interface DefendingChampion {
  name: string;
  icon: string;
}

/**
 * Last season's division winners, keyed by the division they won, each shown
 * with the identity it wore THAT season (falling back to today's when the era
 * icon is the placeholder). The winner is the division's first row in MFL's
 * order — never a local re-sort.
 */
export async function loadDefendingChampions(options: {
  standingsFeeds: LazyFeedGlob;
  previousYear: number;
  /** That season's own alignment and identities. */
  previousConfig: StandingsConfig;
  currentTeams: Array<{ franchiseId: string; name: string; icon?: string }>;
}): Promise<Record<string, DefendingChampion>> {
  const previousFeed = (await loadSeasonFeed(options.standingsFeeds, options.previousYear)) as
    | { leagueStandings?: { franchise: StandingsFranchise[] }; error?: unknown }
    | null;
  if (!previousFeed?.leagueStandings || previousFeed.error) return {};

  const champions = getDivisionChampionDetails(
    previousFeed.leagueStandings.franchise,
    options.previousConfig,
    { preserveFeedOrder: true }
  );
  const currentById = new Map(options.currentTeams.map((t) => [t.franchiseId, t]));
  const out: Record<string, DefendingChampion> = {};
  for (const [divisionName, champ] of Object.entries(champions)) {
    const current = currentById.get(champ.id);
    const eraIconUsable = champ.icon && champ.icon !== HISTORICAL_TEAM_ICON_FALLBACK;
    out[divisionName] = {
      name: champ.name ?? current?.name ?? '',
      icon: eraIconUsable ? champ.icon : (current?.icon ?? champ.icon),
    };
  }
  return out;
}
