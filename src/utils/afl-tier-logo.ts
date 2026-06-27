/**
 * AFL tier logo + tier-name primitives.
 *
 * Deliberately JSON-free: the tier→logo mapping and the tier-name type/constants
 * live here, separate from the tier-history readers in afl-tier.ts, so logo-only
 * consumers (e.g. TierAllPlayStandingsTable, AflStandingsCompact) don't pull
 * data/afl-fantasy/tier-history.json into their module graph. Mirrors
 * getConferenceLogo in afl-conference.ts.
 */

export type AflTier = 'Premier League' | 'D-League';

export const PREMIER_LEAGUE: AflTier = 'Premier League';
export const D_LEAGUE: AflTier = 'D-League';

/**
 * Resolve the tier logo path (served from public/). Anything that isn't
 * "Premier League" falls back to the D-League mark.
 */
export function getTierLogo(tierName: string): string {
  return tierName === PREMIER_LEAGUE
    ? '/assets/afl/premier.svg'
    : '/assets/afl/dleague.svg';
}
