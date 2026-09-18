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
 *   Thu  16:00 PT  The ballot CLOSES — or earlier, if kickoff is earlier.
 *   Thu ~17:00 PT  The close pass tallies, amends the issue, reveals.
 *
 * Two decisions are load-bearing here.
 *
 * **The ballot opens WITH the column, not before it.** A ballot that had to
 * close before Tuesday's generation would have run overnight from the end of
 * Monday Night Football — a ~6-hour window, and a guaranteed turnout failure.
 *
 * **It closes at the deadline owners already obey.** Setting a lineup before
 * the first kickoff is the one obligatory weekly action in this league, and it
 * mostly happens Wednesday through Sunday. A Wednesday-evening ballot deadline
 * therefore closed before the highest-traffic weekly action even started, so
 * the poll was competing with owners' existing habit instead of riding it.
 * Closing at kickoff means one trip does both.
 *
 * See docs/plans/owners-poll.md, "Timing".
 */

const TZ = 'America/Los_Angeles';

/**
 * Thursday — the day the NFL week starts, so the last full day to vote.
 * Both the day and the hour are per-league config; these are the defaults.
 */
export const CLOSE_WEEKDAY_PT = 4;

/**
 * How far before the first kickoff the ballot shuts.
 *
 * Not zero: a ballot that closes exactly at kickoff lets an owner submit while
 * the first snap is being played, and the close cron would race the game.
 */
export const KICKOFF_BUFFER_MINUTES = 15;

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
 * @param {number} [args.closeWeekday] Defaults to Thursday.
 * @param {Date|number|string|null} [args.firstKickoff] First kickoff of the
 *   UPCOMING NFL week, when the schedule feed can supply it.
 * @param {number} [args.kickoffBufferMinutes]
 * @returns {{ opensAt: string, closesAt: string, clampedToKickoff: boolean }}
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
  firstKickoff = null,
  kickoffBufferMinutes = KICKOFF_BUFFER_MINUTES,
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

  // Never let voting run past the first snap. On a normal week the scheduled
  // hour lands well before Thursday night football and this changes nothing;
  // on Thanksgiving, where the week opens around 10:00 PT, the scheduled hour
  // would otherwise sit HOURS after two games had been played. Voting with
  // results in hand is not the same poll.
  let clampedToKickoff = false;
  const kickoffMs =
    firstKickoff == null
      ? NaN
      : firstKickoff instanceof Date
        ? firstKickoff.getTime()
        : new Date(firstKickoff).getTime();
  if (Number.isFinite(kickoffMs)) {
    const cutoff = kickoffMs - kickoffBufferMinutes * 60000;
    if (cutoff < closesMs) {
      // Only if it still leaves a window at all — a kickoff BEFORE the column
      // published means the feed is describing a different week, and trusting
      // it would produce an already-closed ballot.
      if (cutoff > opensMs) {
        closesMs = cutoff;
        clampedToKickoff = true;
      }
    }
  }

  return {
    opensAt: new Date(opensMs).toISOString(),
    closesAt: new Date(closesMs).toISOString(),
    clampedToKickoff,
  };
}

/**
 * Resolve the CURRENT voting cycle — the always-open model.
 *
 * Voting never stops. There is no open instant to anchor to and no closed
 * period to be in: at any moment during the season there is exactly one
 * pending announce, and a ballot changed before it counts toward it. Change
 * your ballot after it and you have changed your vote for the next one.
 *
 * This replaces `resolveOwnersPollWindow` on the live path. The difference is
 * the anchor: that one measured forward from the instant the column published
 * and was CLEARED at the close, which is what created a multi-day stretch each
 * week where the ballot refused votes. This measures forward from `now`, so it
 * is always answerable and never expires.
 *
 * **The cycle is derived, never stored**, and that is deliberate rather than a
 * simplification. The old pointer carried a TTL. An always-open pointer that
 * nothing rewrites would eventually expire, and an expired pointer reads as
 * "no ballot is open" — the feature would switch itself off with no error and
 * no deploy. A fact you can compute must not be made durable.
 *
 * @param {object} args
 * @param {Date|number|string} args.now
 * @param {number} args.closeHourPT League config, 24h Pacific.
 * @param {number} [args.closeWeekday] Defaults to Thursday.
 * @param {Date|number|string|null} [args.firstKickoff] First kickoff of the
 *   upcoming NFL week, when the schedule feed can supply it.
 * @param {number} [args.kickoffBufferMinutes]
 * @returns {{ opensAt: string, closesAt: string, clampedToKickoff: boolean, cycleKey: string }}
 */
export function resolveOwnersPollCycle({
  now = new Date(),
  closeHourPT,
  closeWeekday = CLOSE_WEEKDAY_PT,
  firstKickoff = null,
  kickoffBufferMinutes = KICKOFF_BUFFER_MINUTES,
}) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) {
    throw new TypeError(`owners-poll: invalid now ${JSON.stringify(now)}`);
  }
  if (!Number.isInteger(closeHourPT) || closeHourPT < 0 || closeHourPT > 23) {
    throw new TypeError(`owners-poll: invalid closeHourPT ${JSON.stringify(closeHourPT)}`);
  }

  const { year, month, day, weekday } = ptCalendarParts(nowMs);
  const daysAhead = (closeWeekday - weekday + 7) % 7;

  let closesMs = ptWallTimeToInstant(year, month, day + daysAhead, closeHourPT);
  if (closesMs <= nowMs) {
    closesMs = ptWallTimeToInstant(year, month, day + daysAhead + 7, closeHourPT);
  }

  // Never let voting run past the first snap — unchanged from the windowed
  // model, and for the same reason: on a Thanksgiving week the scheduled hour
  // sits HOURS after two games have been played, and voting with results in
  // hand is not the same poll.
  let clampedToKickoff = false;
  const kickoffMs =
    firstKickoff == null
      ? NaN
      : firstKickoff instanceof Date
        ? firstKickoff.getTime()
        : new Date(firstKickoff).getTime();
  if (Number.isFinite(kickoffMs)) {
    const cutoff = kickoffMs - kickoffBufferMinutes * 60000;
    // Only when it still leaves a cycle at all. A kickoff already in the past
    // means the feed is describing a different week, and trusting it would
    // produce an announce instant that has already gone by.
    if (cutoff < closesMs && cutoff > nowMs) {
      closesMs = cutoff;
      clampedToKickoff = true;
    }
  }

  // Informational only — nothing gates a write on it, because voting is always
  // open. It exists so copy can say "since Thursday" without a second clock.
  const opensMs = closesMs - 7 * 86400000;
  const c = ptCalendarParts(closesMs);

  return {
    opensAt: new Date(opensMs).toISOString(),
    closesAt: new Date(closesMs).toISOString(),
    clampedToKickoff,
    // Stable per announce, in Pacific — the identifier a snapshot and a reveal
    // hero dedupe on, so neither depends on a stored pointer.
    cycleKey: `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`,
  };
}

/**
 * Below this, the generator warns rather than silently opening a ballot
 * nobody has time to fill in. Not enforced in the math — see above.
 *
 * Meaningful only on the commissioner override path now: a derived cycle is
 * always about a week long.
 */
export const SHORT_WINDOW_HOURS = 12;

/** Hours between open and close, for logs and copy. */
export function windowHours({ opensAt, closesAt }) {
  return (Date.parse(closesAt) - Date.parse(opensAt)) / 3600000;
}
