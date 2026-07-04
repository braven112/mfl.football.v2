/**
 * AFL tier readers.
 *
 * The AFL runs an all-play side competition split into two tiers —
 * Premier League and D-League — with promotion/relegation between them.
 *
 * Per-season tier membership and champions live in
 * data/afl-fantasy/tier-history.json (the single source of truth — MFL does
 * not store tiers). The reader helpers below expose that file so pages derive
 * "who was in which tier in year N" from one place instead of the static,
 * current-makeup-only afl.config.json. The season-end roll-forward that writes
 * that file lives in scripts/compute-afl-tier-movement.mjs +
 * scripts/lib/afl-tier-standings.mjs.
 *
 * The tier→logo mapping + tier-name type/constants live in afl-tier-logo.ts
 * (JSON-free) and are re-exported here for back-compat; import them from there
 * directly when you don't need the tier-history readers, to keep the
 * tier-history JSON out of logo-only module graphs.
 */

import tierHistory from '../../data/afl-fantasy/tier-history.json';
import { type AflTier, PREMIER_LEAGUE, D_LEAGUE, getTierLogo } from './afl-tier-logo';

export { type AflTier, PREMIER_LEAGUE, D_LEAGUE, getTierLogo };

/**
 * First season of the all-play side competition. The inaugural year ran as ONE
 * combined 24-team table (no separate tier champions — the awards ledger
 * records none for 2016); its final standings seeded the tiers for 2017: top
 * 12 → Premier League, bottom 12 → D-League.
 */
export const TIER_COMPETITION_FIRST_SEASON = 2016;

/**
 * First season played as split Premier League / D-League tables — the first
 * year with distinct tier champions (awards-history: Smokane FC / Titsburgh
 * Feelers, source manual:league-awards). Per-season tier ROSTERS for 2017-2019
 * were never recorded anywhere recoverable (tier-history.json starts at 2020),
 * so those seasons can only be rendered as a combined all-play table.
 *
 * Movement rule note: owners who join the league always START in the D-League,
 * regardless of which tier the franchise slot they take over competed in — in
 * a season with owner turnover, correspondingly fewer Premier League teams are
 * relegated. The roll-forward in scripts/compute-afl-tier-movement.mjs is
 * franchise-id-based and cannot detect owner changes on its own; those years
 * need the recorded membership (or a manual correction) rather than the pure
 * constitution formula.
 */
export const TIER_SPLIT_FIRST_SEASON = 2017;

/** A season's tier champions, keyed by award slug. */
export interface TierChampions {
  'premier-league'?: string;
  'dleague-champion'?: string;
}

interface TierSeason {
  membership?: Record<string, AflTier | string>;
  membershipSource?: string;
  champions?: TierChampions;
  championsSource?: string;
  allPlayStandings?: Record<string, string[]>;
}

const SEASONS = (tierHistory as { seasons?: Record<string, TierSeason> }).seasons ?? {};

/**
 * Per-season tier membership ({ franchiseId: tier }) from tier-history.json,
 * or null when that season's membership was never recorded (pre-2025).
 */
export function getTierMembership(year: number | string): Record<string, AflTier> | null {
  const m = SEASONS[String(year)]?.membership;
  if (!m || !Object.keys(m).length) return null;
  return m as Record<string, AflTier>;
}

/** The tier a franchise competed in for a given season, or null if unknown. */
export function getTierForYear(franchiseId: string, year: number | string): AflTier | null {
  const tier = getTierMembership(year)?.[franchiseId];
  return tier === PREMIER_LEAGUE || tier === D_LEAGUE ? tier : null;
}

/** A season's recorded tier champions ({ premier-league, dleague-champion }). */
export function getTierChampions(year: number | string): TierChampions | null {
  return SEASONS[String(year)]?.champions ?? null;
}

/** All years with recorded tier membership, ascending. */
export function getTierMembershipYears(): number[] {
  return Object.keys(SEASONS)
    .filter((y) => SEASONS[y].membership && Object.keys(SEASONS[y].membership!).length)
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * The most recent season's tier membership — the "current makeup". Prefers the
 * latest recorded membership year (which includes the rolled-forward upcoming
 * season once a season completes).
 */
export function getCurrentTierMembership(): Record<string, AflTier> | null {
  const years = getTierMembershipYears();
  return years.length ? getTierMembership(years[years.length - 1]) : null;
}
