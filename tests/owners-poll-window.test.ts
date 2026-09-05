/**
 * Ballot window timing (src/utils/owners-poll-window.mjs).
 *
 * Two things this suite exists for:
 *
 *  - **DST.** The poll runs across the November change every season, and a
 *    fixed -8/-7 offset moves the deadline by an hour without anyone noticing
 *    until a ballot closes early.
 *  - **The kickoff clamp.** The scheduled close is Thursday afternoon, which
 *    is comfortably before Thursday night football — but Thanksgiving week
 *    opens around 10:00 PT, so an unclamped ballot would take votes after two
 *    games had been played.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveOwnersPollWindow,
  ptWallTimeToInstant,
  ptCalendarParts,
  windowHours,
  CLOSE_WEEKDAY_PT,
  KICKOFF_BUFFER_MINUTES,
  SHORT_WINDOW_HOURS,
} from '../src/utils/owners-poll-window.mjs';

const pt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', ...opts }).format(
    new Date(iso),
  );
const ptHour = (iso: string) => pt(iso, { hour: 'numeric', hour12: false });
const ptWeekday = (iso: string) => pt(iso, { weekday: 'short' });

/** A normal Tuesday 07:00 PT column slot. */
const TUESDAY = '2026-09-08T14:00:00Z';

describe('resolveOwnersPollWindow', () => {
  it('closes Thursday at the configured Pacific hour', () => {
    const w = resolveOwnersPollWindow({ publishedAt: TUESDAY, closeHourPT: 16 });
    expect(ptWeekday(w.closesAt)).toBe('Thu');
    expect(ptHour(w.closesAt)).toBe('16');
    expect(w.clampedToKickoff).toBe(false);
  });

  it('gives owners the full lineup-setting stretch, not one evening', () => {
    // The whole reason the deadline moved: a Wednesday close ended before the
    // weekly action that actually brings owners to the site.
    const w = resolveOwnersPollWindow({ publishedAt: TUESDAY, closeHourPT: 16 });
    expect(windowHours(w)).toBe(57);
    expect(windowHours(w)).toBeGreaterThan(SHORT_WINDOW_HOURS);
  });

  it('lands on the same PACIFIC hour on both sides of the DST change', () => {
    const pdt = resolveOwnersPollWindow({ publishedAt: TUESDAY, closeHourPT: 16 });
    const pst = resolveOwnersPollWindow({ publishedAt: '2026-11-10T15:00:00Z', closeHourPT: 16 });

    expect(ptHour(pdt.closesAt)).toBe('16');
    expect(ptHour(pst.closesAt)).toBe('16');
    // Same wall-clock hour, DIFFERENT UTC instants — the point of the exercise.
    expect(pdt.closesAt.slice(11, 16)).toBe('23:00');
    expect(pst.closesAt.slice(11, 16)).toBe('00:00');
    expect(windowHours(pdt)).toBe(windowHours(pst));
  });

  it('honours a different close weekday and hour', () => {
    const w = resolveOwnersPollWindow({
      publishedAt: TUESDAY,
      closeHourPT: 18,
      closeWeekday: 3,
    });
    expect(ptWeekday(w.closesAt)).toBe('Wed');
    expect(ptHour(w.closesAt)).toBe('18');
  });

  it('never produces a window that is already closed', () => {
    // Published ON the close weekday, after the hour: roll forward rather than
    // hand back a zero-length window.
    const w = resolveOwnersPollWindow({
      publishedAt: '2026-09-11T04:00:00Z', // Thu 21:00 PT
      closeHourPT: 16,
    });
    expect(Date.parse(w.closesAt)).toBeGreaterThan(Date.parse(w.opensAt));
    expect(ptWeekday(w.closesAt)).toBe('Thu');
  });

  it('opens exactly when the column published', () => {
    const publishedAt = '2026-09-08T14:03:27.412Z';
    expect(resolveOwnersPollWindow({ publishedAt, closeHourPT: 16 }).opensAt).toBe(publishedAt);
  });

  it('rejects junk rather than inventing a window', () => {
    expect(() => resolveOwnersPollWindow({ publishedAt: 'nope', closeHourPT: 16 })).toThrow();
    expect(() => resolveOwnersPollWindow({ publishedAt: Date.now(), closeHourPT: 24 })).toThrow();
    expect(() => resolveOwnersPollWindow({ publishedAt: Date.now(), closeHourPT: -1 })).toThrow();
  });

  it('defaults to Thursday', () => {
    expect(CLOSE_WEEKDAY_PT).toBe(4);
  });
});

describe('kickoff clamp', () => {
  it('leaves a normal week alone — TNF is after the scheduled hour', () => {
    // Thu 17:20 PT kickoff vs a 16:00 PT close: nothing to pull back.
    const w = resolveOwnersPollWindow({
      publishedAt: TUESDAY,
      closeHourPT: 16,
      firstKickoff: '2026-09-11T00:20:00Z',
    });
    expect(w.clampedToKickoff).toBe(false);
    expect(ptHour(w.closesAt)).toBe('16');
  });

  it('pulls the close back on a Thanksgiving-style early kickoff', () => {
    // Games at 10:00 PT Thursday. An unclamped 16:00 close would take votes
    // from owners who had already watched two of them.
    const kickoff = '2026-11-26T18:00:00Z';
    const w = resolveOwnersPollWindow({
      publishedAt: '2026-11-24T15:00:00Z',
      closeHourPT: 16,
      firstKickoff: kickoff,
    });
    expect(w.clampedToKickoff).toBe(true);
    expect(Date.parse(w.closesAt)).toBe(Date.parse(kickoff) - KICKOFF_BUFFER_MINUTES * 60000);
    expect(Date.parse(w.closesAt)).toBeLessThan(Date.parse(kickoff));
  });

  it('never lets a bad kickoff produce an already-closed ballot', () => {
    // A feed describing the WRONG week can report a kickoff before the column
    // published. Ignore it rather than closing the ballot on open.
    const w = resolveOwnersPollWindow({
      publishedAt: TUESDAY,
      closeHourPT: 16,
      firstKickoff: '2026-09-01T00:00:00Z',
    });
    expect(w.clampedToKickoff).toBe(false);
    expect(Date.parse(w.closesAt)).toBeGreaterThan(Date.parse(w.opensAt));
  });

  it('ignores a missing or unparseable kickoff', () => {
    for (const firstKickoff of [null, undefined, 'not-a-date', NaN]) {
      const w = resolveOwnersPollWindow({ publishedAt: TUESDAY, closeHourPT: 16, firstKickoff });
      expect(w.clampedToKickoff).toBe(false);
      expect(ptHour(w.closesAt)).toBe('16');
    }
  });

  it('keeps a buffer so voting never overlaps the first snap', () => {
    expect(KICKOFF_BUFFER_MINUTES).toBeGreaterThan(0);
  });
});

describe('ptWallTimeToInstant', () => {
  it('round-trips a Pacific wall time through UTC in both DST regimes', () => {
    const summer = ptWallTimeToInstant(2026, 9, 10, 16);
    const winter = ptWallTimeToInstant(2026, 12, 10, 16);
    expect(ptHour(new Date(summer).toISOString())).toBe('16');
    expect(ptHour(new Date(winter).toISOString())).toBe('16');
    expect(new Date(summer).toISOString().slice(11, 13)).toBe('23');
    expect(new Date(winter).toISOString().slice(11, 13)).toBe('00');
  });

  it('handles the day rolling over the month boundary', () => {
    const parts = ptCalendarParts(ptWallTimeToInstant(2026, 9, 33, 16));
    expect(parts.month).toBe(10);
    expect(parts.day).toBe(3);
  });
});

describe('ptCalendarParts', () => {
  it('reports the Pacific date, not the UTC one', () => {
    // 2026-09-09T05:00Z is still Tuesday the 8th, 22:00, in Pacific.
    expect(ptCalendarParts('2026-09-09T05:00:00Z')).toMatchObject({
      year: 2026,
      month: 9,
      day: 8,
      weekday: 2,
    });
  });
});
