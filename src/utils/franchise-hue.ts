/**
 * Which of a franchise's two brand hues actually IS its color.
 *
 * Several franchises lead with a near-black — Vitside and Midwestside by
 * deliberate art direction (`BAND_ART_DIRECTION` in `franchise-band-brand.ts`),
 * others because their config primary is a neutral. On the modal band that is
 * exactly right: the band is a deep-ink composite, so a black lead reads as
 * black-with-a-red-glow. Anywhere the same identity has to show up as a TINT —
 * a chip, a wash, a border on the light card — that black says nothing, and
 * the accent is the color a reader would name.
 *
 * One definition, imported by both the build-time band map and the client band
 * util, because the threshold drifting apart is the whole failure mode: the
 * band would glow red while the strip under it washed grey.
 *
 * @example
 * ```ts
 * pickBrandHue('#271b1a', '#aa322b'); // '#aa322b' — the lead is a neutral
 * pickBrandHue('#bd1f2b', '#181818'); // '#bd1f2b' — the lead is the color
 * ```
 */

import { chroma } from './nfl-team-colors';

/**
 * Minimum channel spread for a color to count as a HUE rather than a neutral.
 * `#181818` scores 0 and `#8b8f93` scores 8 — the two shades that collapse
 * whole groups of franchises into one band; every real brand color in any
 * league's config clears this comfortably.
 */
export const MIN_BRAND_CHROMA = 20;

/**
 * `primary` when it carries a hue at all, otherwise `secondary` — and
 * `primary` again when neither does, so the caller always gets a color.
 */
export function pickBrandHue(primary: string, secondary: string): string {
  if (chroma(primary) >= MIN_BRAND_CHROMA) return primary;
  if (chroma(secondary) >= MIN_BRAND_CHROMA) return secondary;
  return primary;
}
