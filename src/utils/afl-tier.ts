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
import { type AflTier, PREMIER_LEAGUE, D_LEAGUE, getTierLogo, getTierLogoDark } from './afl-tier-logo';

export { type AflTier, PREMIER_LEAGUE, D_LEAGUE, getTierLogo, getTierLogoDark };

/**
 * Display name for the 2017 season of this competition, and the label of the
 * matching `afl-cup` award in afl-awards.ts. Keep the two in step — the
 * standings page heading and the trophy badge name the same trophy.
 */
export const AFL_CUP = 'AFL Cup';

/**
 * First season of the all-play side competition — the LAST season branded the
 * "AFL Cup" (commissioner, 2026-08-17), and the competition the Premier
 * League / D-League split grew out of the following year.
 *
 * The Cup ran 2015-2016 as a knockout and 2017 as ONE combined 24-team
 * all-play table: the league kept the name through the format change, which
 * is why the Cup's MFL bracket slot still exists in 2017 config carrying no
 * games. The standings page heads this season's table "AFL Cup"
 * (src/pages/afl-fantasy/standings.astro) — it was NEVER called the "Founders
 * Table"; that was our invention and it shipped as the season's heading until
 * the correction.
 *
 * Two things that are easy to get wrong here, both load-bearing:
 *
 * - **It ends in WEEK 16**, not week 17 like every other season. That one week
 *   decides the Cup: through 16 Smokane FC leads 259-109, and week 17 flips it
 *   to Fullybaked. Smokane FC is the answer the league's own payout records
 *   give. The per-season cutoff lives in
 *   afl.config.json#tierCompetition.cutoffWeekByYear and is resolved by
 *   resolveTierCutoffWeek (src/utils/all-play.mjs) — read the warning there
 *   before adding another year: 2017's week 16 is a recorded fact about 2017,
 *   NOT an instance of "the week of the title game", which is a rule that
 *   would flip 2020's recorded D-League champion.
 * - The promotion cutoff is real and is NOT affected by the cutoff week: the
 *   top 12 is the same set of franchises at week 16 and week 17, and both are
 *   an EXACT match for the 2018 Premier League roster (verified against
 *   premierleague-2018.js), so the standings page draws the promotion line
 *   after rank 12 for this season. No skin grouping script exists for 2017
 *   itself because one table needs no grouping.
 *
 * awards-history.json originally carried mistaken premier-league /
 * dleague-champion entries for 2017 (Smokane FC / Titsburgh Feelers, neither
 * of which is rank 1 of the combined table or rank 1 of the bottom 12) —
 * removed once the combined-table structure was confirmed. 2017's gold award
 * is `afl-cup`, not a tier championship.
 */
export const TIER_COMPETITION_FIRST_SEASON = 2017;

/**
 * First season played as split Premier League / D-League tables. Membership
 * for every split season 2018+ comes from the league skin's per-year grouping
 * scripts (mfl.football/afl-fantasy.com/assets/js/premierleague-YYYY.js) —
 * per Brandon, those js files are THE source of truth for who was in which
 * league — recorded in tier-history.json. Verified: cutoff-week all-play
 * within the js tiers reproduces the hand-recorded champions for 2018
 * (Premier 0014 / D-League 0003) and 2019 (0001 / 0002).
 *
 * Movement rule note: owners who join the league always START in the D-League,
 * regardless of which tier the franchise slot they take over competed in — in
 * a season with owner turnover, correspondingly fewer Premier League teams are
 * relegated. The roll-forward in scripts/compute-afl-tier-movement.mjs is
 * franchise-id-based and cannot detect owner changes on its own; those years
 * need the recorded membership (or a manual correction) rather than the pure
 * constitution formula.
 */
export const TIER_SPLIT_FIRST_SEASON = 2018;

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
