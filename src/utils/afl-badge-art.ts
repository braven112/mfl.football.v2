/**
 * The AFL award badge art, raw, keyed by file name, as the components that
 * inline it (to stamp or strip the year) should render it right now: while a
 * seasonal theme is open, a badge the season redraws (`_swaps` in
 * src/data/seasonal-marks/afl-<season>.json) is that drawing instead. CSS
 * swaps every <img> of the same badge (seasonal-mark-css.ts), but cannot reach
 * inside an inlined SVG, so these call sites pick the file themselves.
 *
 * A season drawn as PNG (Christmas's knitted badges) is wrapped in an <svg>
 * on the plain badge's own viewBox, so it keeps the box it replaces. It has
 * no year to stamp, which only the inlined surfaces that strip the year use.
 *
 * These are the LEAGUE-WIDE marks: what a title stands for, shown wherever the
 * award is in play but not yet won (the homepage standings), or beside a team
 * already shown in its own banner (the footer). A title a club HAS won hangs
 * team-centric, in the Rafters (HistoryRafters.astro) and nowhere else
 * (Brandon, Oct 2026; tests/championship-mark-rule.test.ts).
 */
import { activeSeasonalTheme } from '../config/seasonal-themes.mjs';
import { getLeagueByNavSlug } from '../config/leagues';
import { getTestDateFromSearchParams } from './league-year';
import { seasonalSwapPath } from './seasonal-mark-css';

const AWARDS_DIR = '/assets/afl/awards/';

const rawByPath = (glob: Record<string, string>) =>
  Object.fromEntries(Object.entries(glob).map(([p, raw]) => [p.replace(/^.*\/public/, ''), raw]));

const BADGES = rawByPath(
  import.meta.glob<string>('../../public/assets/afl/awards/*.svg', { query: '?raw', import: 'default', eager: true }),
);
const SEASONAL = rawByPath(
  import.meta.glob<string>('../../public/assets/afl/*-marks/**/*.svg', { query: '?raw', import: 'default', eager: true }),
);

/** The seasonal theme id open for the AFL on this request (the same answer the layout stamps on <html data-season>). */
export function aflPageSeasonId(url: URL, seasonPreview?: string | null): string | null {
  return (
    activeSeasonalTheme(
      getLeagueByNavSlug('afl')?.seasonalThemes,
      getTestDateFromSearchParams(url.searchParams) ?? new Date(),
      seasonPreview ?? null,
    )?.id ?? null
  );
}

/** A raster drawing inlined as SVG on the badge's own viewBox, so it fills the box the badge did. */
function rasterBadge(raw: string, src: string): string {
  const viewBox = raw.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 100 100';
  const [, , w, h] = viewBox.split(/[\s,]+/);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><image href="${src}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/></svg>`;
}

/** File name → raw SVG for every AFL award badge, with `seasonId`'s redrawn badges swapped in. */
export function aflBadgeSvgs(seasonId: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, raw] of Object.entries(BADGES)) {
    const swap = seasonalSwapPath('afl', seasonId, path);
    const drawn = swap ? (swap.endsWith('.png') ? rasterBadge(raw, swap) : SEASONAL[swap]) : null;
    out[path.slice(AWARDS_DIR.length)] = drawn || raw;
  }
  return out;
}
