/**
 * Dark-mode treatment for the TV network marks (`public/assets/tv-logos/`).
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
 * Keyed on the exact `src`, so it reaches every place a mark renders — the
 * multiview boxes, the window headers, the national-games row — with no
 * markup. Composed into `buildAllTeamIconDarkCss()` so the layout head and
 * Storybook's preview inject it from ONE source and cannot drift.
 *
 * Why not the white pill the board first shipped with: a plate draws the
 * mark's bounding box, which is a white rectangle on a dark card — the exact
 * thing crest-dark-stroke-css.ts explains the ring exists to avoid.
 */

import manifest from '../data/tv-logo-dark-stroke-manifest.json';
import { crestStrokeFilter } from './crest-dark-stroke-css';

export const TV_LOGO_DIR = '/assets/tv-logos';

interface TvLogoManifest {
  needsStroke: Array<{ file: string; legible: number }>;
  darkVariants: Array<{ file: string; dark: string }>;
}

function cssStringEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const srcOf = (file: string) => `${TV_LOGO_DIR}/${file}`;

export function buildTvLogoDarkCss(data: TvLogoManifest = manifest as TvLogoManifest): string {
  const rules: string[] = [];
  for (const { file, dark } of data.darkVariants) {
    rules.push(`html.dark img[src="${cssStringEscape(srcOf(file))}"] { content: url("${cssStringEscape(srcOf(dark))}"); }`);
  }
  const stroked = data.needsStroke.map((e) => `html.dark img[src="${cssStringEscape(srcOf(e.file))}"]`);
  if (stroked.length > 0) {
    rules.push(`${stroked.join(',\n')} { filter: ${crestStrokeFilter()}; }`);
  }
  return rules.length > 0 ? `/* tv-logo dark: ${data.darkVariants.length} swap, ${data.needsStroke.length} stroke */\n${rules.join('\n')}` : '';
}
