/**
 * Schefter league resolution for API routes.
 *
 * Authed routes resolve the league from the session JWT (`user.leagueId`) —
 * sessions are bound to exactly one league, so an AFL session physically
 * cannot write into TheLeague's queue. Public routes accept `?league=<slug>`
 * (canonical or navSlug) and default to TheLeague so every pre-multi-league
 * URL keeps working unchanged.
 *
 * Feed/config DATA accessors live in schefter-league-data.ts — importing this
 * module never pulls the ~1.3MB of feed JSON into a route's graph. Re-exported
 * here for convenience of routes that need both.
 */

import type { AuthUser } from './auth';
import {
  LEAGUES,
  DEFAULT_LEAGUE_SLUG,
  getLeagueById,
  type LeagueDefinition,
} from '../config/leagues';
import { getLeagueYearForSlug } from './league-year';

export type {
  LeagueTeamConfig,
  SchefterLeagueConfig,
} from './schefter-league-data';

/**
 * Resolve the league for a Schefter API request.
 * Priority: session JWT leagueId → ?league= query param → TheLeague default.
 * Returns null when an explicit ?league= value is unknown (caller 400s).
 */
export function resolveSchefterLeague(opts: {
  user?: AuthUser | null;
  url: URL;
}): LeagueDefinition | null {
  const { user, url } = opts;
  if (user?.leagueId) {
    const byId = getLeagueById(user.leagueId);
    if (byId) return byId;
  }
  const param = url.searchParams.get('league');
  if (param) {
    const match = Object.values(LEAGUES).find(
      (l) => l.slug === param || l.navSlug === param,
    );
    return match ?? null;
  }
  return LEAGUES[DEFAULT_LEAGUE_SLUG];
}

/** True when the league's tip system is live (schefterTips feature flag). */
export function leagueHasSchefterTips(league: LeagueDefinition): boolean {
  return league.features.schefterTips === true;
}

/**
 * Query string a PUBLIC schefter API call needs for this league. The default
 * league omits the param (legacy URLs), every other league sends ?league=.
 * Single source of the "default league omits the param" convention — shared
 * components must use this instead of re-deriving it inline.
 */
export function publicLeagueQs(navSlug: string): string {
  return LEAGUES[DEFAULT_LEAGUE_SLUG].navSlug === navSlug ? '' : `?league=${navSlug}`;
}

/**
 * Season year for season-scoped Redis keys (leaderboards, style-book
 * seasons). Delegates to getLeagueYearForSlug so each league uses its own
 * rollover clock — TheLeague flips Feb 14, the AFL flips June 1. Using
 * TheLeague's clock for the AFL would split its season counters mid-season.
 */
export function schefterSeasonYear(league: LeagueDefinition, referenceDate?: Date): number {
  return getLeagueYearForSlug(league.slug, referenceDate);
}
