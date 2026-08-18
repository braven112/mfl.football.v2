/**
 * Season window for The Pecking Order.
 *
 * Lives in src/utils because BOTH the generator (scripts/) and the landing
 * page (src/) ask the same question — "is the season this column ranks
 * actually being played right now?" The generator uses it to stay silent; the
 * page uses it to decide whether the issue on screen is live or a sample.
 *
 * The column's Tuesday cron runs year-round and was guarded only by "the
 * target year's feeds have a completed week". That guard cannot see the
 * offseason, because `currentSeasonYear()` runs on the LABOR DAY clock: from
 * February through Labor Day it still resolves to LAST season, whose feeds are
 * complete by definition. So every preseason Tuesday the generator happily
 * ranked a season that finished months ago, and the only thing keeping the
 * chat quiet was the per-week issue file already existing. The first gap in
 * that archive (AFL 2025 week 16) blew a full GroupMe announcement into the
 * league in the middle of the 2026 preseason (owner report, 2026-08-18).
 *
 * The window below is the real gate: the column may only run while the season
 * it is ranking is actually being played. That closes BOTH offseason gaps —
 * the long Feb→Labor Day one (year resolves to a finished season) and the
 * short Labor Day→kickoff one (year resolves to a season that hasn't started).
 * Combined with the completed-week check, the earliest possible issue is the
 * Tuesday after week 1.
 */

/**
 * NFL week 1 kickoff (Thursday night, 20:20 ET) for a season year.
 *
 * DERIVED from Labor Day rather than table-driven on purpose: a hardcoded map
 * silently expires, and this column is meant to keep working without an annual
 * edit. The NFL opener is the Thursday after Labor Day (first Monday of
 * September + 3 days), which reproduces every entry in week-resolver's
 * KICKOFF_DATES map for 2024-2027 exactly.
 *
 * Returned as a UTC instant: 20:20 ET in September is 00:20 UTC the next day,
 * hence the +4 days.
 */
export function nflWeekOneKickoff(year) {
  return new Date(Date.UTC(year, 8, laborDayDate(year) + 4, 0, 20));
}

/** Day-of-month of Labor Day (first Monday of September) in `year`. */
function laborDayDate(year) {
  const sep1Day = new Date(Date.UTC(year, 8, 1)).getUTCDay();
  const offset = sep1Day === 1 ? 0 : sep1Day === 0 ? 1 : 8 - sep1Day;
  return 1 + offset;
}

/**
 * Weeks after kickoff that the column stays eligible. Both leagues wrap their
 * fantasy season by NFL week 17-18, so 20 weeks (~late January) is a
 * comfortable ceiling that still slams shut long before the next preseason.
 */
export const SEASON_WINDOW_WEEKS = 20;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Is `year`'s season in progress at `now`? */
export function isSeasonWindowOpen(year, now = new Date()) {
  const kickoff = nflWeekOneKickoff(year);
  if (now < kickoff) return false;
  return now - kickoff <= SEASON_WINDOW_WEEKS * WEEK_MS;
}

/**
 * The instant the season's FIRST issue can publish: week 1 kicks off Thursday
 * night, wraps Monday night, and the cron runs 7am PT Tuesday (14:00 UTC) —
 * eight days after Labor Day. Anchored to the cron slot rather than
 * kickoff + 5 days, because kickoff is stored as its UTC instant (Thursday
 * 20:20 ET is already Friday in UTC) and the arithmetic slides a day.
 */
export function firstIssueTuesday(year) {
  return new Date(Date.UTC(year, 8, laborDayDate(year) + 8, 14, 0));
}

/**
 * The next first-issue Tuesday, or null once that date has passed for the
 * calendar year in progress. Null is the honest answer rather than a date a
 * year out: it means "the season's opening Tuesday is behind us", and callers
 * should say "every Tuesday during the season" instead of naming a day.
 */
export function upcomingFirstIssueDate(now = new Date()) {
  const target = firstIssueTuesday(now.getUTCFullYear());
  return now < target ? target : null;
}
