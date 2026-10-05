import { HOST_TO_SLUG } from '../../../utils/league-host-map';
import { resolveLeaguePath } from '../../../utils/nav-utils';

/** The two modes a theme review page renders: /<league>/theme/light|dark. */
export type ThemeMode = 'light' | 'dark';

/**
 * The href of a league's theme review page for this request.
 *
 * The league prefix comes off only on THAT league's own apex. The
 * `hideLeaguePrefix` local says the host belongs to SOME league; on another
 * league's apex a cross-league page keeps its prefix, or `/theme/light` would
 * open the host league's theme instead (TheLeagueLayout's pwaGateOwnApex
 * makes the same call).
 */
export function themePath(leagueSlug: string, mode: ThemeMode, url: URL, hideLeaguePrefix: boolean): string {
  const ownApex = hideLeaguePrefix && HOST_TO_SLUG[url.hostname] === leagueSlug;
  return resolveLeaguePath(`/${leagueSlug}/theme/${mode}`, ownApex);
}
