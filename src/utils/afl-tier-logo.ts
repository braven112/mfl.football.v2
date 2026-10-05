/**
 * AFL tier logo + tier-name primitives.
 *
 * Deliberately JSON-free: the tier→logo mapping and the tier-name type/constants
 * live here, separate from the tier-history readers in afl-tier.ts, so logo-only
 * consumers (e.g. the standings tier tables, AflStandingsCompact) don't pull
 * data/afl-fantasy/tier-history.json into their module graph. Mirrors
 * getConferenceLogo in afl-conference.ts.
 */

/**
 * A tier name. The AFL has two (Premier League, D-League); the tier list is
 * the league config's `tierCompetition.tiers`, so a league with more — the
 * custom-site demo's big league adds an "A League" — names its own.
 */
export type AflTier = string;

export const PREMIER_LEAGUE: AflTier = 'Premier League';
export const D_LEAGUE: AflTier = 'D-League';

/** "A League" → "a-league": the file name of a tier the AFL has no mark for. */
const tierSlug = (tierName: string) => tierName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/**
 * Resolve the tier logo path (served from public/). The AFL's two tiers keep
 * their marks; any other tier reads /assets/afl/tiers/<slug>.svg, which the
 * league that declares it supplies.
 */
export function getTierLogo(tierName: string): string {
  if (tierName === PREMIER_LEAGUE) return '/assets/afl/premier.svg';
  if (tierName === D_LEAGUE || !tierName) return '/assets/afl/dleague.svg';
  return `/assets/afl/tiers/${tierSlug(tierName)}.svg`;
}

/**
 * Resolve the dark-mode tier logo path. Convention: same path + `-dark`
 * suffix (see /public/assets/afl/premier-dark.svg, dleague-dark.svg).
 * Pair with ThemeImage (src/components/shared/ThemeImage.astro) for the CSS swap —
 * SSR can never know the resolved theme, so both variants must render and
 * the swap happens client-side via html.dark.
 */
export function getTierLogoDark(tierName: string): string {
  if (tierName === PREMIER_LEAGUE) return '/assets/afl/premier-dark.svg';
  if (tierName === D_LEAGUE || !tierName) return '/assets/afl/dleague-dark.svg';
  return `/assets/afl/tiers/${tierSlug(tierName)}-dark.svg`;
}
