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
  leagueOrigin as rawLeagueOrigin,
  leagueUrl as rawLeagueUrl,
  stripLeaguePrefix as rawStripLeaguePrefix,
  ensureLeaguePrefix as rawEnsureLeaguePrefix,
  buildHostToSlugMap,
  defaultMflWriteHost,
  SHARED_APP_ORIGIN,
} from './leagues-data.mjs';

/** Canonical slug: the path segment under src/pages/ */
export type CanonicalLeagueSlug = 'theleague' | 'afl-fantasy' | 'best-ball-1';

export interface LeagueFeatures {
  contracts: boolean;
  salaryCap: boolean;
  keepers: boolean;
  powerRankings: boolean;
  liveLineups: boolean;
  schefterFeed: boolean;
  /**
   * Anonymous tip submission + rumor-mill pipeline (tip page, style book,
   * whisper-back threads, rumor scanner lane). Distinct from schefterFeed,
   * which only governs the news feed page.
   */
  schefterTips: boolean;
  liveScoring: boolean;
  /**
   * Commissioner accounting page: read/write of MFL's league accounting
   * ledger and the season payout run. Requires a league that (a) actually
   * settles money on MFL and (b) has a documented prize table under
   * `payouts` — a league with the flag on and no `payouts` can still keep
   * the ledger, it just has no payouts to plan.
   */
  accounting: boolean;
}

/**
 * How the payout planner finds the franchise that won a prize. Every kind is
 * derived from data the league already publishes — none of them is a
 * hand-entered winner.
 */
export type PayoutSource =
  /** Final standing N in the league's championship/placement brackets. */
  | { kind: 'placement'; place: number }
  /** A slug already resolved in the league's awards history. */
  | { kind: 'award'; slug: string }
  /** Highest score in each played regular-season week. */
  | { kind: 'weekly-high'; weeks: number }
  /**
   * Every franchise holding one of these seeds in a conference playoff
   * bracket. The AFL pays its division titles and wild cards this way: seeds
   * 1-2 are the division winners who actually made the playoffs, seeds 3-4
   * the wild cards. Keyed on seed rather than on a division-title award
   * because a division winner who misses the playoffs is not paid.
   */
  | { kind: 'playoff-seed'; seeds: number[] }
  /** Rank N of an all-play tier table (AFL Premier League / D-League). */
  | { kind: 'tier-rank'; tier: string; rank: number };

/** One line of a league's prize table. */
export interface PayoutPrize {
  /** Stable key — the ledger's idempotency handle. Never renumber these. */
  key: string;
  label: string;
  /** Dollars OWED TO the winner. Sign conversion happens in the writer. */
  amount: number;
  source: PayoutSource;
}

export interface LeaguePayouts {
  /**
   * The constitution's stated prize pool. Display-and-reconcile only — the
   * planner never scales a prize to fit it.
   */
  prizePool: number;
  prizes: PayoutPrize[];
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
  /** Canonical host for absolute URLs to this league — see leagueOrigin(). */
  canonicalDomain?: string;
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
  /**
   * True for draft-only best-ball leagues: the startup draft is the whole
   * game — no lineups, no add/drops, no in-season management UI. Nav and
   * shared components must not offer roster-management actions for these
   * leagues, and their nav links are opt-in (see nav-utils).
   */
  bestBall?: boolean;
  /**
   * Weeks that run Throwback Week — franchises wear a legacy identity instead
   * of their current one. Absent for a league that doesn't run it, which is
   * every league but TheLeague today.
   */
  throwbackWeeks?: number[];
  /**
   * Prize table for the accounting page's payout run. Absent for a league
   * that pays out nothing (or hasn't written its table down yet) — the page
   * then offers the ledger and CSV import without a payouts panel.
   */
  payouts?: LeaguePayouts;
  features: LeagueFeatures;
}

export const LEAGUES = RAW_LEAGUES as Record<CanonicalLeagueSlug, LeagueDefinition>;
export const DEFAULT_LEAGUE_SLUG = RAW_DEFAULT as CanonicalLeagueSlug;
/** MFL numeric id of the default league. Use instead of hardcoding '13522'. */
export const DEFAULT_LEAGUE_ID = RAW_DEFAULT_ID as string;
export const ALL_LEAGUES: LeagueDefinition[] = Object.values(LEAGUES);
/**
 * The default league's full registry entry — for TheLeague-only components
 * (auction/draft heroes, demo/prototype components) that need a
 * `mflHost`/`leagueId` prop default and don't take a `league` param. Use
 * `DEFAULT_LEAGUE.mflHost` / `DEFAULT_LEAGUE.id` instead of each call site
 * re-deriving `getLeagueBySlug(DEFAULT_LEAGUE_SLUG)!` independently (code
 * review flagged this pattern copy-pasted across 6 components).
 */
export const DEFAULT_LEAGUE: LeagueDefinition = LEAGUES[DEFAULT_LEAGUE_SLUG];

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

/**
 * A league's prize table, or null when it publishes none. Separate from
 * `leagueHasFeature(slug, 'accounting')` on purpose: the ledger and the
 * payout run are independently available.
 */
export function getLeaguePayouts(slug: string): LeaguePayouts | null {
  return getLeagueBySlug(slug)?.payouts ?? null;
}

/**
 * Resolve a league by its nav slug ('theleague' | 'afl'). The same lookup
 * was previously hand-rolled with ALL_LEAGUES.find() at several call sites
 * (a copy-paste pattern code review has flagged before — see DEFAULT_LEAGUE).
 */
export function getLeagueByNavSlug(navSlug: LeagueSlug): LeagueDefinition {
  const league = ALL_LEAGUES.find((l) => l.navSlug === navSlug);
  if (!league) {
    throw new Error(`No league registered for nav slug '${navSlug}'`);
  }
  return league;
}

/**
 * Canonical absolute origin for a league (e.g. 'https://www.theleague.us'),
 * or null when the league has no apex domain. Session cookies are host-only,
 * so every producer of absolute league URLs must agree on this host.
 */
export function leagueOrigin(league: LeagueDefinition): string | null {
  return rawLeagueOrigin(league) as string | null;
}

/**
 * Absolute URL to a page for a league, with the league's own redundant path
 * prefix stripped (`/theleague/calendar` on www.theleague.us → `/calendar`).
 * Use this instead of concatenating leagueOrigin() with a prefixed path.
 */
export function leagueUrl(league: LeagueDefinition, path?: string): string {
  return rawLeagueUrl(league, path) as string;
}

/** Strip a league's own path prefix from an internal path. See leagueUrl(). */
export function stripLeaguePrefix(league: LeagueDefinition, path: string): string {
  return rawStripLeaguePrefix(league, path) as string;
}

/**
 * Mirror of stripLeaguePrefix — guarantee a league-local path carries its
 * prefix (what routes on the shared host). Cross-league paths pass through.
 */
export function ensureLeaguePrefix(league: LeagueDefinition, path: string): string {
  return rawEnsureLeaguePrefix(league, path) as string;
}

export { buildHostToSlugMap, defaultMflWriteHost, SHARED_APP_ORIGIN };
