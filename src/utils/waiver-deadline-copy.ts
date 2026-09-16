/**
 * The words a hero puts on the waiver deadline — derived from MFL's calendar,
 * never from a hardcoded day.
 *
 * WHY THIS EXISTS. The daily hero rotation puts both leagues in the
 * `waiver-wire` slot from TUESDAY 2pm PT through WEDNESDAY 8pm PT
 * (`getDailySlot`), but the copy inside that slot was a fixed string:
 * "CLAIMS RUN TONIGHT · Waivers process Wednesday at 8PM PT". For the ten
 * hours of Tuesday afternoon and evening that is a lie — claims run TOMORROW
 * night — and an owner who read it and went to bed missed the window.
 *
 * Three things here are load-bearing:
 *
 * - **The day comes from the CALENDAR, not the constitution.** The AFL's own
 *   rules doc says so in as many words: the processing time documented in
 *   prose is not the source of truth. MFL's synced calendar has the AFL's
 *   `WAIVER_REVERSE` recurring Wednesday 8:00 PM PT — and a one-off on
 *   TUESDAY, Dec 29 2026, which any hardcoded "Wednesday" gets wrong. It also
 *   has TheLeague processing at 7:00 PM, not 8:00. One resolver
 *   (`resolveWaiverWindow`) already reads that feed for `/players`; this is
 *   the same read, worded for a hero.
 *
 * - **"Tonight" is judged on a CLOCK, and the clock is the viewer's leading
 *   zone — PT until they choose otherwise, never UTC.** Deriving the day from
 *   a bare `Date` method reads the SERVER's zone, which on Vercel is UTC,
 *   where Tuesday 6:19 PM PT is already Wednesday. That is the exact shape of
 *   the bug being fixed, so it must not come back through the fix.
 *
 * - **Unknown stays unknown.** A missing or unreadable calendar returns copy
 *   that names no day at all rather than guessing one. The calendar export is
 *   owner-gated, so an empty read is a real possibility in production.
 */

import { formatForViewer } from './viewer-clock';
import { eventZonesFor, DEFAULT_VIEWER_CLOCK, type ViewerClock } from './viewer-preferences';
import type { WaiverWindow } from './waiver-window';

export interface WaiverDeadlineCopy {
  /** Claims process (or waivers reopen) at this moment, per MFL's calendar. */
  at: Date | null;
  /**
   * The window the calendar reports, passed through UNCOLLAPSED.
   *
   * Callers must branch on this, never on `!open`, because there are THREE
   * states and only two of them have a presentation. `open` answers "are
   * claims being queued", so it is false for `fcfs` AND for `unknown` — and a
   * hero that read `!open` as "waivers have cleared" rendered the headline
   * "CLAIMS HAVE SOON." over a summary that said the opposite, the moment the
   * calendar could not be read. Only `fcfs` means cleared.
   */
  mode: WaiverWindow['mode'];
  /** True while claims are being queued; false once they have processed OR when the calendar is unreadable. */
  open: boolean;
  /**
   * The relative word for the accent slot: `TONIGHT`, `TODAY`, `TOMORROW`,
   * or a weekday (`WEDNESDAY`). Uppercase — every caller shouts it.
   */
  word: string;
  /** "Wed 8:00 PM PT", or "Thu 1:00 PM AEST · Wed 8:00 PM PT" from Sydney. */
  line: string;
  /** The hero's headline accent, with its full stop: `TONIGHT.` */
  accentWord: string;
  /** The hero's summary sentence. */
  summary: string;
  /** The countdown block's label, e.g. "Process at Wed 8:00 PM PT". */
  countLabel: string;
  /** The countdown block's value — the relative word, or a short status. */
  countValue: string;
}

/** Hour (in the leading zone) at or after which "today" becomes "tonight". */
const EVENING_HOUR = 17;

/**
 * Calendar-day and hour of `at` in `zone` — via `Intl`, because every other
 * way of asking a `Date` what day it is answers in the server's zone.
 */
function dayInZone(at: Date, zone: string): { key: string; hour: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  // `hour12: false` renders midnight as 24 in some ICU versions; normalize.
  const hour = parseInt(get('hour'), 10) % 24;
  return {
    key: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number.isFinite(hour) ? hour : 0,
    weekday: get('weekday'),
  };
}

/** Whole calendar days from `from` to `to`, counted in `zone`. */
function dayGap(from: Date, to: Date, zone: string): number {
  const a = dayInZone(from, zone);
  const b = dayInZone(to, zone);
  if (a.key === b.key) return 0;
  // Compare as UTC midnights of the two ZONE-LOCAL dates — the keys are
  // already zone-correct, so this is date arithmetic, not a zone conversion.
  const ms = Date.parse(`${b.key}T00:00:00Z`) - Date.parse(`${a.key}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * The relative word for a moment, judged on the viewer's leading zone.
 *
 * Same day resolves to TONIGHT once the deadline is in the evening and TODAY
 * before it — a 9am run is not "tonight" — and anything past tomorrow names
 * its weekday rather than counting days at the reader.
 */
export function relativeDayWord(now: Date, at: Date, zone: string): string {
  const gap = dayGap(now, at, zone);
  if (gap <= 0) return dayInZone(at, zone).hour >= EVENING_HOUR ? 'TONIGHT' : 'TODAY';
  if (gap === 1) return 'TOMORROW';
  return dayInZone(at, zone).weekday.toUpperCase();
}

/**
 * Hero copy for the waiver slot.
 *
 * `window` is whatever `resolveWaiverWindow` made of the league's calendar;
 * `fcfsThrough` names what happens after the run ("Sunday kickoff" in both
 * leagues today) and is the one piece of league prose left, because no
 * calendar event states it.
 */
export function waiverDeadlineCopy(
  window: WaiverWindow,
  {
    now = new Date(),
    clock = DEFAULT_VIEWER_CLOCK,
    fcfsThrough = 'Sunday kickoff',
  }: { now?: Date; clock?: ViewerClock; fcfsThrough?: string } = {},
): WaiverDeadlineCopy {
  const [lead] = eventZonesFor(clock);
  const at = window.changesAt;
  const open = window.mode === 'waiver';

  // No calendar, or no transition ahead of us: say what is true without
  // naming a day. "Before the deadline" is always true; "Wednesday" is not.
  if (!at || window.mode === 'unknown') {
    return {
      at: null,
      mode: window.mode,
      open,
      word: 'SOON',
      line: '',
      accentWord: 'SOON.',
      summary: open
        ? `Claims are queued now and process together at the league deadline. After that, free agents go first-come, first-served through ${fcfsThrough}.`
        : `Free agents are first-come, first-served — the next claim window opens before ${fcfsThrough}.`,
      countLabel: 'Claims process at the league deadline',
      countValue: 'SOON',
    };
  }

  const line = formatForViewer(at, clock, { weekday: true });
  const word = relativeDayWord(now, at, lead.zone);

  if (!open) {
    // Waivers have already run — the slot still has an hour of Wednesday left
    // in TheLeague, whose deadline is 7pm against a slot that ends at 8pm.
    return {
      at,
      mode: window.mode,
      open,
      word,
      line,
      accentWord: 'PROCESSED.',
      summary: `Claims are in. Free agents are first-come, first-served through ${fcfsThrough} — the next claim window opens ${line}.`,
      countLabel: `Waivers reopen ${line}`,
      countValue: 'OPEN NOW',
    };
  }

  return {
    at,
    mode: window.mode,
    open,
    word,
    line,
    accentWord: `${word}.`,
    summary: `Waivers process ${line}. After that, free agents go first-come, first-served through ${fcfsThrough}.`,
    countLabel: `Process at ${line}`,
    countValue: word,
  };
}
