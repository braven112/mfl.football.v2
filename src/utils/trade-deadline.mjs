/**
 * Per-league trade deadline, resolved from the registry.
 *
 * Lives in src/utils because both node scripts (the Schefter rumor scanner)
 * and app code ask the same question. The DATA is in
 * `src/config/leagues-data.mjs#tradeDeadline` — never inline a date here or at
 * a call site; CLAUDE.md's league-registry rule covers exactly this shape of
 * constant, and `tests/league-literal-guard.test.ts` polices the leagues.
 *
 * Everything below works in PT CALENDAR DATES (`YYYY-MM-DD` strings), not
 * instants, and that is deliberate. The only questions callers ask are "is
 * today the deadline" and "is today inside the run-up window" — both are
 * day-grained. Comparing `YYYY-MM-DD` strings answers them without a single
 * UTC-offset conversion, which is where this kind of code normally goes wrong:
 * the deadline sits in November, PT is UTC-8 then but UTC-7 in September, and
 * an instant built from one offset lands on the wrong day under the other.
 */

import { LEAGUES } from '../config/leagues-data.mjs';
import { nflWeekStartIsoDate } from './nfl-week-starts.mjs';

/** `Date` → `YYYY-MM-DD` as read on the Pacific clock. */
export function ptDateString(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** `YYYY-MM-DD` for a plain calendar date, with no timezone in the loop. */
function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Shift a `YYYY-MM-DD` string by whole days.
 *
 * Goes through `Date.UTC` purely as calendar arithmetic — both ends are naive
 * dates, so no zone is involved and no DST boundary can move the result.
 */
export function shiftIsoDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return isoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/**
 * The NFL week-1 kickoff DATE for `year`, on the Pacific clock.
 *
 * Distinct from `nflWeekOneKickoff`, which returns the kickoff as a UTC
 * instant — already the NEXT calendar day in UTC. Day arithmetic off that
 * instant slides a day, which is what the pecking-order module's own comment
 * warns about, so day-grained callers start here instead.
 *
 * No longer "the Thursday after Labor Day": that derivation is now only the
 * fallback inside nfl-week-starts.mjs, behind MFL's published schedule.
 */
export function nflKickoffIsoDate(year) {
  return nflWeekStartIsoDate(year, 1);
}

/**
 * The league's trade deadline for `year`, as `YYYY-MM-DD` on the Pacific
 * clock — or `null` for a league that has no deadline (Best Ball drafts and
 * never trades). Callers must handle null rather than substituting a date.
 */
export function tradeDeadlineIsoDate(slug, year) {
  const spec = LEAGUES[slug]?.tradeDeadline;
  if (!spec) return null;

  if (spec.kind === 'fixed') return isoDate(year, spec.month, spec.day);

  if (spec.kind === 'computed' && spec.rule === 'wednesday-between-week-10-and-11') {
    // The day before NFL week 11 opens — the Wednesday that closes week 10 in a
    // normal Thursday-anchored season. Taken from week 11's own published start
    // rather than counted forward from kickoff, so a moved week carries the
    // deadline with it. Same rule as `afl-trade-deadline` in
    // league-event-resolver.ts, pinned against it by
    // tests/schefter-rumor-cadence.test.ts.
    return shiftIsoDate(nflWeekStartIsoDate(year, 11), -1);
  }

  if (spec.kind === 'computed' && spec.rule === 'friday-before-week-11') {
    // TheLeague (Constitution: "The Friday before Week 11 at 8:45pm PT"): the
    // Friday of the week before NFL week 11 opens, six days before its start.
    // Same rule as `friday-before-week-11` in league-event-resolver.ts.
    return shiftIsoDate(nflWeekStartIsoDate(year, 11), -6);
  }

  // An unrecognized spec is a registry edit that outran this resolver. Null is
  // the honest answer: a wrong date here silently moves a real deadline.
  return null;
}

/**
 * The deadline that governs `now` for this league.
 *
 * Resolved against the CALENDAR year, not the season year, because that is the
 * question being asked: "which deadline is next / just passed on today's
 * date". Once this year's deadline is behind us the next one is next year's —
 * returning the stale one would leave the run-up window looking permanently
 * closed for the rest of the calendar year, which is correct, but naming next
 * year's date makes that legible to a caller that logs it.
 */
export function upcomingTradeDeadline(slug, now = new Date()) {
  const today = ptDateString(now);
  const year = Number(today.slice(0, 4));
  const thisYear = tradeDeadlineIsoDate(slug, year);
  if (!thisYear) return null;
  return today <= thisYear ? thisYear : tradeDeadlineIsoDate(slug, year + 1);
}

/**
 * The UTC offset (`-08:00` / `-07:00`) Pacific time is on for a PT calendar
 * date at a PT wall-clock time. Tries both offsets and keeps the one whose
 * instant reads back as that wall clock — no hand-kept DST table.
 */
function ptOffsetFor(iso, hhmm) {
  for (const offset of ['-08:00', '-07:00']) {
    const instant = new Date(`${iso}T${hhmm}:00${offset}`);
    const back = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(instant).replace(', ', 'T');
    if (back === `${iso}T${hhmm}`) return offset;
  }
  return '-08:00';
}

/**
 * The exact instant trading closes for `year`, as an ISO string with its PT
 * offset — what the deadline-day countdown counts down to. Uses the
 * registry's `time` (TheLeague: 20:45, MFL's own cutoff); a spec without one
 * closes at midnight PT that ends deadline day. Null when the league has no
 * deadline.
 */
export function tradeDeadlineCutoffISO(slug, year) {
  const date = tradeDeadlineIsoDate(slug, year);
  if (!date) return null;
  const time = LEAGUES[slug]?.tradeDeadline?.time;
  if (time) return `${date}T${time}:00${ptOffsetFor(date, time)}`;
  const next = shiftIsoDate(date, 1);
  return `${next}T00:00:00${ptOffsetFor(next, '00:00')}`;
}

/**
 * The cutoff as owners read it: "8:45 PM PT", or "midnight PT" for a league
 * whose deadline runs to the end of the day.
 */
export function tradeDeadlineTimeLabel(slug) {
  const time = LEAGUES[slug]?.tradeDeadline?.time;
  if (!time) return 'midnight PT';
  const [h, m] = time.split(':').map(Number);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'} PT`;
}

/** Days of run-up before the deadline that count as deadline season. */
export const TRADE_DEADLINE_WINDOW_DAYS = 10;

/**
 * Is `now` inside the deadline run-up — the last `days` days before the
 * deadline, through the end of deadline day itself?
 *
 * Inclusive at BOTH ends. The deadline day is the loudest trading day of the
 * year; ending the window the night before would mute Schefter on the one day
 * the league is actually making moves.
 */
export function isTradeDeadlineWindow(slug, now = new Date(), days = TRADE_DEADLINE_WINDOW_DAYS) {
  const deadline = upcomingTradeDeadline(slug, now);
  if (!deadline) return false;
  const today = ptDateString(now);
  return today >= shiftIsoDate(deadline, -days) && today <= deadline;
}
