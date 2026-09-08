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
 *   league asleep       → 3 posts/day (the shared MAX_POSTS_PER_DAY budget)
 *   league awake        → 1 post/day
 *   deadline run-up     → 3 posts/day again, in BOTH leagues
 *
 * "Awake" starts at DRAFT WEEKEND, not at kickoff — see leagueAwakeWindow.
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

/** Rumor-mill posts per Pacific day while the league is awake. */
export const IN_SEASON_MAX_RUMOR_POSTS_PER_DAY = 1;

/**
 * The league wakes up at its DRAFTS, not at kickoff.
 *
 * The AFL's live AL draft is the Saturday nine days before Labor Day and its
 * NL email draft the Sunday eight days before (`sunday-before-labor-day-
 * weekend` in src/utils/league-event-resolver.ts); TheLeague's auction sits in
 * the same stretch. From that weekend on there are real rosters, real cuts and
 * real trade talk — the league is generating its own conversation, which is
 * the entire argument the quiet cap rests on. It just starts eleven days
 * before kickoff does.
 *
 * Anchoring on kickoff (Labor Day + 3) left the LOUDEST cadence — 3 posts/day
 * plus the busy-morning double — running through the busiest roster week of
 * the year. Owner report, 2026-09-08: two beats about the same trade offer one
 * second apart, 8:28am on the Tuesday after draft weekend.
 *
 * Held as an offset FROM KICKOFF rather than from Labor Day so both ends of
 * the window keep sharing a single anchor and cannot drift apart:
 * (Labor Day + 3) - 11 = Labor Day - 8, the NL draft Sunday.
 */
export const AWAKE_START_OFFSET_FROM_KICKOFF_DAYS = -11;

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
 * `{ startIso, endIso }` for the stretch in which the league runs its own
 * conversation, for the season that kicks off in `year` — inclusive PT
 * calendar dates. It opens on draft weekend (Labor Day - 8) and closes on
 * championship Monday, which lands in early January of `year + 1`.
 *
 * NOT called `leagueSeasonWindow`: the start is deliberately eleven days
 * before week-1 kickoff, so a reader who took the name to mean "games are
 * being played" would be wrong for the whole of draft-and-cuts week — the
 * exact stretch that made this change necessary.
 *
 * Both ends measure from kickoff. Deriving `endIso` from `startIso` instead
 * would drag championship Monday eleven days earlier every time the start
 * moves, retiring the mill's quiet cap in the middle of the playoffs.
 */
export function leagueAwakeWindow(year) {
  const kickoffIso = nflKickoffIsoDate(year);
  return {
    startIso: shiftIsoDate(kickoffIso, AWAKE_START_OFFSET_FROM_KICKOFF_DAYS),
    endIso: shiftIsoDate(kickoffIso, CHAMPIONSHIP_END_OFFSET_DAYS),
  };
}

/**
 * Is the league awake right now — drafting, cutting, playing or in the
 * playoffs, as opposed to sitting in the long quiet?
 *
 * Checks the CURRENT calendar year's window and the PREVIOUS one, because a
 * season that kicks off in September ends in January — in the first days of a
 * year the live season is the one that started 16 weeks ago. Deriving the
 * season year from a rollover helper instead would reintroduce exactly the
 * Labor-Day-clock trap CLAUDE.md documents: `getCurrentSeasonYear()` resolves
 * to LAST season from February through Labor Day, so a quiet date would
 * test against a window that closed months earlier and read as awake.
 */
export function isLeagueAwake(now = new Date()) {
  const today = ptDateString(now);
  const year = Number(today.slice(0, 4));
  return [year, year - 1].some((y) => {
    const { startIso, endIso } = leagueAwakeWindow(y);
    return today >= startIso && today <= endIso;
  });
}

/**
 * The rumor mill's own daily post cap for this league at this instant.
 *
 * `offseasonCap` is the shared daily budget (MAX_POSTS_PER_DAY) — passed in
 * rather than imported so the two constants cannot drift into disagreeing
 * about what "back to normal" means. It is the cap while the league is
 * ASLEEP; `isLeagueAwake` (draft weekend → championship Monday) is what
 * tightens it, not kickoff.
 */
export function rumorMillDailyCap(slug, now, offseasonCap) {
  if (!isLeagueAwake(now)) return offseasonCap;
  if (isTradeDeadlineWindow(slug, now)) return offseasonCap;
  return IN_SEASON_MAX_RUMOR_POSTS_PER_DAY;
}

/**
 * A short label for why the cap is what it is — logged on every gate check so
 * a quiet day is self-explaining in the Actions output.
 */
export function rumorMillCapReason(slug, now) {
  if (!isLeagueAwake(now)) return 'offseason';
  if (isTradeDeadlineWindow(slug, now)) return 'trade-deadline window';
  return 'league awake';
}

/**
 * May a single cycle ship TWO feed posts against one slot?
 *
 * Both catch-up mechanisms do this — the busy-morning trade split and the
 * gossip secondary — and BOTH must ask, because the counter increments once
 * per delivering cycle regardless of how many beats shipped. Under a 1/day cap
 * an ungated double-post puts two rumors in the chat back-to-back off a single
 * slot, which is the exact pile-up the quiet cap exists to prevent.
 *
 * Gating only one of the two was a real bug in this feature's first draft: the
 * gossip secondary stayed open, and the tighter cap made it fire MORE often,
 * because a 1/day mill drains the gossip queue slower and it crosses
 * SECONDARY_GOSSIP_POST_PRESSURE sooner. If a third double-post path is ever
 * added, it asks here too.
 */
export function allowsTwoPostCycle(slug, now, offseasonCap) {
  return rumorMillDailyCap(slug, now, offseasonCap) > 1;
}

/**
 * The Friday mailbag is the ONE thing exempt from the mill's daily cap.
 *
 * It is not discretionary chatter: it is the weekly sweep that stops
 * owner-submitted gossip tips from aging out unseen, and it is already limited
 * to once per Friday by its own `mailbag:done_date` key. Without the exemption
 * one earlier rumor spends the day's only in-season slot, the mailbag never
 * runs, and the swept tips are silently destroyed — the precise outcome the
 * mailbag exists to prevent. Losing a tip an owner actually wrote is worse
 * than one extra post a week.
 *
 * Kept as a named constant rather than an inline `true` so the exemption is
 * greppable and has somewhere for its reasoning to live. Nothing else may be
 * added to it without the same argument: the cap is the feature.
 */
export const MAILBAG_EXEMPT_FROM_MILL_CAP = true;
