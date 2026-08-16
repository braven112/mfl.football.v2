/**
 * Dark-mode college logo swap.
 *
 * Generates the CSS that swaps every rendered college logo for ESPN's
 * dark-optimized variant (`.../ncaa/500-dark/{id}.png`) under `html.dark`.
 * Like the NFL marks, many college logos carry dark outlines that disappear
 * on a dark background; ESPN publishes a `500-dark` cut of each, and the
 * light↔dark pair already lives in `src/data/college-logos.json`
 * (`logo` / `logoDark`).
 *
 * Why CSS keyed on `html.dark`, not a server-side pick: with theme preference
 * 'auto' the server can't know the resolved theme, so a server-side src choice
 * would be wrong for half our users. Mirrors `src/utils/nfl-logo-dark-css.ts`
 * and `src/utils/team-icon-dark-css.ts` — see those for the fuller rationale.
 *
 * Why `content: url(...)` on the <img>: college logos render as plain <img>
 * tags (some server-rendered, some built client-side as HTML strings) on the
 * players and roster pages. One stylesheet keyed on the exact light src covers
 * every one with zero markup changes.
 *
 * Unlike the NFL swap, college logos appear on only a handful of pages, and
 * the rule set is large (~236 schools). So this is emitted per-page via
 * `src/components/CollegeLogoDarkStyles.astro` on the pages that actually
 * render college logos, rather than globally in the shared layout.
 *
 * Dark-variant source (Aug 2026): self-hosted when possible, mirroring the
 * NFL swap. `content: url(...)` has NO error fallback — a failed load renders
 * a broken-image icon, not the light logo still in the src attribute — so
 * pointing swaps at ESPN's CDN makes every logo a render-time cross-origin
 * dependency. `scripts/fetch-college-dark-logos.mjs` (prebuild) mirrors the
 * NCAA `500-dark` cuts into `public/assets/college-logos/dark/{id}.png` and
 * records what it fetched in `src/data/college-dark-logos-manifest.json`;
 * `resolveCollegeDarkLogoUrl` serves the local copy for manifest-listed ids
 * and keeps the JSON's ESPN URL for anything missing, so a failed prebuild
 * fetch degrades to the old remote behavior — never to a 404ing local path.
 */

import collegeLogos from '../data/college-logos.json';
import darkLogoManifest from '../data/college-dark-logos-manifest.json';

interface CollegeLogoEntry {
  logo?: string | null;
  logoDark?: string | null;
}

/**
 * Escape a value for use inside a double-quoted CSS string. Also neutralizes
 * `<` (as the CSS hex escape `\3c `) so a stray `</style>` in a data value
 * can't break out of the raw-text <style> element we render via `set:html`.
 * Values come from a committed JSON file, so this is defense-in-depth.
 */
function cssStringEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/</g, '\\3c ');
}

/**
 * Matches the ESPN NCAA dark-cut URLs stored in college-logos.json; capture
 * group 1 is the ESPN NCAA id, which is also the mirror's local filename and
 * manifest key. Kept in lockstep with scripts/fetch-college-dark-logos.mjs
 * by tests/college-logo-dark-css.test.ts.
 */
const NCAA_DARK_URL_RE = /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/ncaa\/500-dark\/(\d+)\.png$/;

/**
 * NCAA ids whose `500-dark` cut does not exist on ESPN's CDN at all — their
 * dark swap rules always pointed at a permanent 404, rendering broken-image
 * icons in dark mode on every connection. Curated (not build-detected):
 * ESPN's CDN also serves *transient* 404s (observed on a real NFL logo
 * during a Vercel build), so inferring "permanently missing" from one
 * build's 404s would randomly drop a real school's swap for a whole deploy.
 * Verified 2026-08-08 via the prebuild mirror logs (retried 404s on every
 * build). If a future college-logos.json refresh adds more, the prebuild
 * log's `✗ <id>: HTTP 404` lines across consecutive deploys identify them.
 */
export const KNOWN_MISSING_NCAA_DARK_IDS: readonly string[] = [
  // As of Aug 2026 these three also 404 on the LIGHT cut, so college-logos.json
  // no longer references them at all (Malone/Manitoba have null logos; the
  // Louisiana entries were re-pointed from 2347 — actually Louisiana Christian,
  // a mis-mapping — to the Ragin' Cajuns' real id, 309). Kept as a guard in
  // case a future data refresh resurrects the URLs.
  '2347', // Louisiana Christian University
  '556', // Malone University
  '2770', // Manitoba
];

/**
 * Dark logo URL for a college entry: the self-hosted mirror when the prebuild
 * fetch produced it (same-origin, survives ESPN CDN unreachability),
 * otherwise the ESPN URL from college-logos.json unchanged — or `null` for
 * ids in the curated known-missing list, meaning emit no swap rule and keep
 * the light logo in dark mode: strictly better than a rule pointing at a
 * known 404, which renders a broken-image icon on every connection.
 * Parameters are injectable for tests; production callers use the build's
 * real manifest and the curated list.
 */
export function resolveCollegeDarkLogoUrl(
  darkUrl: string,
  manifestIds: readonly string[] = darkLogoManifest.ids,
  knownMissing: readonly string[] = KNOWN_MISSING_NCAA_DARK_IDS,
): string | null {
  const id = darkUrl.match(NCAA_DARK_URL_RE)?.[1];
  if (id && manifestIds.includes(id)) {
    return `/assets/college-logos/dark/${id}.png`;
  }
  if (id && knownMissing.includes(id)) return null;
  return darkUrl;
}

/**
 * Build the dark-mode swap CSS for every college logo that declares both a
 * light `logo` and a `logoDark`. Deduped by light src (multiple school-name
 * spellings can share one ESPN logo), so each distinct logo yields one rule.
 * Entries missing either URL produce no rule (nothing to swap).
 *
 * The source data is static, so the ~35KB output is stable; it's memoized at
 * module scope since the SSR roster pages call it on every request.
 */
let cachedCss: string | null = null;

export function buildCollegeLogoDarkCss(): string {
  if (cachedCss !== null) return cachedCss;
  const darkByLight = new Map<string, string>();
  for (const entry of Object.values(collegeLogos as Record<string, CollegeLogoEntry>)) {
    const light = entry?.logo;
    const dark = entry?.logoDark;
    if (!light || !dark) continue;
    const existing = darkByLight.get(light);
    if (existing && existing !== dark) {
      // Two schools share a light logo but disagree on the dark variant — the
      // data is inconsistent. Surface it instead of silently keeping the last.
      console.warn(
        `[college-logo-dark-css] conflicting logoDark for ${light}: "${existing}" vs "${dark}"`,
      );
    }
    darkByLight.set(light, dark);
  }
  const rules: string[] = [];
  for (const [light, dark] of darkByLight) {
    const resolved = resolveCollegeDarkLogoUrl(dark);
    if (!resolved) continue; // dark cut doesn't exist upstream — keep light logo
    rules.push(
      `html.dark img[src="${cssStringEscape(light)}"] { content: url("${cssStringEscape(resolved)}"); }`,
    );
  }
  cachedCss = rules.join('\n');
  return cachedCss;
}
