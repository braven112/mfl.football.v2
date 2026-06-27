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
