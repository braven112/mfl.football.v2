/**
 * Marquee weeks — the weeks a league wants its best rivalries in.
 *
 * Commissioner, Nov 2026 (from an r/FFCommish post on using the schedule to
 * keep a league interesting): Halloween and Thanksgiving should carry the
 * rivalries people care about. Week 1 has its own rule (the title rematch,
 * `titleRematchPair` in schedule-plan.mjs) and the finale is already the
 * all-division rivalry finish, so this module covers the two holiday weeks.
 *
 * A SOFT goal, ranked below every division and bye-week goal: the builder
 * decides each week's game type first by its own rules, then this term only
 * chooses WHICH pairs fill it. If Thanksgiving lands on a division round, the
 * normal division rules apply and the rivals there are division rivals.
 *
 * What a pair is worth (0..1):
 *   real-life rivalry  0.6  — the commissioner's list, "the most important
 *                             thing, at least 51% of the score"
 *   on-field series    0.4  — career rivalry intensity, normalised to the
 *                             league's most charged pairing; a tiebreaker
 *                             among real-life rivals, and enough on its own to
 *                             rank the rest
 * So any real-life pair outranks every pair that is not one.
 *
 * Pure: no clock, no file reads. Callers hand in the rival list and series.
 */
import { nflWeekStartIsoDate, REGULAR_SEASON_WEEKS } from './nfl-week-starts.mjs';
import { rivalryPairKey } from './rivalry-intensity.mjs';

export const REAL_LIFE_SHARE = 0.6;
export const ON_FIELD_SHARE = 1 - REAL_LIFE_SHARE;

/** The NFL week whose games span `iso` (YYYY-MM-DD): the last week starting on or before it. */
export const nflWeekContaining = (year, iso) => {
  let found = null;
  for (let week = 1; week <= REGULAR_SEASON_WEEKS; week += 1) {
    if (nflWeekStartIsoDate(year, week) <= iso) found = week;
  }
  return found;
};

/** Fourth Thursday of November, as YYYY-MM-DD. */
export const thanksgivingIsoDate = (year) => {
  const first = new Date(Date.UTC(year, 10, 1)).getUTCDay(); // 0 = Sunday
  const firstThursday = 1 + ((4 - first + 7) % 7);
  return `${year}-11-${String(firstThursday + 21).padStart(2, '0')}`;
};

/**
 * The marquee weeks inside a fantasy regular season of `lastWeek` weeks.
 * A holiday that falls after the fantasy regular season is dropped, not moved.
 */
export const marqueeWeeks = (year, lastWeek) => {
  const weeks = {
    halloween: nflWeekContaining(year, `${year}-10-31`),
    thanksgiving: nflWeekContaining(year, thanksgivingIsoDate(year)),
  };
  return Object.fromEntries(Object.entries(weeks).filter(([, w]) => w && w >= 1 && w <= lastWeek));
};

/**
 * What each pairing is worth in a marquee week, keyed by `rivalryPairKey`.
 * Only pairs worth something are listed.
 *
 * @param {object} args
 * @param {string[][]} args.realLife      franchise-id pairs from the registry
 * @param {Record<string,{intensity:number,games:number}>} [args.series]  `rivalrySeries` output
 * @param {string[]} args.franchiseIds    this season's franchises; anything else is ignored
 * @param {number} [args.minMeetings]     a series shorter than this carries no on-field weight
 */
export const marqueePairValues = ({ realLife = [], series = {}, franchiseIds, minMeetings = 6 }) => {
  const ids = new Set(franchiseIds);
  const real = new Set(
    realLife.filter(([a, b]) => ids.has(a) && ids.has(b) && a !== b).map(([a, b]) => rivalryPairKey(a, b)),
  );
  const onField = {};
  for (const [key, s] of Object.entries(series ?? {})) {
    const [a, b] = key.split('-');
    if (!ids.has(a) || !ids.has(b) || !(s?.games >= minMeetings) || !(s.intensity > 0)) continue;
    onField[key] = s.intensity;
  }
  const top = Math.max(0, ...Object.values(onField));
  const value = {};
  for (const key of new Set([...real, ...Object.keys(onField)])) {
    value[key] = (real.has(key) ? REAL_LIFE_SHARE : 0) + (top ? ON_FIELD_SHARE * ((onField[key] ?? 0) / top) : 0);
  }
  return { value, real };
};

/**
 * The marquee games a drawn season actually holds, best first — for the plan
 * output and the scorecard.
 */
export const marqueeGamesIn = (weeks, marquee, { value, real }) => {
  const out = [];
  for (const [label, week] of Object.entries(marquee)) {
    for (const g of weeks.get(week) ?? []) {
      const key = rivalryPairKey(g.away, g.home);
      if (!value[key]) continue;
      out.push({ label, week, away: g.away, home: g.home, value: value[key], realLife: real.has(key) });
    }
  }
  return out.sort((a, b) => b.value - a.value);
};
