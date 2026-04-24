/**
 * Roger reminder window logic — extracted so it can be unit-tested.
 *
 * Background (April 2026): schefter-scan was firing the "TODAY: NFL Draft"
 * GroupMe post on Wednesday when the draft was actually Thursday. Two bugs:
 *
 *   1. compute-league-events used Math.ceil on a raw timestamp delta, so a
 *      start only a few hours away rounded up to daysUntil=1 instead of
 *      staying at 1 until local midnight.
 *   2. The reminder window was symmetric ±1 around each touch's targetDays,
 *      which let daysUntil=1 fire the dayof touch (targetDays=0).
 *
 * The fix: calendar-day diff (midnight→midnight) + an asymmetric late-
 * catch-up window. Reminders fire on the target day or one day late if the
 * scan missed a run — never early.
 *
 * DO NOT inline these helpers again. The unit tests in
 * tests/roger-reminder-window.test.ts lock in this behavior; regressing
 * either function will flip them red.
 */

/**
 * Whether a reminder touch should fire given how many days remain until
 * the event starts.
 *
 * Window: [targetDays - 1, targetDays]. Target day is the primary fire;
 * one day late is the catch-up if the scanner missed a run. Never early.
 *
 * @param {number} targetDays - Desired days-out for this touch (0 for dayof)
 * @param {number} daysUntil  - Calendar days until event start (negative = past)
 * @returns {boolean}
 */
export function shouldFireReminder(targetDays, daysUntil) {
  return daysUntil <= targetDays && daysUntil >= targetDays - 1;
}

/**
 * Calendar-day difference between two Dates, measured at local midnight.
 * "Tomorrow" is always 1 regardless of what hour you call it.
 *
 * @param {Date} start - Event start time
 * @param {Date} now   - Reference time
 * @returns {number}
 */
export function calendarDaysUntil(start, now) {
  const startMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((startMidnight - nowMidnight) / (1000 * 60 * 60 * 24));
}
