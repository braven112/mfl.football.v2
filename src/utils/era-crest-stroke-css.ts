/**
 * Rim for Throwback Week era crests that were cut out of a banner.
 *
 * Most legacy crests in the archive were never drawn as icons — they are a
 * circle punched out of the era's BANNER, so what you get is a gradient, a
 * slice of a photograph, or half a wordmark with no edge of its own. On a card
 * that reads as a crop rather than a crest. A ring in the era's own color
 * gives it an edge and it becomes a badge.
 *
 * **Not the same thing as `crest-dark-stroke-css.ts`, and deliberately so.**
 * That file solves dark-mode LEGIBILITY: a near-black logo dissolving into a
 * dark card, measured by `scripts/measure-crest-contrast.mjs`, stroked white,
 * under `html.dark` only. Every one of those choices is wrong here — a banner
 * cut is perfectly legible, the problem is that it has no rim; white vanishes
 * on the light card, which is where the crop looks most unfinished; and the
 * rim is wanted in both themes. The two never touch the same crest anyway: the
 * measured manifest covers current `icons/` art, this covers `history/` art.
 *
 * **`box-shadow`, not the `filter` the dark stroke uses.** A drop-shadow ring
 * would work in isolation, but the surfaces these render on already set
 * `filter` on the crest for depth (`.ls-crest img` and three siblings in
 * live-scoring.css). `filter` does not merge: at equal specificity — and
 * `img[src="..."]` and `.ls-crest img` are both (0,1,1) — one simply replaces
 * the other, so the rim either lost to the shadow or would have deleted it.
 * Measured in the browser, not assumed: the board's crests came back with the
 * page's shadow and no rim.
 *
 * `box-shadow` is a different property, so it composes with that shadow
 * instead of racing it, and `0 0 0 Npx` is a true even ring rather than four
 * stacked offsets. It works here because every era crest is a CIRCLE filling
 * its square box, so `border-radius: 50%` puts the ring exactly on the art's
 * edge. (For non-circular art it would trace the box — which is why the field
 * is opt-in per era rather than applied to all history art.)
 *
 * **The field is an opt-in whose absence is the goal.** Better era art is
 * expected over time; dropping in a real crest and deleting the entry's
 * `iconStroke` returns it to rendering as authored, with no code change and
 * nothing to un-bake from the PNG. That is the whole reason this is a
 * render-time filter keyed on `src` rather than a pass over the images.
 *
 * League-agnostic: it reads whatever `history[]` entries carry the field, so
 * TheLeague can opt an era in by adding one line to its config.
 */

import { iconSrcVariants } from './team-icon-dark-css';
import { buildCrestDarkStrokeCss } from './crest-dark-stroke-css';

/** Minimal shape this builder needs from a league config's teams. */
interface EraStrokeTeam {
  history?: {
    icon?: string;
    iconStroke?: string;
    iconFreeform?: boolean;
    // `boolean` rather than `true`: the config is imported JSON, and TS
    // infers a literal `true` there as plain `boolean`. A falsy value means
    // no stroke, which is what the collector already checks for.
    iconStrokeDark?: string | boolean;
  }[];
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Wider than the dark-mode hairline (0.5px), because it is doing a different
 * job. That one separates a silhouette from the card and wants to be barely
 * seen; this one IS the crest's rim, and at the 40-56px these render it has to
 * read as a deliberate edge. 1.5px lands on whole device pixels at 2x.
 */
const ERA_RIM_WIDTH = '1.5px';

/**
 * CSS rules ringing every era crest that declares an `iconStroke`.
 *
 * Returns '' when no era opts in, so the caller can drop an empty <style>.
 */
export function buildEraCrestStrokeCss(teams: EraStrokeTeam[]): string {
  const byColor = new Map<string, Set<string>>();

  for (const team of teams ?? []) {
    for (const era of team?.history ?? []) {
      const color = era?.iconStroke;
      const icon = era?.icon;
      // A malformed color would emit a filter the browser drops silently,
      // which looks exactly like "the ring feature does not work".
      if (!icon || !color || !HEX.test(color)) continue;
      const bucket = byColor.get(color) ?? new Set<string>();
      for (const variant of iconSrcVariants(icon)) bucket.add(variant);
      byColor.set(color, bucket);
    }
  }

  if (byColor.size === 0) return '';

  // Grouped by color so 36 crests emit a handful of rules rather than 36.
  return [...byColor.entries()]
    .map(([color, srcs]) => {
      const selector = [...srcs]
        .sort()
        .map((src) => `img[src="${src}"]`)
        .join(',\n');
      return (
        `${selector} {\n` +
        `  border-radius: 50%;\n` +
        `  box-shadow: 0 0 0 ${ERA_RIM_WIDTH} ${color};\n` +
        `}`
      );
    })
    .join('\n');
}

/**
 * Un-clips era crests that are a FREE-STANDING LOGO rather than a circle of
 * banner.
 *
 * Every crest slot on the site is round — `border-radius: 50%` plus
 * `object-fit: cover` — which is exactly right for the 100+ era crests that
 * are a circle punched out of a banner. It is exactly wrong for a real mark
 * on transparency: Texas Tech's Double T and the Bears' head both put art
 * outside the inscribed circle (the Bears' ears sit at a radius of ~54 in a
 * box whose circle stops at 50), so the round slot bites the corners off.
 *
 * Shrinking the mark until it fits the circle is the other way out and is
 * worse: it renders visibly smaller than the banner cuts beside it, which is
 * the sizing problem this art was brought in to fix.
 *
 * **`!important` is load-bearing here, not laziness.** Astro compiles a
 * component's scoped `.tbw-card__icon` to `.tbw-card__icon[data-astro-cid-…]`
 * — specificity (0,2,0) — which outranks this sheet's `img[src="…"]` at
 * (0,1,1). No selector reachable from a global stylesheet wins that on
 * specificity alone, and the alternative is editing the crest rule on every
 * surface that renders an era crest, which is the fork this repo keeps
 * refusing to make. One declaration, keyed on the one thing that identifies
 * the art: its src.
 *
 * Opt-in per era via `iconFreeform`, and absence is again the normal state.
 */
export function buildEraCrestShapeCss(teams: EraStrokeTeam[]): string {
  const srcs = new Set<string>();
  for (const team of teams ?? []) {
    for (const era of team?.history ?? []) {
      if (!era?.icon || !era.iconFreeform) continue;
      for (const variant of iconSrcVariants(era.icon)) srcs.add(variant);
    }
  }
  if (srcs.size === 0) return '';
  const selector = [...srcs].sort().map((src) => `img[src="${src}"]`).join(',\n');
  return (
    `${selector} {\n` +
    `  border-radius: 0 !important;\n` +
    // `cover` would crop the mark again wherever the slot is not square.
    `  object-fit: contain !important;\n` +
    `}`
  );
}

/**
 * Dark-mode white outline for an era crest that is a free-standing mark.
 *
 * A THIRD treatment, and the three do not overlap:
 *
 * - `iconStroke` rings the element box in the era's own colour, in BOTH
 *   themes, because a circle punched out of a banner has no edge of its own.
 * - `iconFreeform` takes the round slot away entirely, for a mark whose shape
 *   is not a circle.
 * - `iconStrokeDark` — this one — traces the ART's silhouette in white, in
 *   DARK MODE ONLY, for a mark that is dark enough to sink into the dark card.
 *   Smokane's green elephant is the case: fine on the light card, a green
 *   shape on a near-black one.
 *
 * It delegates to `buildCrestDarkStrokeCss` rather than restating the stroke,
 * because the four-stacked-`drop-shadow` trick is not obvious and having two
 * copies of it is how they drift. That function is the reason this is a
 * `filter` and not a `box-shadow` like `iconStroke`: only `drop-shadow`
 * follows an image's alpha silhouette, and on a transparent PNG a box ring
 * would be a white square around the logo.
 *
 * `true` means "the default white"; a hex overrides it, the same contract the
 * franchise-level `iconStrokeDark` already has.
 */
export function buildEraCrestDarkStrokeCss(teams: EraStrokeTeam[]): string {
  const entries: { icon: string; strokeColor?: string }[] = [];
  for (const team of teams ?? []) {
    for (const era of team?.history ?? []) {
      if (!era?.icon || !era.iconStrokeDark) continue;
      entries.push({
        icon: era.icon,
        // `true` is spelled `undefined` downstream — that is how the shared
        // builder says "use the default colour".
        strokeColor: typeof era.iconStrokeDark === 'string' ? era.iconStrokeDark : undefined,
      });
    }
  }
  return buildCrestDarkStrokeCss(entries);
}
