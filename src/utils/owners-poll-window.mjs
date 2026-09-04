/**
 * The Owners' Poll — when a ballot opens and closes.
 *
 * Pure date math, no clock of its own and no I/O, so the generator, the manual
 * CLI and the tests all agree on exactly one answer. Plain .mjs for the same
 * dual-consumer reason as owners-poll-ballot.mjs.
 *
 * The shape of the week, and why:
 *
 *   Tue ~07:00 PT  The Pecking Order publishes. The ballot OPENS with it.
 *   Wed  18:00 PT  The ballot CLOSES (per-league `closeHourPT`).
 *   Wed ~19:00 PT  The close pass tallies, amends the issue, reveals.
 *
 * Opening with the column rather than closing before it is the whole point: a
 * ballot that had to close before Tuesday's generation would have run
 * overnight from the end of Monday Night Football, a ~6-hour window that is a
 * guaranteed turnout failure. Opening it instead buys ~36 hours and three
 * GroupMe touchpoints (open, nag, reveal) instead of one.
 *
 * See docs/plans/owners-poll.md, "Timing".
 */

const TZ = 'America/Los_Angeles';

/** Wednesday. The close day is fixed; only the HOUR is per-league config. */
export const CLOSE_WEEKDAY_PT = 3;

/**
 * How far ahead of UTC the wall clock in `tz` reads at `date`, in ms.
 *
 * Derived through Intl rather than a fixed -8/-7, because the poll runs across
 * the November DST change every season and a hardcoded offset would move the
 * deadline by an hour without anyone noticing until the ballot closed early.
 */
function zoneOffsetMs(date, tz = TZ) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Intl can emit hour '24' for midnight in hour12:false — normalize it, or
    // Date.UTC rolls the day forward and the offset comes out 24h wrong.
    parts.hour === '24' ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUTC - date.getTime();
}

/** The Y/M/D and weekday a UTC instant falls on in Pacific time. */
export function ptCalendarParts(instant, tz = TZ) {
  const date = instant instanceof Date ? instant : new Date(instant);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAYS[parts.weekday],
  };
}

/**
 * The UTC instant of a Pacific wall-clock time.
 *
 * Applied twice because the offset depends on the answer: converting a wall
 * time near a DST boundary with the offset measured at the naive guess lands
 * an hour out. The second pass re-measures at the corrected instant, which
 * settles it for every case except the one hour that does not exist in spring
 * forward — and 18:00 is never that hour.
 */
export function ptWallTimeToInstant(year, month, day, hour, tz = TZ) {
  const wallAsUTC = Date.UTC(year, month - 1, day, hour, 0, 0);
  let utc = wallAsUTC;
  for (let i = 0; i < 2; i += 1) {
    utc = wallAsUTC - zoneOffsetMs(new Date(utc), tz);
  }
  return utc;
}

/**
 * Resolve a ballot window from the moment the column published.
 *
 * @param {object} args
 * @param {Date|number|string} args.publishedAt When the issue went out.
 * @param {number} args.closeHourPT League config, 24h Pacific.
 * @param {number} [args.closeWeekday] Defaults to Wednesday.
 * @returns {{ opensAt: string, closesAt: string }} ISO instants.
 *
 * The close is the FIRST `closeWeekday` at `closeHourPT` strictly after the
 * open. Publishing late enough on a Wednesday that the hour has already
 * passed therefore rolls to the following week rather than producing a window
 * that is already closed — a zero-length window would read to every owner as
 * "the poll is broken", and to the close pass as "nobody voted".
 *
 * A publish that lands EARLIER on a Wednesday still yields a short window (a
 * delayed cron at 09:00 PT leaves nine hours). That is deliberately not
 * "fixed" here by stretching the close or rolling a week: stretching puts the
 * close after the Wednesday-evening tally cron, and rolling makes one ballot
 * span two columns. Both are worse than a short window. The generator warns
 * instead — see SHORT_WINDOW_HOURS — so an operator sees the anomaly and can
 * decide, which is the right place for a judgement call about an operational
 * hiccup.
 */
export function resolveOwnersPollWindow({
  publishedAt,
  closeHourPT,
  closeWeekday = CLOSE_WEEKDAY_PT,
}) {
  const opensMs = publishedAt instanceof Date ? publishedAt.getTime() : new Date(publishedAt).getTime();
  if (!Number.isFinite(opensMs)) {
    throw new TypeError(`owners-poll: invalid publishedAt ${JSON.stringify(publishedAt)}`);
  }
  if (!Number.isInteger(closeHourPT) || closeHourPT < 0 || closeHourPT > 23) {
    throw new TypeError(`owners-poll: invalid closeHourPT ${JSON.stringify(closeHourPT)}`);
  }

  const { year, month, day, weekday } = ptCalendarParts(opensMs);
  const daysAhead = (closeWeekday - weekday + 7) % 7;

  let closesMs = ptWallTimeToInstant(year, month, day + daysAhead, closeHourPT);
  if (closesMs <= opensMs) {
    closesMs = ptWallTimeToInstant(year, month, day + daysAhead + 7, closeHourPT);
  }

  return {
    opensAt: new Date(opensMs).toISOString(),
    closesAt: new Date(closesMs).toISOString(),
  };
}

/**
 * Below this, the generator warns rather than silently opening a ballot
 * nobody has time to fill in. Not enforced in the math — see above.
 */
export const SHORT_WINDOW_HOURS = 12;

/** Hours between open and close, for logs and copy. */
export function windowHours({ opensAt, closesAt }) {
  return (Date.parse(closesAt) - Date.parse(opensAt)) / 3600000;
}
