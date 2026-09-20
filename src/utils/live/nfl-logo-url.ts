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
 *
 * ── `ground`, and why a surface may not rely on the theme ──────────────────
 * The swap above is guarded on `html.dark`. That is right for a surface that
 * follows the viewer's theme, and WRONG for one that is dark in both themes —
 * the live broadcast board (`live-broadcast.css`: "no `html.dark` override
 * exists or is wanted") and the Sunday Ticket multiview grid ("near-black in
 * both themes"). For a light-theme viewer those surfaces never fire the swap
 * and render the LIGHT mark on a near-black ground, which is the exact
 * dissolving case the dark pipeline exists to prevent.
 *
 * Such a surface passes `'dark'` and gets the dark cut directly, theme
 * independently. It also picks up the club's per-club dark assignment for
 * free, because `resolveNflDarkLogoUrl` is where that already resolves
 * (docs/plans/nfl-mark-assignments.md).
 */
import { normalizeTeamCode } from '../nfl-logo';
import { resolveNflDarkLogoUrl } from '../nfl-logo-dark-css';

/** Which ground the mark will be drawn on — NOT which theme the page is in. */
export type NflMarkGround = 'light' | 'dark';

export function nflLogoUrl(team: string, ground: NflMarkGround = 'light'): string {
  if (!team) return '';
  const code = normalizeTeamCode(team);
  if (!code) return '';
  const light = `/assets/nfl-logos/${code}.svg`;
  if (ground === 'light') return light;

  const dark = resolveNflDarkLogoUrl(code);
  // Same-origin only, deliberately. `resolveNflDarkLogoUrl` falls back to the
  // ESPN CDN when a build has no mirror (dev, test, Storybook's empty
  // manifest), and shipping that as a `src` is the cross-origin fetch this
  // module exists to avoid. The light mark on a dark ground is the behaviour
  // these surfaces have today, so falling back to it is never a regression.
  return dark && dark.startsWith('/') ? dark : light;
}
