/**
 * Which NFL season's snap counts a surface should show.
 *
 * THE BUG THIS EXISTS TO STOP
 * ---------------------------
 * The Free Agents page used to pick its snap-count file by filename sort —
 * "the most recent file wins" — and label the columns `Snaps` / `Snap%` with
 * no season anywhere. Nothing scheduled the fetch, so the newest file on disk
 * was the 2025 season captured in February 2026, and in week 2 of the 2026
 * season the page confidently showed Kareem Hunt at 529 snaps next to an empty
 * GP. A stale file is indistinguishable from a live one when the only thing
 * choosing it is `sort().reverse()`.
 *
 * THE RULE
 * --------
 * Once the season's official kickoff has passed, show THAT season, however
 * thin it is — week 1 usage is the question an owner is asking in September.
 * Before kickoff (the whole offseason, including the Labor Day → kickoff gap)
 * show the last completed season.
 *
 * Kickoff is `nflWeekOneKickoff`, never a derivation from Labor Day: 2026
 * opened on a WEDNESDAY, so "the Thursday after Labor Day" sits closed through
 * the season's first game. See src/utils/nfl-week-starts.mjs.
 *
 * The year is read off the PACIFIC clock. On New Year's Eve a UTC year and a
 * PT year disagree, and since neither season has kicked off in January the two
 * answers differ by a whole season.
 */

import { nflWeekOneKickoff } from './pecking-order-season-window.mjs';
import { ptParts } from './nfl-week-starts.mjs';

/**
 * The season whose snap counts should be on screen at `now`:
 * the most recent season whose week 1 has kicked off.
 */
export function snapCountSeason(now = new Date()) {
  const year = ptParts(now).year;
  return now >= nflWeekOneKickoff(year) ? year : year - 1;
}

/**
 * Choose a snap-count season from the ones we actually hold on disk.
 *
 * Returns the wanted season when we have it. Otherwise the newest season we
 * DO hold that is not in the future — which covers the real gap between
 * kickoff and the first Tuesday fetch, when the new season exists but no
 * games have been played yet. Never silently upgrades: the caller gets the
 * season back so it can be rendered next to the number.
 *
 * @param {Iterable<number>} available seasons present on disk
 * @param {Date} now
 * @returns {number | null}
 */
export function pickSnapCountSeason(available, now = new Date()) {
  const wanted = snapCountSeason(now);
  const seasons = [...available].filter((y) => Number.isFinite(y)).sort((a, b) => b - a);
  if (seasons.includes(wanted)) return wanted;
  return seasons.find((y) => y < wanted) ?? null;
}
