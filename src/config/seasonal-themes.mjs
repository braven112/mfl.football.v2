/**
 * Seasonal themes — a palette, headline face and franchise-mark set a league
 * wears for a few days a year instead of its own (Halloween first, Oct 2026).
 *
 * A league opts in by listing the id in its registry entry's `seasonalThemes`
 * (src/config/leagues-data.mjs); nothing here names a league. While a window
 * is open the layout stamps `<html data-season="<id>">`, and every seasonal
 * rule — the palette (scripts/generate-league-themes.mjs), the headline face
 * and the marks (src/styles/seasonal-themes.css, team-icon-dark-styles.ts) —
 * is keyed on that attribute, so closing the window is the whole revert.
 *
 * Plain .mjs so the theme generator (node) and the layout (Astro) share it.
 * Guard: tests/seasonal-themes.test.ts.
 */

/** The zone a seasonal window opens and closes in — the league's own. */
const SEASON_ZONE = 'America/Los_Angeles';

/**
 * @typedef {{ y: number, m: number, d: number }} CivilDate  m is 1-12
 * @typedef {{
 *   id: string,
 *   theme: string,
 *   lock: 'dark' | 'light' | null,
 *   marks: string | null,
 *   window: (year: number) => { start: CivilDate, end: CivilDate },
 * }} SeasonalTheme
 */

const addDays = ({ y, m, d }, n) => {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const weekday = ({ y, m, d }) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

/** @type {Record<string, SeasonalTheme>} */
export const SEASONAL_THEMES = {
  halloween: {
    id: 'halloween',
    /** The palette — a file in src/themes/. */
    theme: 'halloween',
    /** Midnight is dark-only (owner's call, Oct 2026): it overrides the viewer's light/dark choice. */
    lock: 'dark',
    /** Franchise marks: public/assets/<navSlug>/<marks>/<franchiseId>.png. */
    marks: 'halloween-marks',
    /**
     * The ten days before Halloween through the Monday night game of
     * Halloween's NFL week: the first Monday ON or after Oct 31 (Nov 2 in
     * 2026). Both ends inclusive, whole days in the league's zone.
     */
    window: (year) => {
      const halloween = { y: year, m: 10, d: 31 };
      return {
        start: addDays(halloween, -10),
        end: addDays(halloween, (8 - weekday(halloween)) % 7),
      };
    },
  },
};

/** The calendar date `now` falls on in the league's zone. */
function zonedDate(now) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: SEASON_ZONE, year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)]),
  );
  return { y: parts.year, m: parts.month, d: parts.day };
}

const ord = ({ y, m, d }) => y * 10000 + m * 100 + d;

/**
 * The seasonal theme open for `seasonalThemes` (a registry entry's list) at
 * `now`, or null. The first listed wins should two ever overlap. A `preview`
 * id (resolveSeasonPreview) opens that season early for a league that wears it.
 * @param {readonly string[] | undefined} seasonalThemes
 * @param {Date} [now]
 * @param {string | null} [preview]
 * @returns {SeasonalTheme | null}
 */
export function activeSeasonalTheme(seasonalThemes, now = new Date(), preview = null) {
  if (!seasonalThemes?.length) return null;
  if (preview && seasonalThemes.includes(preview) && SEASONAL_THEMES[preview]) return SEASONAL_THEMES[preview];
  const today = zonedDate(now);
  for (const id of seasonalThemes) {
    const season = SEASONAL_THEMES[id];
    if (!season) continue;
    const { start, end } = season.window(today.y);
    if (ord(today) >= ord(start) && ord(today) <= ord(end)) return season;
  }
  return null;
}

/**
 * `?seasonPreview=<id>` shows a season outside its window for the rest of the
 * browser session (a cookie, so it survives clicking around, which
 * `?testDate=` does not); `?seasonPreview=off` ends it. Read in middleware.
 */
export const SEASON_PREVIEW_PARAM = 'seasonPreview';
export const SEASON_PREVIEW_COOKIE = 'season-preview';

/**
 * @param {string | null} param
 * @param {string | null | undefined} cookie
 * @returns {{ kind: 'set', id: string } | { kind: 'clear' } | { kind: 'keep', id: string | null }}
 */
export function resolveSeasonPreview(param, cookie) {
  const p = param?.trim().toLowerCase();
  if (p === 'off') return { kind: 'clear' };
  if (p && SEASONAL_THEMES[p]) return { kind: 'set', id: p };
  return { kind: 'keep', id: cookie && SEASONAL_THEMES[cookie] ? cookie : null };
}
