/**
 * Schefter feed mode — is the Schefter Report acting as a personal assistant
 * right now, or filling an empty offseason?
 *
 * In season the feed's job is signal: news about players you roster or watch,
 * plus the deadline nudges that used to exist only as a push. Out of season
 * that content does not exist, so the feed falls back to the league-wide
 * filler (wire, lore, quiet-day posts) that keeps it alive from February to
 * the drafts.
 *
 * Boundaries:
 * - OPENS when the SEASON does — `getSeasonStartForYear` in league-year.ts,
 *   the Sunday before Labor Day weekend (the AFL's NL draft). This module
 *   does not define that date; it is the same instant `getCurrentSeasonYear`
 *   rolls on, so the feed can never disagree with standings about whether it
 *   is the season.
 * - CLOSES `SEASON_END_WEEKS` after kickoff — the one bound that IS this
 *   module's own, because a year selector has no end and the feed needs one.
 *
 * The single Schefter-specific near-miss NOT reused:
 * `isSeasonWindowOpen()` from pecking-order-season-window.mjs closes at
 * SEASON_WINDOW_WEEKS = 20 (~late January), which is BEFORE the Super Bowl.
 * That constant is the Pecking Order's own tuning; sharing it would mean
 * retuning that column silently moves the feed, and vice versa. Only the
 * kickoff math is shared, because that part is a fact about the NFL.
 */

import { getSeasonStartForYear } from './league-year';
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

/**
 * The instant season mode begins for `seasonYear`.
 *
 * Delegates — the season's start is not this module's to define. Keeping it a
 * named export means callers and tests read the feed's boundary from one place
 * without that place owning a second definition of the date.
 */
export function seasonModeStart(seasonYear: number): Date {
  return getSeasonStartForYear(seasonYear);
}

/** The instant season mode ends for `seasonYear`. */
export function seasonModeEnd(seasonYear: number): Date {
  return new Date(nflWeekOneKickoff(seasonYear).getTime() + SEASON_END_WEEKS * WEEK_MS);
}

/**
 * Which mode the feed is in at `now`.
 *
 * The candidate seasons come from the CALENDAR YEAR of `now`, not from
 * `getCurrentSeasonYear()`. A season window spans August of year Y to February
 * of Y+1, so exactly two seasons can contain any instant — `y` and `y - 1` —
 * and testing both is complete.
 *
 * Deriving them from the season year instead was wrong in a way that shipped:
 * the base year is floored by the `PUBLIC_BASE_YEAR` / `PUBLIC_MFL_YEAR` pin
 * (`max(pin, calendarYear - 1)`), and a pin set to the CURRENT calendar year is
 * honored deliberately (tests/league-year-rollover.test.ts pins that as a
 * feature). With `PUBLIC_BASE_YEAR=2026` on 2026-11-01, `getCurrentSeasonYear`
 * returns 2027, so the scan looked at 2027 and 2028 and reported `offseason`
 * for the whole of the real 2026 season. Reading the calendar year cannot be
 * skewed by a pin, because there is nothing to skew.
 */
export function resolveFeedMode(now: Date = new Date()): FeedMode {
  const calendarYear = now.getFullYear();
  for (const year of [calendarYear, calendarYear - 1]) {
    if (now >= seasonModeStart(year) && now <= seasonModeEnd(year)) return 'in-season';
  }
  return 'offseason';
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
