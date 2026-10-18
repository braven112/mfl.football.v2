/**
 * Seasonal franchise marks — while a league's seasonal theme is open
 * (`<html data-season="<id>">`, src/config/seasonal-themes.mjs), every
 * franchise icon and GroupMe avatar renders the season's mark instead
 * (public/assets/<navSlug>/<marks>/<franchiseId>.png).
 *
 * Same mechanism and the same exact-`src` selectors as the dark-mode swap
 * (team-icon-dark-css.ts), one attribute more specific so it wins over that
 * swap. It also clears the dark-card stroke (crest-dark-stroke-css.ts): the
 * marks are drawn for the dark ground, and a ring around them reads as a
 * sticker.
 *
 * A mark set is DATA: src/data/seasonal-marks/<navSlug>-<seasonId>.json maps
 * franchise id → the drawn source file (scripts/build-seasonal-marks.mjs
 * builds the PNGs from it). Only franchises listed there get a rule; any other
 * franchise keeps its normal crest for the season. Nothing is converted
 * automatically (owner's call, Oct 2026).
 */
import { SEASONAL_THEMES } from '../config/seasonal-themes.mjs';
import { iconSrcVariants, type DarkIconTeamLike } from './team-icon-dark-css';

/** Every current-identity mark a franchise renders: its icon, dark icon and GroupMe avatar (both themes). Era crests are history and keep their art. */
type SeasonalTeamLike = DarkIconTeamLike & { groupMe?: string; groupMeDark?: string };
const MARK_FIELDS = ['icon', 'iconDark', 'groupMe', 'groupMeDark'] as const;

const MARK_SETS = import.meta.glob<Record<string, unknown>>('../data/seasonal-marks/*.json', {
  eager: true,
  import: 'default',
});

/** Franchise ids with a drawn mark in `navSlug`'s set for `seasonId`. */
export function seasonalMarkIds(navSlug: string, seasonId: string): Set<string> {
  const set = MARK_SETS[`../data/seasonal-marks/${navSlug}-${seasonId}.json`] ?? {};
  return new Set(Object.keys(set).filter((k) => /^\d{4}$/.test(k)));
}

/**
 * Optical size: a mark much wider than it is tall (Computer Jocks' flexing
 * pixel man) fills the tile's width yet reads small beside rounder marks, and
 * no square PNG can make it larger. `_scale` in the set lists those marks with
 * the factor to draw them at; they overhang their box a little, as intended.
 */
function markScale(navSlug: string, seasonId: string, franchiseId: string): number | null {
  const set = MARK_SETS[`../data/seasonal-marks/${navSlug}-${seasonId}.json`] as { _scale?: Record<string, number> } | undefined;
  const scale = set?._scale?.[franchiseId];
  return typeof scale === 'number' && scale > 0 && scale !== 1 ? scale : null;
}

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function buildSeasonalMarkCss(
  navSlug: string,
  seasonalThemes: readonly string[] | undefined,
  teams: SeasonalTeamLike[],
): string {
  const rules: string[] = [];
  for (const id of seasonalThemes ?? []) {
    const marks = SEASONAL_THEMES[id]?.marks;
    if (!marks) continue;
    const drawn = seasonalMarkIds(navSlug, id);
    for (const team of teams) {
      if (!team?.franchiseId || !drawn.has(team.franchiseId)) continue;
      const srcs = new Set<string>([`/assets/${navSlug}/icons/${team.franchiseId}.png`]);
      for (const field of MARK_FIELDS) {
        const src = team[field];
        if (src) iconSrcVariants(src).forEach((s) => srcs.add(s));
      }
      const selectors = [...srcs].map(
        (src) => `html[data-league="${navSlug}"][data-season="${id}"] img[src="${esc(src)}"]`,
      );
      const scale = markScale(navSlug, id, team.franchiseId);
      rules.push(
        `${selectors.join(',\n')} { content: url("/assets/${navSlug}/${marks}/${team.franchiseId}.png"); filter: none;${scale ? ` transform: scale(${scale});` : ''} }`,
      );
      // A scaled mark overhangs its box, and crest frames clip (live scoring's
      // `.lv-side__crest` is overflow:hidden), so its direct parent lets it show.
      if (scale) {
        rules.push(
          `${selectors.map((sel) => sel.replace(/ img\[/, ' :has(> img[') + ')').join(',\n')} { overflow: visible; }`,
        );
      }
    }
  }
  return rules.join('\n');
}
