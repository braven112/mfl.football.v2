/**
 * White outline for dark-mode-illegible team crests.
 *
 * Companion to `team-icon-dark-css.ts`. That file handles the GOOD case: a
 * team with a hand-authored `iconDark` swaps to artwork drawn for dark mode.
 * This file handles the case where no such artwork exists — which is most of
 * the AFL (1 of 24 teams has an `iconDark`) — by stroking the crest's
 * silhouette white so a near-black logo still reads on the dark card.
 *
 * Why it matters here specifically: the compact homepage standings cards
 * render the crest INSTEAD of the team name, so the crest is the row's only
 * identifier. A crest that fades into the card doesn't look slightly worse —
 * the row stops saying which team it is. Surfaces that show a crest NEXT TO a
 * name don't have that problem, which is why this is scoped to
 * `img.team-icon-cell` rather than every team icon on the site.
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
 * Consumed by `src/components/TeamIconDarkStyles.astro`, which is already in
 * the shared layout <head> — one stylesheet, no per-instance duplication.
 */

export interface CrestStrokeEntry {
  /** Light-mode `icon` src exactly as it appears in the league config. */
  icon: string;
  franchiseId?: string;
  league?: string;
}

export interface CrestDarkStrokeOptions {
  /**
   * Directory of franchise-id-named copies of the icons (e.g.
   * `/assets/afl/icons` holds `0001.png` identical to `smokane.png`). Some
   * code builds icon paths from the franchise id, so emit an alias rule too —
   * same reasoning as `team-icon-dark-css.ts`.
   */
  franchiseIconDir?: string;
  /** Restrict the rule to this selector. Defaults to the crest-only cell. */
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
export const CREST_STROKE_FILTER =
  'drop-shadow(1px 0 0 rgb(255 255 255 / 90%)) ' +
  'drop-shadow(-1px 0 0 rgb(255 255 255 / 90%)) ' +
  'drop-shadow(0 1px 0 rgb(255 255 255 / 90%)) ' +
  'drop-shadow(0 -1px 0 rgb(255 255 255 / 90%))';

/**
 * Build the dark-mode stroke CSS for the measured crests. Returns an empty
 * string when nothing qualifies, so the caller can skip the <style> tag.
 */
export function buildCrestDarkStrokeCss(
  entries: CrestStrokeEntry[],
  options: CrestDarkStrokeOptions = {},
): string {
  const selector = options.selector ?? 'img.team-icon-cell';
  const srcs = new Set<string>();

  for (const entry of entries) {
    if (!entry?.icon) continue;
    srcs.add(entry.icon);
    if (options.franchiseIconDir && entry.franchiseId) {
      const dir = options.franchiseIconDir.replace(/\/+$/, '');
      srcs.add(`${dir}/${entry.franchiseId}.png`);
    }
  }

  if (srcs.size === 0) return '';

  // One grouped rule rather than N rules — the filter is identical for every
  // crest, so grouping keeps the emitted stylesheet small.
  const selectors = [...srcs]
    .map((src) => `html.dark ${selector}[src="${cssStringEscape(src)}"]`)
    .join(',\n');

  return `${selectors} {\n  filter: ${CREST_STROKE_FILTER};\n}`;
}
