/**
 * Dark-mode NFL logo swap.
 *
 * Generates the global CSS that swaps every rendered NFL team logo for ESPN's
 * dark-optimized variant (`.../500-dark/{CODE}.png`) whenever `html.dark` is
 * set. Many NFL marks carry dark outlines (Raiders, Steelers, Jets, Bengals…)
 * that vanish against a dark background; ESPN publishes a `500-dark` cut of
 * every logo specifically for this, and we already point at their CDN.
 *
 * Why CSS keyed on `html.dark`, not a server-side variant pick: with theme
 * preference 'auto' the server cannot know the resolved theme at render time,
 * so a server-side src choice would be wrong for half our users. A CSS rule
 * always follows the class the client-side theme script resolves. This mirrors
 * the league team-icon swap in `src/utils/team-icon-dark-css.ts` — see that
 * file for the fuller rationale.
 *
 * Why `content: url(...)` on the <img> itself: NFL logos render as plain <img>
 * tags across composite heroes, matchup heroes, the UDFA hero, and roster
 * player cells, produced by three different helpers. Two emit ESPN URLs
 * (`getNFLTeamLogo`) and one emits a local SVG (`getNflLogoUrl`); all three
 * normalize to the same 32 canonical codes. One generated stylesheet keyed on
 * every light src those helpers can produce covers every call site — present
 * and future — with zero markup changes. Browsers without `content` support on
 * img elements (pre-2023) simply keep the light logo.
 *
 * Consumed by `src/components/NflLogoDarkStyles.astro`, included once in the
 * shared layout <head>.
 */

import { getAllNFLTeamCodes, getNFLTeamLogo } from './nfl-logo';
import { getNflLogoUrl } from '../constants/roster-constants';

/** Escape a value for use inside a double-quoted CSS string. */
function cssStringEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Build the dark-mode swap CSS for every canonical NFL team logo.
 *
 * For each of the 32 teams, emits one rule per distinct light src our helpers
 * render (the ESPN `500` PNG and the local `/assets/nfl-logos/{CODE}.svg`),
 * each swapping to the ESPN `500-dark` PNG under `html.dark`. The Sunday Ticket
 * multi-view hardcodes the dark variant, so its `500-dark` srcs are never a
 * key here — no collision.
 */
export function buildNflLogoDarkCss(): string {
  const rules: string[] = [];
  for (const code of getAllNFLTeamCodes()) {
    const darkUrl = cssStringEscape(getNFLTeamLogo(code, 'dark'));
    // Every light src that maps to this team, from either logo helper.
    const lightSrcs = new Set<string>([getNFLTeamLogo(code), getNflLogoUrl(code)]);
    for (const src of lightSrcs) {
      rules.push(
        `html.dark img[src="${cssStringEscape(src)}"] { content: url("${darkUrl}"); }`,
      );
    }
  }
  return rules.join('\n');
}
