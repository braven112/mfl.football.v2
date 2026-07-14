/**
 * AFL tier logo + tier-name primitives.
 *
 * Deliberately JSON-free: the tier→logo mapping and the tier-name type/constants
 * live here, separate from the tier-history readers in afl-tier.ts, so logo-only
 * consumers (e.g. the standings tier tables, AflStandingsCompact) don't pull
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

/**
 * Resolve the dark-mode tier logo path. Convention: same path + `-dark`
 * suffix (see /public/assets/afl/premier-dark.svg, dleague-dark.svg).
 * Pair with ThemeImage (src/components/ThemeImage.astro) for the CSS swap —
 * SSR can never know the resolved theme, so both variants must render and
 * the swap happens client-side via html.dark.
 */
export function getTierLogoDark(tierName: string): string {
  return tierName === PREMIER_LEAGUE
    ? '/assets/afl/premier-dark.svg'
    : '/assets/afl/dleague-dark.svg';
}
