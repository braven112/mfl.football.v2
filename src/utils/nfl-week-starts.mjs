/**
 * When each NFL week actually starts — official schedule first, derivation second.
 *
 * THE RULE THIS REPLACES
 * ----------------------
 * "NFL kickoff is the Thursday after Labor Day, and week N starts kickoff +
 * (N-1)*7." That derivation was inlined in eight places and is a good estimate,
 * not a fact. The NFL moves weeks: 2026 opened on a WEDNESDAY (Sep 9), moved
 * week 12 to Wednesday for Thanksgiving, and finishes week 18 on a Sunday.
 * Roger announced "TODAY: NFL Season Starts" on Sep 10 2026, a day after the
 * season had already kicked off, because the derivation was the only source.
 *
 * So: `src/data/nfl/week-starts.mjs` carries the published schedule for the
 * seasons we have it, this module prefers it, and the derivation survives as
 * the fallback for the seasons we don't. That fallback is not vestigial — MFL
 * 404s a season's schedule until the NFL publishes it in spring, so from
 * February to May the next season has no official answer and something still
 * has to name a date.
 *
 * WHAT A "WEEK START" IS
 * ----------------------
 * The kickoff of the week's FIRST game. That is the moment the fantasy week is
 * live and lineups are locked, which is what every caller here is really
 * asking about. It is usually Thursday and must never be assumed to be.
 *
 * CALENDAR DATES, NOT INSTANTS
 * ----------------------------
 * The primary currency is `YYYY-MM-DD` on the Pacific clock, for the reason
 * `trade-deadline.mjs` spells out: callers ask day-grained questions ("is today
 * the deadline"), and an instant converted under the wrong seasonal offset
 * lands on the wrong day. `nflWeekStartInstant` is there for the two callers
 * that genuinely need the moment.
 */

import { laborDayDate } from './labor-day.mjs';
import { NFL_WEEK_STARTS } from '../data/nfl/week-starts.mjs';

/** Weeks in an NFL regular season. Playoff weeks are not week starts we track. */
export const REGULAR_SEASON_WEEKS = 18;

/** Nominal kickoff time for a DERIVED week start: 20:20 ET, i.e. 17:20 PT. */
const DERIVED_KICKOFF_PT = { hour: 17, minute: 20 };

const pad = (n, width = 2) => String(n).padStart(width, '0');

const PT_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * Break an instant into its Pacific wall-clock parts, including the UTC offset
 * in force at that moment (`-07:00` in September, `-08:00` in December).
 */
export function ptParts(instant) {
  const parts = Object.fromEntries(
    PT_FORMAT.formatToParts(instant)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  );
  // Offset = the same wall clock read as UTC, minus the real instant.
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offsetMinutes = Math.round((asUtc - instant.getTime()) / 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return {
    ...parts,
    offset: `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`,
  };
}

/** `YYYY-MM-DD` for a naive calendar date. */
const isoDate = (year, month, day) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

/**
 * Shift a `YYYY-MM-DD` by whole days. Both ends are naive dates and the
 * arithmetic goes through `Date.UTC`, so no zone or DST boundary is involved.
 */
export function shiftIsoDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return isoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** The Pacific instant for a naive date + wall-clock time. */
function ptInstant(iso, { hour, minute }) {
  const [y, m, d] = iso.split('-').map(Number);
  // Two-pass: guess at PST, then correct by the offset actually in force. One
  // correction always suffices — the guess is at most an hour off, and no US
  // DST transition happens near an evening kickoff.
  const guess = new Date(Date.UTC(y, m - 1, d, hour + 8, minute));
  const [sign, hh, mm] = /([+-])(\d{2}):(\d{2})/.exec(ptParts(guess).offset).slice(1);
  const offsetMinutes = (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm));
  return new Date(Date.UTC(y, m - 1, d, hour, minute) - offsetMinutes * 60_000);
}

const assertWeek = (week) => {
  if (!Number.isInteger(week) || week < 1 || week > REGULAR_SEASON_WEEKS) {
    throw new Error(`Invalid NFL week: ${week}`);
  }
};

/**
 * The Labor Day derivation, kept as the fallback: kickoff is the Thursday
 * after Labor Day (Labor Day + 3) and week N is (week - 1) weeks later.
 */
export function derivedWeekStartIsoDate(year, week) {
  assertWeek(week);
  return shiftIsoDate(isoDate(year, 9, laborDayDate(year)), 3 + (week - 1) * 7);
}

/** The derivation as a local-midnight `Date`. */
export function derivedWeekStart(year, week) {
  const [y, m, d] = derivedWeekStartIsoDate(year, week).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Do we hold the published schedule for `year`? */
export function hasOfficialSchedule(year) {
  return Boolean(NFL_WEEK_STARTS[year]);
}

/**
 * The published first-kickoff for a week as a full Pacific ISO string, or null
 * when we have no schedule for that season.
 */
export function officialWeekStart(year, week) {
  assertWeek(week);
  return NFL_WEEK_STARTS[year]?.[week] ?? null;
}

/**
 * `YYYY-MM-DD` (Pacific) of the week's first kickoff — the published date when
 * we have it, the Labor Day derivation when we don't. THE function to call.
 */
export function nflWeekStartIsoDate(year, week) {
  return officialWeekStart(year, week)?.slice(0, 10) ?? derivedWeekStartIsoDate(year, week);
}

/** The week's first kickoff as a local-midnight `Date` (for local date math). */
export function nflWeekStart(year, week) {
  const [y, m, d] = nflWeekStartIsoDate(year, week).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * The week's first kickoff as an exact instant. Derived seasons get the
 * nominal 20:20 ET slot, which is what the old hardcoded map used.
 */
export function nflWeekStartInstant(year, week) {
  const official = officialWeekStart(year, week);
  if (official) return new Date(official);
  return ptInstant(derivedWeekStartIsoDate(year, week), DERIVED_KICKOFF_PT);
}

/** Season kickoff — week 1's first game. */
export function nflKickoffIsoDate(year) {
  return nflWeekStartIsoDate(year, 1);
}

/** Season kickoff as a local-midnight `Date`. */
export function nflKickoff(year) {
  return nflWeekStart(year, 1);
}
