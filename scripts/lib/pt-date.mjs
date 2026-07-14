/**
 * Shared Pacific-Time date/hour helpers for node scripts.
 *
 * Consolidates the Intl + 'America/Los_Angeles' helpers duplicated between
 * scripts/schefter-rumor-scan.mjs (getPtHour, getPtDateString,
 * secondsUntilPtMidnight, isFridayPt) and scripts/fetch-espn-schedule.mjs
 * (formatTimePT). All resolve Pacific time via Intl regardless of the
 * runner's local timezone, so behavior is identical whether this runs on a
 * developer laptop or a UTC GitHub Actions runner.
 *
 * Note: scripts/schefter-groupme-listen.mjs's year-rollover helper
 * (getStyleBookSeasonYear) does its own UTC-epoch arithmetic instead of
 * Intl/America-Los_Angeles formatting — it isn't a duplicate of anything
 * here, so it was left as-is.
 */

/** Current hour (0-23) in America/Los_Angeles. */
export function getPtHour(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(fmt.format(now), 10);
}

/** Current date as YYYY-MM-DD in America/Los_Angeles. */
export function getPtDateString(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now);
}

/** Seconds remaining until the next America/Los_Angeles midnight. */
export function secondsUntilPtMidnight(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  const h = parseInt(parts.hour, 10);
  const m = parseInt(parts.minute, 10);
  const s = parseInt(parts.second, 10);
  return 24 * 3600 - (h * 3600 + m * 60 + s);
}

/** True when it's currently Friday in America/Los_Angeles. */
export function isFridayPt(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
  });
  return fmt.format(now) === 'Fri';
}

/** Format an ISO date string as e.g. "1:00 PM PST" in America/Los_Angeles. */
export function formatTimePT(dateString) {
  const date = new Date(dateString);
  const timeString = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Los_Angeles',
  });
  return `${timeString} PST`;
}
