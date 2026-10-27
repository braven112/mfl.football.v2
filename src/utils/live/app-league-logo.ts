/**
 * The league logo the MFL Live phone app draws beside a league's name.
 *
 * Only a league this site runs has one: its registry `logo.dark`, rendered to
 * a PNG by `scripts/build-app-league-logos.mjs`, because React Native's
 * `<Image>` cannot draw the SVG the website uses. Any other MFL league gets
 * nothing — MFL publishes no league logo, and an invented badge would read as
 * that league's own mark.
 *
 * `tests/mfl-live-app-league-logos.test.ts` pins that every league answered
 * here has its rendered PNG on disk.
 */

import { getLeagueBySlug } from '../../config/leagues';

export const APP_LEAGUE_LOGO_DIR = '/assets/logos/app';

/** A site-relative PNG path, or '' when the league has no logo. */
export function appLeagueLogo(slug: string | null | undefined): string {
  if (!slug) return '';
  const league = getLeagueBySlug(slug);
  return league?.logo?.dark ? `${APP_LEAGUE_LOGO_DIR}/${league.slug}.png` : '';
}
