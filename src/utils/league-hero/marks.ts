/**
 * The two league-identity bits a hero card draws for itself: the league's mark
 * on a dark ground (the silhouette that stands in when a cutout 404s), and the
 * address its screenshot frame prints. Both come from the registry, so a new
 * league's hero needs no branch in the card components.
 */
import type { CanonicalLeagueSlug } from '../../config/leagues';
import { DEFAULT_LEAGUE_SLUG, LEAGUES, leagueUrl } from '../../config/leagues';

/**
 * The dark-ground cut of the league's mark. A hero gradient is dark in BOTH
 * themes, so this is always the dark cut, read from the registry's `logo`.
 * A slot absent from this build (the demo-only keeper league) gets the
 * default league's mark rather than a broken image.
 */
export function heroLeagueMark(league: CanonicalLeagueSlug): string {
  const entry = (LEAGUES as Record<string, { logo?: { dark?: string } } | undefined>)[league];
  return entry?.logo?.dark ?? LEAGUES[DEFAULT_LEAGUE_SLUG].logo?.dark ?? '';
}

/**
 * The address a screenshot frame prints: the league's own domain when it has
 * one, else the shared host it is served on (`mfl.football/archies/…`).
 * Display text, never an href — the frame is decoration.
 */
export function heroFrameUrl(league: CanonicalLeagueSlug, link?: string): string {
  // A demo-only slot (keeper) is absent off the demo: nothing to print.
  const entry = LEAGUES[league];
  if (!entry) return '';
  const domain = entry.domains[0];
  if (domain) return link ? `${domain}${link.replace(`/${entry.slug}`, '')}` : domain;
  return leagueUrl(entry, link ?? '/').replace(/^https?:\/\//, '');
}
