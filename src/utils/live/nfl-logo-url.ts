/**
 * The LOCAL NFL mark for a team code — never `getNFLTeamLogo`'s ESPN CDN URL.
 *
 * `nfl-logo-dark-css.ts` generates an `html.dark`-keyed swap to the mirrored
 * cut for every mark with dark outlines, and that rule is keyed on the `src`.
 * A CDN URL here would silently opt the element out of the dark-mode treatment
 * every other surface gets — correct in light, invisible in dark, and no error
 * anywhere.
 *
 * It also keeps a snapshot off the network: Storybook's committed mirror is
 * same-origin, and a cross-origin fetch at capture time is what made ESPN
 * weather — rather than a code change — fail a Chromatic build.
 *
 * Shared by every kit component that draws one, so there is one answer rather
 * than a copy per component.
 */
import { normalizeTeamCode } from '../nfl-logo';

export function nflLogoUrl(team: string): string {
  return team ? `/assets/nfl-logos/${normalizeTeamCode(team)}.svg` : '';
}
