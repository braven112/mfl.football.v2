/**
 * Schefter league resolution for API routes.
 *
 * Authed routes resolve the league from the session JWT (`user.leagueId`) —
 * sessions are bound to exactly one league, so an AFL session physically
 * cannot write into TheLeague's queue. Public routes accept `?league=<slug>`
 * (canonical or navSlug) and default to TheLeague so every pre-multi-league
 * URL keeps working unchanged.
 *
 * Feed/config access: both leagues' JSON is statically imported and selected
 * by slug (precedent: afl-fantasy pages already statically import
 * data/afl-fantasy/schefter-feed.json — Vite bundles JSON outside src/).
 */

import type { AuthUser } from './auth';
import {
  LEAGUES,
  DEFAULT_LEAGUE_SLUG,
  getLeagueById,
  type LeagueDefinition,
} from '../config/leagues';
import theLeagueConfig from '../data/theleague.config.json';
import aflConfig from '../../data/afl-fantasy/afl.config.json';
import theLeagueFeed from '../data/theleague/schefter-feed.json';
import aflFeed from '../../data/afl-fantasy/schefter-feed.json';
import type { SchefterFeed } from '../types/schefter';
import { getLeagueYearForSlug } from './league-year';

export interface LeagueTeamConfig {
  franchiseId: string;
  name: string;
  nameMedium?: string;
  nameShort?: string;
  abbrev?: string;
  division?: string;
  conference?: string;
  tier?: string;
}

export interface SchefterLeagueConfig {
  teams: LeagueTeamConfig[];
}

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

/** The league's Schefter feed (statically imported, selected by slug). */
export function getSchefterFeed(league: LeagueDefinition): SchefterFeed {
  return (league.slug === 'afl-fantasy' ? aflFeed : theLeagueFeed) as SchefterFeed;
}

/** The league's team config (statically imported, selected by slug). */
export function getSchefterLeagueConfig(league: LeagueDefinition): SchefterLeagueConfig {
  return (league.slug === 'afl-fantasy'
    ? aflConfig
    : theLeagueConfig) as unknown as SchefterLeagueConfig;
}

/** True when the league's tip system is live (schefterTips feature flag). */
export function leagueHasSchefterTips(league: LeagueDefinition): boolean {
  return league.features.schefterTips === true;
}

/** Find a team by 4-digit franchise id in the league's config. */
export function findLeagueTeam(
  league: LeagueDefinition,
  franchiseId: string,
): LeagueTeamConfig | undefined {
  return getSchefterLeagueConfig(league).teams.find(
    (t) => t.franchiseId === franchiseId,
  );
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
