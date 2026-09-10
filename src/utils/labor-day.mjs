/**
 * Labor Day — the one implementation.
 *
 * Extracted from `pecking-order-season-window.mjs` (which still re-exports
 * `laborDayDate`, so every existing importer is unaffected) purely to break an
 * import cycle: `nfl-week-starts.mjs` needs Labor Day for its fallback, and the
 * season-window module needs `nfl-week-starts.mjs` for the real kickoff. A leaf
 * module both can depend on is cheaper than either of them growing a second
 * copy of the formula — CLAUDE.md's rollover rules exist because a re-ported
 * date formula drifted in five files.
 */

/**
 * Day-of-month of Labor Day (first Monday of September) in `year`.
 *
 * UTC arithmetic on purpose: the answer is a naive calendar number, and going
 * through UTC keeps a server in any timezone from reading Sep 1 as Aug 31.
 */
export function laborDayDate(year) {
  const sep1Day = new Date(Date.UTC(year, 8, 1)).getUTCDay();
  const offset = sep1Day === 1 ? 0 : sep1Day === 0 ? 1 : 8 - sep1Day;
  return 1 + offset;
}

/** Labor Day as a local-midnight `Date`, for callers doing local date math. */
export function laborDay(year) {
  return new Date(year, 8, laborDayDate(year));
}

/** Labor Day as `YYYY-MM-DD` — a naive calendar date, no zone involved. */
export function laborDayIsoDate(year) {
  return `${year}-09-${String(laborDayDate(year)).padStart(2, '0')}`;
}
