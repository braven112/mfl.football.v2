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

import { DEFAULT_VIEWER_CLOCK, LEAGUE_CLOCK, zoneOffsetMs, type ViewerClock } from './viewer-preferences';
import { formatForViewer } from './viewer-clock';

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
  /**
   * Whether a claim-processing RUN happens at `changesAt`.
   *
   * `nextMode` is not enough to answer this, because the collapse below folds a
   * simultaneous run-and-re-lock down to its resulting STATE and throws the run
   * away. Both shapes report `nextMode: 'waiver'` and they say opposite things
   * to an owner:
   *
   *   - TheLeague, Wed 2026-09-02 19:00 — `WAIVER_LOCK` + `WAIVER_BBID` at one
   *     instant. Claims DO process then; the pool simply shuts again after. A
   *     hero counting down to it is counting down to a real deadline.
   *   - A bare `WAIVER_LOCK` with no run on it — a pool RE-lock. Nothing
   *     processes, so naming it as a deadline invents one.
   *   - A bare `WAIVER_UNLOCK` — free agency simply opens. It CLOSES the waiver
   *     window (so it is in `PROCESS_TYPES`) but runs no claims, which is why
   *     this reads `RUN_TYPES` and not that set.
   *
   * False whenever there is no next mark at all.
   */
  nextProcesses: boolean;
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

/**
 * The subset of those that actually RUN claims — a strict subset, and the
 * distinction is not pedantic.
 *
 * `WAIVER_UNLOCK` is "free agency opens" (docs/features/mfl-api.md): it ends the
 * waiver window by unlocking the pool, without processing anything. It belongs
 * in `PROCESS_TYPES` because it closes the window — that set answers "what is
 * the pool's state after this" — but treating it as a run would let a bare
 * unlock be worded as "Waivers process <then>" and counted down to, which is a
 * deadline that does not exist. Only `nextProcesses` reads this set.
 *
 * Both leagues' in-season marks are real runs (`WAIVER_REVERSE` for the AFL,
 * `WAIVER_BBID` for TheLeague), so this changes nothing there; the AFL's one
 * `WAIVER_UNLOCK` of 2026 shares its instant with a `WAIVER_REVERSE`, and the
 * collapse ORs the run back in.
 */
const RUN_TYPES = new Set(['WAIVER_BBID', 'WAIVER_REVERSE']);

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * MFL RECURS ON THE WALL CLOCK, NOT ON EPOCH TIME.
 *
 * `HAPPENS=n` means "the same time each week", and MFL means the same time a
 * HUMAN reads, not the same number of seconds. Adding a fixed `7 × 24h` is
 * therefore right for eight months of the year and an hour wrong for the rest:
 * after the November DST change every expanded occurrence lands an hour early.
 *
 * This is not a deduction, it is what MFL did. Its own 2025 transaction log
 * records every waiver run it processed, and the wall-clock hour is constant
 * straight through the 2025-11-02 transition:
 *
 *   AFL        Wed 20:00 PDT  Sep 10 … Oct 29   →  Wed 20:00 PST  Nov 5 … Dec 31
 *   TheLeague  Wed 19:00 PDT  Aug 27 … Oct 22   →  Wed 19:00 PST  Nov 5 … Dec 17
 *
 * 141 AFL awards and 58 TheLeague awards, all on the hour, on both sides of the
 * boundary. Under the old fixed-epoch step the November occurrences came out at
 * 19:00 and 18:00 — which is what made the hero read "claims have processed"
 * for the last hour of a window that was still open, and, worse, could route a
 * live claim through the FCFS endpoint while the pool was still locked.
 *
 * Solved in two passes for the same reason `nextSundayKickoffEpoch` is: the
 * first guess can land on the wrong side of a transition. A weekly waiver run
 * is never scheduled inside the ambiguous 1–2am hour, so the second pass
 * settles it.
 */
function addWeeksOnWallClock(startMs: number, weeks: number, zone: string): number {
  if (weeks === 0) return startMs;
  // The start's wall clock, expressed as if it were UTC. Adding whole weeks to
  // THAT advances the calendar date and leaves the time of day alone, because
  // UTC has no DST of its own.
  const wall = startMs + zoneOffsetMs(startMs, zone) + weeks * SEVEN_DAYS_MS;
  const guess = wall - zoneOffsetMs(wall, zone);
  return wall - zoneOffsetMs(guess, zone);
}

/**
 * Expand a possibly-recurring event into the concrete occurrences that could
 * bracket `now`. `HAPPENS=n` means "same time each week for n more weeks" —
 * same WALL-CLOCK time, per `addWeeksOnWallClock`.
 */
/**
 * Memoised, because the expansion is pure and its cost is `Intl`.
 *
 * `addWeeksOnWallClock` runs two `zoneOffsetMs` lookups per occurrence and each
 * one builds an `Intl.DateTimeFormat` view — cheap once, ruinous in a loop. A
 * caller that asks per minute rather than per render (the sync cadence walks a
 * week of ticks) turned a millisecond into fifteen seconds. Keyed on the fields
 * the expansion actually reads plus the zone.
 *
 * The cached array is handed back by reference, so callers READ it and never
 * mutate it — both call sites here only iterate.
 */
const occurrenceCache = new Map<string, number[]>();

function occurrences(event: MflCalendarEvent, zone: string): number[] {
  const key = `${event.start_time}|${event.happens ?? ''}|${zone}`;
  const hit = occurrenceCache.get(key);
  if (hit) return hit;
  const computed = computeOccurrences(event, zone);
  occurrenceCache.set(key, computed);
  return computed;
}

function computeOccurrences(event: MflCalendarEvent, zone: string): number[] {
  const start = Number(event.start_time) * 1000;
  if (!Number.isFinite(start) || start <= 0) return [];
  const repeats = Math.max(0, Math.min(Number(event.happens) || 0, 30));
  const out: number[] = [];
  for (let i = 0; i <= repeats; i++) out.push(addWeeksOnWallClock(start, i, zone));
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
  now: Date = new Date(),
  /**
   * The zone MFL keeps this league's schedule in — its recurrences repeat on
   * THAT wall clock (see `addWeeksOnWallClock`). Defaults to the registry's
   * fallback league clock, Pacific, which is what every league in the registry
   * is set to today; a caller that knows its league can pass
   * `leagueClock(slug).zone` and stay correct if one ever isn't.
   */
  zone: string = LEAGUE_CLOCK.zone
): WaiverWindow {
  const list = Array.isArray(events) ? events : [];
  if (list.length === 0) {
    return { mode: 'unknown', changesAt: null, nextMode: 'unknown', nextProcesses: false, reason: 'No league calendar available.' };
  }

  const marks: Array<{ at: number; opens: boolean; processes: boolean }> = [];
  for (const event of list) {
    const type = String(event?.type ?? '').toUpperCase();
    const opens = OPEN_TYPES.has(type);
    const closes = PROCESS_TYPES.has(type);
    const runs = RUN_TYPES.has(type);
    if (!opens && !closes) continue;
    for (const at of occurrences(event, zone)) marks.push({ at, opens, processes: runs });
  }

  if (marks.length === 0) {
    return {
      mode: 'unknown',
      changesAt: null,
      nextMode: 'unknown',
      nextProcesses: false,
      reason: 'The league calendar has no waiver open/process events.',
    };
  }

  marks.sort((a, b) => a.at - b.at);

  // A LOCK AND A PROCESS AT THE SAME INSTANT MEAN LOCKED. MFL schedules both on
  // one timestamp when it runs a round and then shuts the pool again — which is
  // exactly what TheLeague's 2026 preseason does:
  //
  //   WAIVER_LOCK  Wed 2026-09-02 19:00
  //   WAIVER_BBID  Wed 2026-09-02 19:00
  //
  // and MFL's own transaction log confirms it acted on both, logging
  // BBID_AUTO_PROCESS_WAIVERS and LOCK_ALL_PLAYERS at that minute. Without this
  // collapse the winner of the tie is decided by the ORDER MFL HAPPENS TO LIST
  // THE EVENTS IN — `Array.prototype.sort` is stable, so equal timestamps keep
  // payload order — and TheLeague's payload put the process last, which read as
  // FCFS for the whole locked week. Owners were shown "First come, first
  // served", their add went to `import?TYPE=fcfsWaiver`, and MFL answered a
  // locked pool with an empty 200 that stores nothing: every pickup 502'd
  // (2026-09-03, Nick Folk).
  //
  // Collapsing is not a tiebreak dressed up — the two events are one moment,
  // and the pool's state at the end of that moment is what the next window is.
  // Locked wins because a lock is a STATE while a run is an EVENT: after both
  // have happened the pool is shut, so the only way in is a claim.
  // `processes` is OR'd alongside `opens` rather than being decided by it: the
  // collapse answers what the pool's STATE is afterwards, and that deliberately
  // loses the fact that a run happened at the same instant. Anything wording a
  // deadline needs the run back — see `nextProcesses`.
  const collapsed: Array<{ at: number; opens: boolean; processes: boolean }> = [];
  for (const mark of marks) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.at === mark.at) {
      last.opens = last.opens || mark.opens;
      last.processes = last.processes || mark.processes;
    } else collapsed.push({ ...mark });
  }

  const t = now.getTime();
  // The most recent transition at or before now decides the current mode.
  const past = collapsed.filter((m) => m.at <= t);
  const next = collapsed.find((m) => m.at > t) ?? null;

  if (past.length === 0) {
    // Every transition is in the future — the season has not reached the first
    // one yet, so the mode is whatever precedes it.
    const first = collapsed[0];
    return {
      mode: first.opens ? 'fcfs' : 'waiver',
      changesAt: new Date(first.at),
      nextMode: first.opens ? 'waiver' : 'fcfs',
      nextProcesses: first.processes,
      reason: 'Before the first waiver event on the calendar.',
    };
  }

  const last = past[past.length - 1];
  const mode: WaiverMode = last.opens ? 'waiver' : 'fcfs';
  return {
    mode,
    changesAt: next ? new Date(next.at) : null,
    nextMode: next ? (next.opens ? 'waiver' : 'fcfs') : 'unknown',
    nextProcesses: next ? next.processes : false,
    reason: last.opens
      ? 'Waivers are open — claims are queued until they process.'
      : 'Waivers have processed — adds are first-come, first-served.',
  };
}

/**
 * The most recent instant at which claims actually PROCESSED, at or before
 * `now` — or null if none has yet.
 *
 * Exists so the sync cadence can ask "did waivers just run?" without growing a
 * second copy of the recurrence expansion. That expansion is not incidental:
 * `HAPPENS=n` repeats on MFL's WALL CLOCK, so a naive `+7 days` in epoch
 * milliseconds lands an hour early for every occurrence after the November DST
 * change (see `addWeeksOnWallClock`). One implementation, reused.
 *
 * Reads `RUN_TYPES`, not `PROCESS_TYPES`, for the reason `nextProcesses`
 * documents: a bare `WAIVER_UNLOCK` closes the waiver window without running
 * any claims, so treating it as a run would name a roster-churn moment that
 * never happens.
 */
export function lastWaiverRunAtOrBefore(
  events: MflCalendarEvent[] | null | undefined,
  now: Date = new Date(),
  zone: string = LEAGUE_CLOCK.zone
): Date | null {
  const list = Array.isArray(events) ? events : [];
  const t = now.getTime();
  let best: number | null = null;
  for (const event of list) {
    if (!RUN_TYPES.has(String(event?.type ?? '').toUpperCase())) continue;
    for (const at of occurrences(event, zone)) {
      if (at <= t && (best === null || at > best)) best = at;
    }
  }
  return best === null ? null : new Date(best);
}

/**
 * One-line summary for the page, e.g. "Waivers open · claims process Wed 8:00 PM PT".
 *
 * The deadline is a LEAGUE event, so it prints on the league's clock — and, for
 * a viewer who has told us where they are, on theirs in front of it: an owner
 * in Sydney reading "Wed 8:00 PM PT" has to work out for themselves that their
 * claims land Thursday lunchtime. Until they choose, PT alone, exactly as
 * before — see `eventZonesFor`.
 */
/**
 * Compact label for space-constrained UI (a mobile hero badge) — the full
 * sentence from `describeWaiverWindow` is still what a viewer needs, so pair
 * this with a tap-to-reveal disclosure rather than dropping the detail.
 */
export function waiverWindowShortLabel(win: WaiverWindow): string {
  if (win.mode === 'waiver') return 'Waivers open';
  if (win.mode === 'fcfs') return 'Open now';
  return 'Unknown';
}

export function describeWaiverWindow(win: WaiverWindow, clock: ViewerClock = DEFAULT_VIEWER_CLOCK): string {
  const when = win.changesAt ? formatForViewer(win.changesAt, clock, { weekday: true }) : null;
  if (win.mode === 'waiver') {
    return when ? `Waivers open · claims process ${when}` : 'Waivers open — claims are queued.';
  }
  if (win.mode === 'fcfs') {
    return when ? `First come, first served · waivers reopen ${when}` : 'First come, first served.';
  }
  return 'Waiver window unknown — MFL will decide when you submit.';
}
