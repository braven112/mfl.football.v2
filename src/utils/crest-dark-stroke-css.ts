/**
 * White outline for dark-mode-illegible team crests.
 *
 * Companion to `team-icon-dark-css.ts`. That file handles the GOOD case: a
 * team with a hand-authored `iconDark` swaps to artwork drawn for dark mode.
 * This file handles the case where no such artwork exists — which is most of
 * the AFL (1 of 24 teams has an `iconDark`) — by stroking the crest's
 * silhouette white so a near-black logo still reads on the dark card.
 *
 * Applies to EVERY team crest on the site, not just the crest-only standings
 * cards it was built for. It was scoped to `img.team-icon-cell` at first, on
 * the theory that a crest shown NEXT TO a name has no legibility problem. That
 * was wrong twice over: a near-black logo on a dark card is still hard to make
 * out even when labelled, and — worse — the same franchise then wore a ring on
 * the homepage and none on the standings page, which reads as a rendering bug
 * rather than a deliberate treatment. Consistency is the point.
 *
 * Keying on `src` alone (like the dark swap) is also what makes this reach
 * every call site: crests render from ~20 places across Astro components,
 * React islands, and client-side HTML string builders, and a global stylesheet
 * covers all three with no markup changes.
 *
 * Which crests qualify is measured, not eyeballed: `scripts/measure-crest-contrast.mjs`
 * scores each crest by the fraction of its opaque pixels clearing 3:1 against
 * `--card-surface` and writes `src/data/crest-dark-stroke-manifest.json`.
 * Teams with an `iconDark` are excluded there, so a team never gets both.
 *
 * Why `drop-shadow` and not `-webkit-text-stroke`/`outline`/a background
 * plate: `drop-shadow` is the only one that follows the image's ALPHA
 * silhouette. `outline` and a plate both draw the crest's bounding box, which
 * on a transparent PNG is a white square around a logo — worse than the
 * problem. Four stacked cardinal drop-shadows compose (each applies to the
 * previous one's result), so corners fill in and the net effect is a
 * continuous ~1px ring.
 *
 * Applies to EVERY league, not just the AFL. The AFL needs it most (1 of 24
 * teams has an `iconDark`), but the measurement runs over both configs and
 * TheLeague has its own dark-on-dark crests that qualify. Adding a league to
 * the registry needs no change here — add it to `measureAllCrests()` in
 * `scripts/measure-crest-contrast.mjs` and re-run the script.
 *
 * Consumed by `src/components/TeamIconDarkStyles.astro`, which is already in
 * the shared layout <head> — one stylesheet, no per-instance duplication.
 */

import { iconSrcVariants } from './team-icon-dark-css';
import strokeManifest from '../data/crest-dark-stroke-manifest.json';

export interface CrestStrokeEntry {
  /** Light-mode `icon` src exactly as it appears in the league config. */
  icon: string;
  franchiseId?: string;
  league?: string;
  /**
   * Optional stroke color for this crest, from the team's `iconStrokeDark` in
   * the league config. Defaults to white. Use it when a franchise's own trim
   * color separates the logo from the card as well as white does but keeps the
   * team's identity — Midwestside's gold ring being the motivating case; a
   * white outline there read as a foreign border around a gold-and-black crest.
   *
   * The color must clear 3:1 against the dark card itself, or the stroke can't
   * do its job. `tests/crest-dark-stroke.test.ts` enforces that.
   *
   * `false` opts the crest OUT of the stroke entirely — for a logo the pixel
   * measurement scores low but that a human can see reads fine as-is (a dark
   * crest with its own bright interior detail, say). The measurement is a
   * useful filter, not the final word; this is the override for when it's
   * wrong.
   *
   * It is wrong in the other direction too, which is why `TeamIconDarkStyles`
   * also feeds this list crests the manifest never flagged but whose config
   * names a color. The score counts legible PIXELS, so a crest that is bright
   * through the middle and dark around its rim passes comfortably while the
   * silhouette it presents to the card is still a dark edge on a dark card.
   */
  strokeColor?: string | false;
}

export interface CrestDarkStrokeOptions {
  /**
   * Directory of franchise-id-named copies of the icons (e.g.
   * `/assets/afl/icons` holds `0001.png` identical to `smokane.png`). Some
   * code builds icon paths from the franchise id, so emit an alias rule too —
   * same reasoning as `team-icon-dark-css.ts`.
   */
  franchiseIconDir?: string;
  /**
   * Element selector the rule applies to. Defaults to every `img`, matching
   * the dark-swap rules, so the stroke reaches all ~20 crest call sites.
   * Narrow it only if a surface ever needs to opt out wholesale.
   */
  selector?: string;
}

/** Escape a value for use inside a double-quoted CSS string / attr selector. */
function cssStringEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * The stroke itself. Kept at 1px: enough to separate a black silhouette from
 * a near-black card, small enough that it reads as an edge rather than a
 * sticker. `drop-shadow` takes no spread, so the ring width IS the offset.
 */
export const DEFAULT_CREST_STROKE_COLOR = 'rgb(255 255 255 / 90%)';

/**
 * Ring width. `drop-shadow` has no spread parameter, so the offset IS the
 * width. 0.5px reads as a hairline that separates the silhouette without
 * looking like a sticker outline — and on the 2x displays most owners are on,
 * it lands on a whole device pixel rather than being smeared across two.
 */
export const CREST_STROKE_WIDTH = '0.5px';

export function crestStrokeFilter(color: string = DEFAULT_CREST_STROKE_COLOR): string {
  const w = CREST_STROKE_WIDTH;
  return (
    `drop-shadow(${w} 0 0 ${color}) ` +
    `drop-shadow(-${w} 0 0 ${color}) ` +
    `drop-shadow(0 ${w} 0 ${color}) ` +
    `drop-shadow(0 -${w} 0 ${color})`
  );
}

/** The default white stroke, kept as a constant for callers that don't override. */
export const CREST_STROKE_FILTER = crestStrokeFilter();

/**
 * Join the generated manifest to each team's optional `iconStrokeDark`, giving
 * `buildCrestDarkStrokeCss` its entry list for one league.
 *
 * The manifest is generated by `scripts/measure-crest-contrast.mjs` and must
 * stay purely derived, so the per-team color lives in the league config
 * (beside `iconDark`) and is merged here rather than written into the manifest
 * — regenerating it can never clobber a hand-picked color.
 *
 * The config overrides the measurement in BOTH directions, because a pixel
 * count can be wrong either way:
 *
 * - `false` on a flagged crest opts it OUT (A Bruin Pegs Me — scores low, but
 *   its bright interior detail carries it on a dark card).
 * - a color on a crest the measurement did NOT flag opts it IN (Jewpacabra —
 *   68% of its pixels are legible because the middle is bright green, while the
 *   rim it presents to the card is dark and dissolves into it).
 *
 * A team with an `iconDark` is excluded on both paths: it swaps to artwork
 * drawn for dark mode, and ringing that is the bug this file exists to avoid.
 */
export function withStrokeColors(
  league: string,
  teams: any[],
  manifest: { needsStroke: any[] } = strokeManifest,
): CrestStrokeEntry[] {
  // `iconStrokeDark: false` is an opt-out, so test for presence of the key
  // rather than truthiness — `filter(t => t.iconStrokeDark)` would drop it.
  // Teams that never set the key stay OUT of this map entirely, which is what
  // makes them fall through to the default white stroke below; a `false` value
  // does enter the map and is skipped by buildCrestDarkStrokeCss.
  const colorByFranchise = new Map<string, string | false>(
    (teams ?? [])
      .filter((t) => t?.iconStrokeDark !== undefined)
      .map((t) => [t.franchiseId, t.iconStrokeDark]),
  );
  const measured = manifest.needsStroke.filter((e) => e.league === league);
  const measuredIds = new Set(measured.map((e) => e.franchiseId));
  // A `false` on an unmeasured crest is a no-op (nothing to opt out of), so
  // only colors open the opt-in path.
  const optIns = (teams ?? [])
    .filter((t) => t?.icon && t.iconStrokeDark && !t.iconDark && !measuredIds.has(t.franchiseId))
    .map((t) => ({ league, franchiseId: t.franchiseId, name: t.name, icon: t.icon }));
  return [...measured, ...optIns].map((e) => ({
    ...e,
    strokeColor: colorByFranchise.get(e.franchiseId),
  }));
}

/**
 * Build the dark-mode stroke CSS for the measured crests. Returns an empty
 * string when nothing qualifies, so the caller can skip the <style> tag.
 */
export function buildCrestDarkStrokeCss(
  entries: CrestStrokeEntry[],
  options: CrestDarkStrokeOptions = {},
): string {
  const selector = options.selector ?? 'img';

  // Group by stroke color so crests sharing the default white still collapse
  // into one rule; a team with an `iconStrokeDark` gets its own.
  const byColor = new Map<string, Set<string>>();

  for (const entry of entries) {
    if (!entry?.icon) continue;
    if (entry.strokeColor === false) continue; // explicit opt-out
    const color = entry.strokeColor || DEFAULT_CREST_STROKE_COLOR;
    if (!byColor.has(color)) byColor.set(color, new Set<string>());
    const srcs = byColor.get(color)!;
    // Match whichever form the call site rendered — see iconSrcVariants.
    for (const variant of iconSrcVariants(entry.icon)) srcs.add(variant);
    if (options.franchiseIconDir && entry.franchiseId) {
      const dir = options.franchiseIconDir.replace(/\/+$/, '');
      srcs.add(`${dir}/${entry.franchiseId}.png`);
    }
  }

  if (byColor.size === 0) return '';

  const blocks: string[] = [];
  for (const [color, srcs] of byColor) {
    const selectors = [...srcs]
      .map((src) => `html.dark ${selector}[src="${cssStringEscape(src)}"]`)
      .join(',\n');
    blocks.push(`${selectors} {\n  filter: ${crestStrokeFilter(color)};\n}`);
  }
  return blocks.join('\n');
}
