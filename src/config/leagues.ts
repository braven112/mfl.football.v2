/**
 * Typed wrapper around the league registry (src/config/leagues.mjs).
 *
 * App code should import from here; node scripts import the .mjs directly.
 * The registry is the single source of truth for league ids, slugs, names,
 * MFL hosts, data paths, domains, and feature flags.
 */

import type { LeagueSlug } from '../types/nav';
import {
  LEAGUES as RAW_LEAGUES,
  DEFAULT_LEAGUE_SLUG as RAW_DEFAULT,
  DEFAULT_LEAGUE_ID as RAW_DEFAULT_ID,
  getLeagueBySlug as rawGetBySlug,
  getLeagueById as rawGetById,
  getLeagueByPath as rawGetByPath,
  buildHostToSlugMap,
} from './leagues-data.mjs';

/** Canonical slug: the path segment under src/pages/ */
export type CanonicalLeagueSlug = 'theleague' | 'afl-fantasy';

export interface LeagueFeatures {
  contracts: boolean;
  salaryCap: boolean;
  keepers: boolean;
  powerRankings: boolean;
  liveLineups: boolean;
  schefterFeed: boolean;
  liveScoring: boolean;
}

/** Date (month is 1-indexed) on which a league flips to the new MFL league year. */
export interface LeagueYearRollover {
  /** 1-indexed month (1 = January, 6 = June). */
  month: number;
  /** Day of month. */
  day: number;
}

export interface LeagueDefinition {
  id: string;
  slug: CanonicalLeagueSlug;
  /** Short slug used by nav config / styles */
  navSlug: LeagueSlug;
  name: string;
  mflHost: string;
  dataPath: string;
  domains: string[];
  /**
   * Optional per-league year-rollover date. Present for leagues whose MFL
   * season is created on a different schedule than TheLeague's Feb 14 default
   * (e.g. AFL rolls over June 1). Consumed by getAflLeagueYear() in
   * src/utils/league-year.ts.
   */
  leagueYearRollover?: LeagueYearRollover;
  /**
   * True for leagues where the same NFL player can be rostered by more than
   * one franchise at once (AFL's 24-team duplicate-player conferences).
   * Logic that infers anything from "player is on another franchise's
   * roster" must be skipped for these leagues.
   */
  duplicatePlayers?: boolean;
  features: LeagueFeatures;
}

export const LEAGUES = RAW_LEAGUES as Record<CanonicalLeagueSlug, LeagueDefinition>;
export const DEFAULT_LEAGUE_SLUG = RAW_DEFAULT as CanonicalLeagueSlug;
/** MFL numeric id of the default league. Use instead of hardcoding '13522'. */
export const DEFAULT_LEAGUE_ID = RAW_DEFAULT_ID as string;
export const ALL_LEAGUES: LeagueDefinition[] = Object.values(LEAGUES);

export function getLeagueBySlug(slug: string): LeagueDefinition | null {
  return rawGetBySlug(slug) as LeagueDefinition | null;
}

export function getLeagueById(id: string): LeagueDefinition | null {
  return rawGetById(id) as LeagueDefinition | null;
}

/** Resolve a URL pathname to its league; defaults to theleague. */
export function getLeagueByPath(pathname: string): LeagueDefinition {
  return rawGetByPath(pathname) as LeagueDefinition;
}

/** Whether a feature is enabled for the given league slug. */
export function leagueHasFeature(slug: string, feature: keyof LeagueFeatures): boolean {
  return getLeagueBySlug(slug)?.features[feature] ?? false;
}

export { buildHostToSlugMap };
