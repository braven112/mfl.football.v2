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
 */

import collegeLogos from '../data/college-logos.json';

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
    rules.push(
      `html.dark img[src="${cssStringEscape(light)}"] { content: url("${cssStringEscape(dark)}"); }`,
    );
  }
  cachedCss = rules.join('\n');
  return cachedCss;
}
