/**
 * Per-theme treatment for the TV network marks (`public/assets/tv-logos/`).
 *
 * The same two moves the team crests get, in the same order of preference:
 *
 *  1. SWAP — a mark with a `logoDark` in broadcast-mappings.json (DAZN's and
 *     YouTube TV's white artwork) swaps to it under `html.dark`, exactly as
 *     `team-icon-dark-css.ts` swaps an `iconDark`.
 *  2. STROKE — a mark with no dark variant that `scripts/measure-tv-logo-contrast.mjs`
 *     scored below the legibility threshold gets the crest ring
 *     (`crestStrokeFilter`: four cardinal drop-shadows following the alpha
 *     silhouette), so a black wordmark still reads on the dark card.
 *
 * Unlike the crests, this runs in BOTH directions. Crests are league artwork
 * and skew dark; the network marks are whoever owns the broadcast rights, and
 * two of them are pale by brand — Channel 5's yellow 5 and Kayo's light green
 * are on a white card what a black crest is on #262626. There is no light-mode
 * artwork to swap to, so those take the same ring in the opposite colour under
 * `html:not(.dark)`. A mark can qualify on both surfaces and get both rules;
 * only one ever applies.
 *
 * Keyed on the exact `src`, so it reaches every place a mark renders — the
 * multiview boxes, the window headers, the national-games row — with no
 * markup. Composed into `buildAllTeamIconDarkCss()` so the layout head and
 * Storybook's preview inject it from ONE source and cannot drift.
 *
 * Why not the white pill the board first shipped with: a plate draws the
 * mark's bounding box, which is a white rectangle on a dark card — the exact
 * thing crest-dark-stroke-css.ts explains the ring exists to avoid.
 */

import manifest from '../data/tv-logo-stroke-manifest.json';
import { crestStrokeFilter } from './crest-dark-stroke-css';

export const TV_LOGO_DIR = '/assets/tv-logos';

/**
 * The ring colour on the LIGHT card — the mirror of the crests'
 * `DEFAULT_CREST_STROKE_COLOR` white. Not opaque black: at the crest ring's
 * 0.5px this reads as the edge the mark is missing rather than an inked
 * outline drawn around it.
 */
export const TV_LOGO_LIGHT_STROKE_COLOR = 'rgb(0 0 0 / 55%)';

interface TvLogoManifest {
  needsStroke: Array<{ file: string; legible: number }>;
  /** Optional so an older committed manifest (no light pass) still builds. */
  needsLightStroke?: Array<{ file: string; legible: number }>;
  darkVariants: Array<{ file: string; dark: string }>;
}

function cssStringEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const srcOf = (file: string) => `${TV_LOGO_DIR}/${file}`;

export function buildTvLogoThemeCss(data: TvLogoManifest = manifest as TvLogoManifest): string {
  const rules: string[] = [];
  for (const { file, dark } of data.darkVariants) {
    rules.push(`html.dark img[src="${cssStringEscape(srcOf(file))}"] { content: url("${cssStringEscape(srcOf(dark))}"); }`);
  }
  const stroked = data.needsStroke.map((e) => `html.dark img[src="${cssStringEscape(srcOf(e.file))}"]`);
  if (stroked.length > 0) {
    rules.push(`${stroked.join(',\n')} { filter: ${crestStrokeFilter()}; }`);
  }
  // Guarded on `html:not(.dark)` rather than left unguarded: an unguarded rule
  // would also paint a dark ring on the WHITE artwork a `logoDark` swaps in,
  // which is the halo the whole treatment exists to avoid.
  const lightStroked = (data.needsLightStroke ?? []).map((e) => `html:not(.dark) img[src="${cssStringEscape(srcOf(e.file))}"]`);
  if (lightStroked.length > 0) {
    rules.push(`${lightStroked.join(',\n')} { filter: ${crestStrokeFilter(TV_LOGO_LIGHT_STROKE_COLOR)}; }`);
  }
  if (rules.length === 0) return '';
  const counts = `${data.darkVariants.length} swap, ${data.needsStroke.length} stroke, ${(data.needsLightStroke ?? []).length} light stroke`;
  return `/* tv-logo theme: ${counts} */\n${rules.join('\n')}`;
}
