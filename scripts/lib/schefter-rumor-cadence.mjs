/**
 * How loud the Schefter rumor mill is allowed to be, by date.
 *
 * The rumor mill exists to manufacture drama. During the season the league
 * generates its own — real games, real waiver moves, real trash talk — and a
 * beat reporter filing three trade rumors a day on top of that reads as spam
 * rather than as news (owner report, 2026-09-08: two rumors about the SAME
 * offer, 7.5 hours apart). In the offseason there is nothing else happening
 * and the rumor mill IS the league's conversation.
 *
 * So the cadence inverts with the calendar:
 *
 *   offseason           → 3 posts/day (the shared MAX_POSTS_PER_DAY budget)
 *   in season           → 1 post/day
 *   deadline run-up     → 3 posts/day again, in BOTH leagues
 *
 * The deadline exception is the one time in season when trade chatter is the
 * story, so the lane opens back up for the ten days leading into it.
 *
 * THIS CAP IS THE RUMOR MILL'S ALONE. It is deliberately NOT a change to
 * `MAX_POSTS_PER_DAY` in `schefter-groupme-budget.mjs`, which is the budget
 * SHARED with the transaction scanner's big-name-drop pings and the daily
 * speculation lane. Quieting trade gossip in season must not also mute a real
 * roster move, so the rumor mill counts its own deliveries against its own
 * counter and leaves the shared budget alone.
 */

import {
  isTradeDeadlineWindow,
  nflKickoffIsoDate,
  ptDateString,
  shiftIsoDate,
} from '../../src/utils/trade-deadline.mjs';

/** Rumor-mill posts per Pacific day while the season is being played. */
export const IN_SEASON_MAX_RUMOR_POSTS_PER_DAY = 1;

/**
 * The fantasy season ends with the league championship in NFL week 17 — QF
 * week 15, SF week 16, final week 17 in both leagues. Week N starts at
 * kickoff + (N-1)*7, and the week closes on Monday Night Football four days
 * later, so the season's last day is kickoff + 16*7 + 4.
 *
 * Anchored to the CHAMPIONSHIP rather than to the NFL calendar on purpose:
 * the day the title is decided is the day the offseason conversation starts,
 * and that is when the league wants its rumor mill back.
 */
export const CHAMPIONSHIP_WEEK = 17;
const CHAMPIONSHIP_END_OFFSET_DAYS = (CHAMPIONSHIP_WEEK - 1) * 7 + 4;

/**
 * `{ startIso, endIso }` for the season that KICKS OFF in `year` — inclusive
 * PT calendar dates. The window runs from week-1 kickoff (Labor Day + 3)
 * through championship Monday, which lands in early January of `year + 1`.
 */
export function leagueSeasonWindow(year) {
  const startIso = nflKickoffIsoDate(year);
  return { startIso, endIso: shiftIsoDate(startIso, CHAMPIONSHIP_END_OFFSET_DAYS) };
}

/**
 * Is a season actually being played right now?
 *
 * Checks the CURRENT calendar year's season and the PREVIOUS one, because a
 * season that kicks off in September ends in January — in the first days of a
 * year the live season is the one that started 16 weeks ago. Deriving the
 * season year from a rollover helper instead would reintroduce exactly the
 * Labor-Day-clock trap CLAUDE.md documents: `getCurrentSeasonYear()` resolves
 * to LAST season from February through Labor Day, so an offseason date would
 * test against a window that closed months earlier and read as "in season".
 */
export function isLeagueSeasonOpen(now = new Date()) {
  const today = ptDateString(now);
  const year = Number(today.slice(0, 4));
  return [year, year - 1].some((y) => {
    const { startIso, endIso } = leagueSeasonWindow(y);
    return today >= startIso && today <= endIso;
  });
}

/**
 * The rumor mill's own daily post cap for this league at this instant.
 *
 * `offseasonCap` is the shared daily budget (MAX_POSTS_PER_DAY) — passed in
 * rather than imported so the two constants cannot drift into disagreeing
 * about what "back to normal" means.
 */
export function rumorMillDailyCap(slug, now, offseasonCap) {
  if (!isLeagueSeasonOpen(now)) return offseasonCap;
  if (isTradeDeadlineWindow(slug, now)) return offseasonCap;
  return IN_SEASON_MAX_RUMOR_POSTS_PER_DAY;
}

/**
 * A short label for why the cap is what it is — logged on every gate check so
 * a quiet day is self-explaining in the Actions output.
 */
export function rumorMillCapReason(slug, now) {
  if (!isLeagueSeasonOpen(now)) return 'offseason';
  if (isTradeDeadlineWindow(slug, now)) return 'trade-deadline window';
  return 'in season';
}

/**
 * May the busy-morning catch-up ship TWO rumor beats in one cycle?
 *
 * Only where the cap is above one. Under a 1/day cap the double-post would
 * put two rumors in the chat back-to-back off a single slot — the exact
 * pile-up the in-season cap exists to prevent — so the overnight backlog just
 * clears a day slower instead.
 */
export function isBusyMorningAllowed(slug, now, offseasonCap) {
  return rumorMillDailyCap(slug, now, offseasonCap) > 1;
}
