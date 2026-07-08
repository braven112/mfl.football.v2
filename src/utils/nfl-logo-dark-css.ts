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

import { getAllNFLTeamCodes, getNFLTeamLogo, normalizeTeamCode, TEAM_CODE_MAP } from './nfl-logo';

/**
 * Escape a value for use inside a double-quoted CSS string. Also neutralizes
 * `<` (as the CSS hex escape `\3c `) so a stray `</style>` in a src value can't
 * break out of the raw-text <style> element we render via `set:html`. Our srcs
 * are trusted (ESPN URLs / local asset paths), so this is defense-in-depth.
 */
function cssStringEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/</g, '\\3c ');
}

/** One `html.dark` swap rule keyed on an exact img src. */
function swapRule(lightSrc: string, darkUrl: string): string {
  return `html.dark img[src="${cssStringEscape(lightSrc)}"] { content: url("${darkUrl}"); }`;
}

/**
 * Build the dark-mode swap CSS for every NFL team logo the site can render.
 *
 * Two families of light src reach the DOM:
 *  - ESPN `500` PNGs from `getNFLTeamLogo`, which always normalize to the 32
 *    canonical codes → one `500` → `500-dark` rule per team.
 *  - Local `/assets/nfl-logos/{CODE}.svg`. Some roster builders normalize
 *    (canonical filenames) but others render the raw/legacy code verbatim
 *    (`WAS.svg`, `LVR.svg`, hardcoded paths), so we emit a rule for every
 *    canonical code AND every legacy alias in TEAM_CODE_MAP, each pointing at
 *    the normalized team's `500-dark` PNG. Aliases that resolve to the NFL
 *    shield (FA/UFA → NFL) are skipped — there's no ESPN dark shield to swap to.
 *
 * The Sunday Ticket multi-view hardcodes the dark variant, so its `500-dark`
 * srcs are never a key here — no collision. Output is static, so it's memoized
 * at module scope (runs in the shared layout head on every SSR request).
 */
let cachedCss: string | null = null;

export function buildNflLogoDarkCss(): string {
  if (cachedCss !== null) return cachedCss;
  const rules: string[] = [];

  // ESPN logos — always canonical.
  for (const code of getAllNFLTeamCodes()) {
    rules.push(swapRule(getNFLTeamLogo(code), cssStringEscape(getNFLTeamLogo(code, 'dark'))));
  }

  // Local SVGs — canonical codes plus every legacy alias filename.
  const localCodes = new Set<string>([...getAllNFLTeamCodes(), ...Object.keys(TEAM_CODE_MAP)]);
  for (const code of localCodes) {
    const canonical = normalizeTeamCode(code);
    if (!canonical || canonical === 'NFL') continue;
    rules.push(
      swapRule(`/assets/nfl-logos/${code}.svg`, cssStringEscape(getNFLTeamLogo(canonical, 'dark'))),
    );
  }

  cachedCss = rules.join('\n');
  return cachedCss;
}
