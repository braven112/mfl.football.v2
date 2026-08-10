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
 *
 * Dark-variant source (Aug 2026): the swap target is self-hosted when
 * possible. `content: url(...)` has NO error fallback — when the referenced
 * image fails to load, the browser renders a broken-image icon instead of the
 * light logo still sitting in the src attribute. Pointing every swap at
 * ESPN's CDN therefore turned a same-origin ~2KB SVG into a hard cross-origin
 * dependency, and on flaky mobile connections the AFL players page rendered a
 * column of broken icons. `scripts/fetch-nfl-dark-logos.mjs` (prebuild) now
 * mirrors ESPN's `500-dark` cut into `public/assets/nfl-logos/dark/` and
 * records what it actually fetched in `src/data/nfl-dark-logos-manifest.json`;
 * `resolveNflDarkLogoUrl` serves the local copy for manifest-listed teams and
 * falls back to the ESPN URL for anything missing, so a failed prebuild fetch
 * degrades to the old remote behavior — never to a 404ing local path.
 */

import { getAllNFLTeamCodes, getNFLTeamLogo, normalizeTeamCode, TEAM_CODE_MAP } from './nfl-logo';
import darkLogoManifest from '../data/nfl-dark-logos-manifest.json';

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
 * Dark logo URL for a canonical team code: the self-hosted mirror when the
 * prebuild fetch produced it (same-origin, survives ESPN CDN unreachability),
 * otherwise ESPN's `500-dark` URL — or `null` for a code in `knownMissing`
 * (no dark cut exists upstream), meaning no swap rule should be emitted at
 * all: the light logo in dark mode beats a rule pointing at a known 404,
 * which renders a broken-image icon on every connection. All 32 NFL dark
 * cuts exist today, so the NFL default is empty; the list is curated (not
 * build-detected) because ESPN's CDN serves transient 404s — see
 * KNOWN_MISSING_NCAA_DARK_IDS in college-logo-dark-css.ts. Parameters are
 * injectable for tests; production callers use the build's real manifest.
 */
export function resolveNflDarkLogoUrl(
  canonicalCode: string,
  manifestCodes: readonly string[] = darkLogoManifest.codes,
  knownMissing: readonly string[] = [],
): string | null {
  if (manifestCodes.includes(canonicalCode)) {
    return `/assets/nfl-logos/dark/${canonicalCode}.png`;
  }
  if (knownMissing.includes(canonicalCode)) return null;
  return getNFLTeamLogo(canonicalCode, 'dark');
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
  const swappedSrcs: string[] = [];

  // ESPN logos — always canonical.
  for (const code of getAllNFLTeamCodes()) {
    const dark = resolveNflDarkLogoUrl(code);
    if (dark) {
      rules.push(swapRule(getNFLTeamLogo(code), cssStringEscape(dark)));
      swappedSrcs.push(getNFLTeamLogo(code));
    }
  }

  // Local SVGs — canonical codes plus every legacy alias filename.
  const localCodes = new Set<string>([...getAllNFLTeamCodes(), ...Object.keys(TEAM_CODE_MAP)]);
  for (const code of localCodes) {
    const canonical = normalizeTeamCode(code);
    if (!canonical || canonical === 'NFL') continue;
    const dark = resolveNflDarkLogoUrl(canonical);
    if (dark) {
      rules.push(swapRule(`/assets/nfl-logos/${code}.svg`, cssStringEscape(dark)));
      swappedSrcs.push(`/assets/nfl-logos/${code}.svg`);
    }
  }

  // Failed-logo hide: logo <img>s tag themselves `nfl-logo-failed` via
  // NFL_LOGO_ONERROR (roster-constants) when their src fails to load, and
  // untag on a successful load. Hidden by default — a broken-image icon is
  // never acceptable — EXCEPT in dark mode for srcs whose swap rule above
  // provides pixels via content:url(), which doesn't depend on the light
  // src loading. Pure CSS, so theme toggles re-evaluate automatically.
  // (`visibility` keeps layout; the un-hide is scoped to the failed class
  // so it can never leak an img out of a visibility-hidden ancestor.)
  rules.push('img.nfl-logo-failed { visibility: hidden; }');
  if (swappedSrcs.length) {
    const selectors = swappedSrcs.map((src) => `[src="${cssStringEscape(src)}"]`).join(', ');
    rules.push(`html.dark img.nfl-logo-failed:is(${selectors}) { visibility: visible; }`);
  }

  cachedCss = rules.join('\n');
  return cachedCss;
}
