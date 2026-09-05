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
 *
 * White ring (Sep 2026): the swap alone is not enough for a mark whose body
 * is black rather than merely dark-outlined. `NFL_DARK_STROKE_CODES` lists
 * those (the Panthers), and the builder appends two `filter` rules reusing
 * the league-crest ring stack from `crest-dark-stroke-css.ts` at
 * `NFL_DARK_STROKE_WIDTH`: one under `html.dark` keyed on the same light srcs
 * as the swap, and one with no theme guard keyed on the dark cut's own URLs,
 * for the surfaces that are dark in both themes and ship the dark cut as src.
 */

import { getAllNFLTeamCodes, getNFLTeamLogo, normalizeTeamCode, TEAM_CODE_MAP } from './nfl-logo';
import { crestStrokeFilter } from './crest-dark-stroke-css';
import darkLogoManifest from '../data/nfl-dark-logos-manifest.json';

/**
 * Canonical codes whose logo needs a white ring in dark mode ON TOP of the
 * dark swap. ESPN's `500-dark` cut fixes marks with dark OUTLINES (it
 * re-inks them light), but it does nothing for a mark whose whole BODY is
 * black: the Panthers' cut is 75% near-black pixels with a hairline blue
 * edge, and on a #1e1e1e card it reads as a smudge at 16px — that is the
 * shape the site renders it at in every player cell and box score. The ring
 * is the league crests' `drop-shadow` stack (`crest-dark-stroke-css.ts`) at
 * 1px rather than their 0.5px hairline — owner's call after a side-by-side
 * render on 2026-09-05: a 16px panther is a solid black silhouette with no
 * interior detail to help it, so the hairline that suffices for a crest with
 * a bright middle still left it faint. Curated, not measured: the crest
 * measurement scores legible PIXELS, and the other dark-bodied NFL marks (LV,
 * HOU, ATL, CHI, JAX) carry a bright interior that clears them; CAR is the
 * only one whose silhouette IS the logo. Verified by rendering all 32 dark
 * cuts on the dark card, 2026-09-05. Not a swap opt-out — the ring composes
 * with `content: url()`, so the dark cut still ships underneath it.
 */
export const NFL_DARK_STROKE_CODES: readonly string[] = ['CAR'];

/** Ring width for NFL_DARK_STROKE_CODES — see the note above on why not 0.5px. */
export const NFL_DARK_STROKE_WIDTH = '1px';

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
  // Light srcs of NFL_DARK_STROKE_CODES teams, collected alongside the swap
  // keys below so the ring is keyed on exactly the srcs the swap is. NOT gated
  // on a swap existing: a dark-bodied mark needs the ring in dark mode whether
  // the dark cut or the light SVG is what ends up rendered.
  const strokeSrcs: string[] = [];
  const isStroked = (canonical: string) => NFL_DARK_STROKE_CODES.includes(canonical);

  // ESPN logos — always canonical.
  for (const code of getAllNFLTeamCodes()) {
    const light = getNFLTeamLogo(code);
    if (isStroked(code)) strokeSrcs.push(light);
    const dark = resolveNflDarkLogoUrl(code);
    if (dark) {
      rules.push(swapRule(light, cssStringEscape(dark)));
      swappedSrcs.push(light);
    }
  }

  // Local SVGs — canonical codes plus every legacy alias filename.
  const localCodes = new Set<string>([...getAllNFLTeamCodes(), ...Object.keys(TEAM_CODE_MAP)]);
  for (const code of localCodes) {
    const canonical = normalizeTeamCode(code);
    if (!canonical || canonical === 'NFL') continue;
    const light = `/assets/nfl-logos/${code}.svg`;
    if (isStroked(canonical)) strokeSrcs.push(light);
    const dark = resolveNflDarkLogoUrl(canonical);
    if (dark) {
      rules.push(swapRule(light, cssStringEscape(dark)));
      swappedSrcs.push(light);
    }
  }

  // White ring for dark-bodied marks (NFL_DARK_STROKE_CODES), emitted twice.
  //
  // 1. Under `html.dark`, keyed on the light srcs above — ESPN 500 PNG,
  //    canonical SVG and every legacy alias — so it reaches every call site
  //    the swap does. `filter` applies to the element's rendered pixels, i.e.
  //    the content:url() dark cut, and follows its alpha silhouette (never
  //    the img's bounding box).
  // 2. Theme-INDEPENDENT, keyed on the dark cut's own URLs (ESPN and the
  //    self-hosted mirror). A few surfaces are dark in both themes (the draft
  //    broadcast board and reveal card, the Sunday Ticket multi-view) and ship
  //    the dark cut as their `src` directly — `html.dark` never fires for a
  //    light-theme viewer there, so rule 1 cannot reach them. An <img> whose
  //    src IS the dark cut is on a dark surface by construction (that is the
  //    only reason to hardcode it), so ringing it unconditionally is always
  //    right. This is a `filter`, not a swap — no `content:` is ever keyed on
  //    a dark src, which is what the self-referential-swap guard pins.
  //
  // Both are wrapped in `:where()` so they carry ZERO specificity. `filter` is
  // not additive across rules, and a bare `html.dark img[src=…]` (0,2,2)
  // out-ranks any surface's own class-level filter — the Free Agents hero
  // renders the top FA's logo as a 16%-opacity `.hero-spotlight__logo`
  // watermark with `filter: grayscale(.1)`, and the ring would have replaced
  // that with white halos. The ring is a DEFAULT: a surface that sets its own
  // filter has made a deliberate choice and must win, which is exactly what a
  // zero-specificity rule guarantees (any class selector beats it).
  const darkSrcs = NFL_DARK_STROKE_CODES.flatMap((code) => [
    getNFLTeamLogo(code, 'dark'),
    `/assets/nfl-logos/dark/${code}.png`,
  ]);
  const strokeFilter = crestStrokeFilter(undefined, NFL_DARK_STROKE_WIDTH);
  const strokeRule = (srcs: string[], guard: string): string | null =>
    srcs.length
      ? `:where(${srcs.map((src) => `${guard}img[src="${cssStringEscape(src)}"]`).join(', ')}) { filter: ${strokeFilter}; }`
      : null;
  for (const rule of [strokeRule(strokeSrcs, 'html.dark '), strokeRule(darkSrcs, '')]) {
    if (rule) rules.push(rule);
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
