/**
 * Which waiver window is open right now, derived from MFL's own league calendar.
 *
 * BOTH leagues run two alternating modes in season:
 *   WAIVER — claims are queued and processed together at the deadline
 *            (TheLeague bids blind; the AFL uses rolling priority)
 *   FCFS   — first-come-first-served: the add happens immediately
 * They need DIFFERENT MFL import types, so submitting in the wrong mode either
 * bounces or queues a claim that never processes.
 *
 * WHY THE CALENDAR AND NOT A COMPUTED SCHEDULE: `currentWaiverType` on the
 * league export is the league's SYSTEM (BBID_FCFS / WAIVERS_FCFS), not the
 * current state — nothing else in the API says which mode is live. The
 * constitution documents the schedule in prose, but re-deriving it here would
 * be a second clock that drifts the moment a date moves in MFL. The calendar is
 * what MFL itself acts on, so it is the only thing that cannot disagree.
 *
 * The calendar export is OWNER-GATED: unauthenticated reads return
 * `API requires logged in user in league ID <id>`, which for a while looked
 * like an empty calendar. It is synced by scripts/fetch-mfl-feeds.mjs with
 * credentials.
 */

/** One MFL calendar event, as the export returns it. */
export interface MflCalendarEvent {
  type?: string;
  start_time?: string | number;
  end_time?: string | number;
  /** Weekly recurrence count — one entry can cover the whole season. */
  happens?: string | number;
  title?: string;
  [key: string]: unknown;
}

export type WaiverMode = 'waiver' | 'fcfs' | 'unknown';

export interface WaiverWindow {
  mode: WaiverMode;
  /** When the current mode ends, if the calendar says. */
  changesAt: Date | null;
  /** The mode that begins at `changesAt`. */
  nextMode: WaiverMode;
  /** Why we concluded this — surfaced in the UI when the answer is `unknown`. */
  reason: string;
}

/**
 * WHICH EVENT MEANS WHAT — and it is the opposite of how it reads.
 *
 * `WAIVER_LOCK` / `WAIVER_UNLOCK` name the state of the FREE AGENT POOL, not
 * the state of the claim window. Locking the pool is exactly what OPENS
 * waivers: nobody can grab a player outright any more, so the only way to get
 * one is to file a claim. Unlocking it is what ends them.
 *
 * This file originally had both of these backwards, which made the resolver
 * answer FCFS during a live waiver window — and, because the AFL's only
 * `WAIVER_UNLOCK` all season is a single event on 2026-09-07, it could never
 * have reported a waiver window again after that date.
 *
 * Proven against the AFL's own 2025 transaction log, where the calendar's
 * recurring events line up to the minute with what MFL actually did:
 *   WAIVER_LOCK    Mon 6:00 PM  →  `LOCK_ALL_PLAYERS`         Mon 6:00 PM
 *   WAIVER_REVERSE Wed 8:00 PM  →  `AUTO_PROCESS_WAIVERS`     Wed 8:00 PM
 *                                  + the `WAIVER` awards themselves
 * and where FREE_AGENT adds collapse on Mon/Tue (5-11 a season) versus 100+
 * on Wed-Sun — the pool being shut is visible in the data.
 */
/** Events that OPEN the waiver window: the pool locks, so claims are the only way in. */
const OPEN_TYPES = new Set(['WAIVER_LOCK']);
/** Events that CLOSE it: claims process and/or the pool unlocks, so adds are FCFS again. */
const PROCESS_TYPES = new Set(['WAIVER_BBID', 'WAIVER_REVERSE', 'WAIVER_UNLOCK']);

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Expand a possibly-recurring event into the concrete occurrences that could
 * bracket `now`. `HAPPENS=n` means "same time each week for n more weeks".
 */
function occurrences(event: MflCalendarEvent): number[] {
  const start = Number(event.start_time) * 1000;
  if (!Number.isFinite(start) || start <= 0) return [];
  const repeats = Math.max(0, Math.min(Number(event.happens) || 0, 30));
  const out: number[] = [];
  for (let i = 0; i <= repeats; i++) out.push(start + i * SEVEN_DAYS_MS);
  return out;
}

/**
 * Resolve the active window.
 *
 * Returns `unknown` rather than guessing when the calendar carries no waiver
 * events — a wrong confident answer sends the owner's claim through the wrong
 * endpoint, whereas `unknown` lets the UI offer both and let MFL adjudicate.
 */
export function resolveWaiverWindow(
  events: MflCalendarEvent[] | null | undefined,
  now: Date = new Date()
): WaiverWindow {
  const list = Array.isArray(events) ? events : [];
  if (list.length === 0) {
    return { mode: 'unknown', changesAt: null, nextMode: 'unknown', reason: 'No league calendar available.' };
  }

  const marks: Array<{ at: number; opens: boolean }> = [];
  for (const event of list) {
    const type = String(event?.type ?? '').toUpperCase();
    const opens = OPEN_TYPES.has(type);
    const closes = PROCESS_TYPES.has(type);
    if (!opens && !closes) continue;
    for (const at of occurrences(event)) marks.push({ at, opens });
  }

  if (marks.length === 0) {
    return {
      mode: 'unknown',
      changesAt: null,
      nextMode: 'unknown',
      reason: 'The league calendar has no waiver open/process events.',
    };
  }

  marks.sort((a, b) => a.at - b.at);
  const t = now.getTime();
  // The most recent transition at or before now decides the current mode.
  const past = marks.filter((m) => m.at <= t);
  const next = marks.find((m) => m.at > t) ?? null;

  if (past.length === 0) {
    // Every transition is in the future — the season has not reached the first
    // one yet, so the mode is whatever precedes it.
    const first = marks[0];
    return {
      mode: first.opens ? 'fcfs' : 'waiver',
      changesAt: new Date(first.at),
      nextMode: first.opens ? 'waiver' : 'fcfs',
      reason: 'Before the first waiver event on the calendar.',
    };
  }

  const last = past[past.length - 1];
  const mode: WaiverMode = last.opens ? 'waiver' : 'fcfs';
  return {
    mode,
    changesAt: next ? new Date(next.at) : null,
    nextMode: next ? (next.opens ? 'waiver' : 'fcfs') : 'unknown',
    reason: last.opens
      ? 'Waivers are open — claims are queued until they process.'
      : 'Waivers have processed — adds are first-come, first-served.',
  };
}

/** One-line summary for the page, e.g. "Waivers open · claims process Wed 8:00 PM". */
export function describeWaiverWindow(win: WaiverWindow, timeZone = 'America/Los_Angeles'): string {
  const when = win.changesAt
    ? new Intl.DateTimeFormat('en-US', {
        weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone, timeZoneName: 'short',
      }).format(win.changesAt)
    : null;
  if (win.mode === 'waiver') {
    return when ? `Waivers open · claims process ${when}` : 'Waivers open — claims are queued.';
  }
  if (win.mode === 'fcfs') {
    return when ? `First come, first served · waivers reopen ${when}` : 'First come, first served.';
  }
  return 'Waiver window unknown — MFL will decide when you submit.';
}
