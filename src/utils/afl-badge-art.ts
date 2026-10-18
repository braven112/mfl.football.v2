/**
 * The AFL award badge art, raw, keyed by file name, as the components that
 * inline it (to stamp or strip the year) should render it right now: while a
 * seasonal theme is open, a badge the season redraws (`_swaps` in
 * src/data/seasonal-marks/afl-<season>.json) is that drawing instead. CSS
 * swaps every <img> of the same badge (seasonal-mark-css.ts), but cannot reach
 * inside an inlined SVG, so these call sites pick the file themselves.
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

/** File name → raw SVG for every AFL award badge, with `seasonId`'s redrawn badges swapped in. */
export function aflBadgeSvgs(seasonId: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, raw] of Object.entries(BADGES)) {
    const swap = seasonalSwapPath('afl', seasonId, path);
    out[path.slice(AWARDS_DIR.length)] = (swap && SEASONAL[swap]) || raw;
  }
  return out;
}
