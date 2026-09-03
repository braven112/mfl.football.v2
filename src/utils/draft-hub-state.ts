/**
 * What the draft hub says at the top of the page.
 *
 * Derived from two things the league already publishes — MFL's calendar
 * (a `DRAFT_START` event) and the draft board itself — rather than from a
 * hand-maintained date, so it cannot drift out of sync with the draft it
 * describes.
 *
 * The board is the authority on whether a draft has HAPPENED, and the calendar
 * only on when the next one begins. That split matters: MFL stubs every pick
 * slot before a draft is conducted, so counting slots would report a completed
 * draft the moment the board is created. Only a pick with a real player id
 * counts as made.
 */

/** MFL calendar rows, as the feed writes them. */
export interface RawCalendarEvent {
  type?: string;
  start_time?: string;
  title?: string;
}

export type DraftHubStatus =
  | { kind: 'scheduled'; year: number; startsAt: Date; daysAway: number }
  | { kind: 'live'; year: number; made: number; slots: number }
  | { kind: 'complete'; year: number; made: number }
  | { kind: 'unknown' };

const DAY_MS = 86_400_000;

/** The next DRAFT_START at or after `now`, or null. */
export function nextDraftStart(events: RawCalendarEvent[], now: Date): Date | null {
  const upcoming = events
    .filter((e) => (e.type || '').toUpperCase() === 'DRAFT_START')
    .map((e) => parseInt(e.start_time || '', 10))
    .filter((secs) => Number.isFinite(secs) && secs > 0)
    .map((secs) => new Date(secs * 1000))
    .filter((d) => d.getTime() >= now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  return upcoming[0] ?? null;
}

export interface DraftHubStatusInput {
  now: Date;
  /** Season the board belongs to. */
  year: number;
  /** Pick slots on the board (filled or not). */
  slots: number;
  /** Slots with a real selection recorded. */
  made: number;
  /** Next scheduled draft, when the calendar has one. */
  startsAt: Date | null;
}

export function resolveDraftHubStatus(input: DraftHubStatusInput): DraftHubStatus {
  const { now, year, slots, made, startsAt } = input;

  // A draft in progress outranks a schedule: if picks are landing, the fact
  // that the calendar still lists a start time is not the interesting part.
  if (made > 0 && made < slots) return { kind: 'live', year, made, slots };

  if (startsAt && startsAt.getTime() > now.getTime()) {
    return {
      kind: 'scheduled',
      year,
      startsAt,
      // Ceil, so a draft later today reads "1 day away" rather than "0".
      daysAway: Math.ceil((startsAt.getTime() - now.getTime()) / DAY_MS),
    };
  }

  if (slots > 0 && made === slots) return { kind: 'complete', year, made };

  return { kind: 'unknown' };
}
