/**
 * Schefter feed mode — is the Schefter Report acting as a personal assistant
 * right now, or filling an empty offseason?
 *
 * In season the feed's job is signal: news about players you roster or watch,
 * plus the deadline nudges that used to exist only as a push. Out of season
 * that content does not exist, so the feed falls back to the league-wide
 * filler (wire, lore, quiet-day posts) that keeps it alive from February to
 * Labor Day. One date decides which, and it lives HERE so no page re-derives
 * it — the repo has already shipped the same year-rollover formula five times
 * with a different bug in each copy.
 *
 * Boundaries (commissioner's call: "Labor Day → Super Bowl"):
 * - OPENS on Labor Day, which is also when `getCurrentSeasonYear()` rolls, so
 *   the mode and the season year it describes flip on the same instant. The
 *   NFL opener is three days later; the gap is deliberate — an owner checking
 *   in over Labor Day weekend is in football mode even if kickoff has not
 *   happened.
 * - CLOSES `SEASON_END_WEEKS` after kickoff.
 *
 * Two near-misses this module deliberately does NOT reuse:
 * - `isSeasonWindowOpen()` from pecking-order-season-window.mjs closes at
 *   SEASON_WINDOW_WEEKS = 20 (~late January), which is BEFORE the Super Bowl.
 *   That constant is the Pecking Order's own tuning; sharing it would mean
 *   retuning that column silently moves the feed, and vice versa. Only the
 *   kickoff math is shared, because that part is a fact about the NFL.
 * - `isInSeason()` from current-week.ts is table-driven off SEASON_CONFIGS
 *   (2024-2026 only) and expires. The Labor Day-derived math does not.
 */

import { getCurrentSeasonYear, getLaborDayForYear } from './league-year';
import { nflWeekOneKickoff } from './pecking-order-season-window.mjs';

export type FeedMode = 'in-season' | 'offseason';

/**
 * Weeks after kickoff that the feed stays in season mode.
 *
 * The Super Bowl falls ~22 weeks after the opener (2027-02-14 for a
 * 2026-09-10 kickoff). 23 leaves a few days on the far side so the feed does
 * not flip to filler on the Monday morning everyone is still talking about the
 * game. Verified against the 2024-2027 openers in
 * tests/schefter-season-mode.test.ts.
 */
export const SEASON_END_WEEKS = 23;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The instant season mode ends for `seasonYear`. */
export function seasonModeEnd(seasonYear: number): Date {
  return new Date(nflWeekOneKickoff(seasonYear).getTime() + SEASON_END_WEEKS * WEEK_MS);
}

/**
 * Which mode the feed is in at `now`.
 *
 * The season year comes from `getCurrentSeasonYear()` — the RESULTS clock
 * (Labor Day), never `getCurrentLeagueYear()` (Feb 14, roster-management
 * shaped). Picking the wrong one here would leave the feed in season mode for
 * roughly six months of the calendar.
 */
export function resolveFeedMode(now: Date = new Date()): FeedMode {
  const seasonYear = getCurrentSeasonYear(now);
  if (now < getLaborDayForYear(seasonYear)) return 'offseason';
  return now <= seasonModeEnd(seasonYear) ? 'in-season' : 'offseason';
}

/**
 * The tab a visitor lands on when the URL carries no `?source=`.
 *
 * This one line is the whole "quiet by default" decision: in season a signed-in
 * owner opens on their own players, everyone else opens on the full feed.
 * `null` means "All" — the historical default, and the only thing a
 * logged-out or team-less visitor ever sees, in either mode.
 *
 * An explicit `?source=` in the URL must always win over this; callers apply
 * it only when the param is absent.
 */
export function defaultSource(mode: FeedMode, canWatch: boolean): 'watching' | null {
  return mode === 'in-season' && canWatch ? 'watching' : null;
}
