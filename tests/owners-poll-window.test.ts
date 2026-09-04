/**
 * Ballot window timing (src/utils/owners-poll-window.mjs).
 *
 * The DST cases are the point of this suite: the poll runs across the November
 * change every season, and a fixed -8/-7 offset moves the deadline by an hour
 * without anyone noticing until a ballot closes early.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveOwnersPollWindow,
  ptWallTimeToInstant,
  ptCalendarParts,
  windowHours,
  CLOSE_WEEKDAY_PT,
  SHORT_WINDOW_HOURS,
} from '../src/utils/owners-poll-window.mjs';

/** What time is it in Pacific, for a UTC instant? */
const ptHour = (iso: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    hour12: false,
  }).format(new Date(iso));

const ptWeekday = (iso: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
  }).format(new Date(iso));

describe('resolveOwnersPollWindow', () => {
  it('closes Wednesday at the configured Pacific hour', () => {
    // Tuesday 2026-09-08, 07:00 PT (PDT) — the normal column slot.
    const w = resolveOwnersPollWindow({
      publishedAt: '2026-09-08T14:00:00Z',
      closeHourPT: 18,
    });
    expect(ptWeekday(w.closesAt)).toBe('Wed');
    expect(ptHour(w.closesAt)).toBe('18');
  });

  it('lands on the same PACIFIC hour on both sides of the DST change', () => {
    // September is PDT (UTC-7); November 10 is after the change, so PST (UTC-8).
    const pdt = resolveOwnersPollWindow({ publishedAt: '2026-09-08T14:00:00Z', closeHourPT: 18 });
    const pst = resolveOwnersPollWindow({ publishedAt: '2026-11-10T15:00:00Z', closeHourPT: 18 });

    expect(ptHour(pdt.closesAt)).toBe('18');
    expect(ptHour(pst.closesAt)).toBe('18');
    // Same wall-clock hour, DIFFERENT UTC instants — which is the whole point.
    expect(pdt.closesAt.slice(11, 16)).toBe('01:00');
    expect(pst.closesAt.slice(11, 16)).toBe('02:00');
  });

  it('gives the intended ~35-hour window in both DST regimes', () => {
    const pdt = resolveOwnersPollWindow({ publishedAt: '2026-09-08T14:00:00Z', closeHourPT: 18 });
    const pst = resolveOwnersPollWindow({ publishedAt: '2026-11-10T15:00:00Z', closeHourPT: 18 });
    expect(windowHours(pdt)).toBe(35);
    expect(windowHours(pst)).toBe(35);
    expect(windowHours(pdt)).toBeGreaterThan(SHORT_WINDOW_HOURS);
  });

  it('never produces a window that is already closed', () => {
    // Published ON the close weekday, AFTER the close hour: must roll forward,
    // not hand back a negative or zero-length window.
    const w = resolveOwnersPollWindow({
      publishedAt: '2026-09-10T04:00:00Z', // Wed 21:00 PT
      closeHourPT: 18,
    });
    expect(Date.parse(w.closesAt)).toBeGreaterThan(Date.parse(w.opensAt));
    expect(ptWeekday(w.closesAt)).toBe('Wed');
    expect(windowHours(w)).toBeGreaterThan(24 * 6);
  });

  it('opens exactly when the column published', () => {
    const publishedAt = '2026-09-08T14:03:27.412Z';
    expect(resolveOwnersPollWindow({ publishedAt, closeHourPT: 18 }).opensAt).toBe(publishedAt);
  });

  it('honours a different close hour', () => {
    const w = resolveOwnersPollWindow({ publishedAt: '2026-09-08T14:00:00Z', closeHourPT: 21 });
    expect(ptHour(w.closesAt)).toBe('21');
  });

  it('rejects junk rather than inventing a window', () => {
    expect(() => resolveOwnersPollWindow({ publishedAt: 'nope', closeHourPT: 18 })).toThrow();
    expect(() => resolveOwnersPollWindow({ publishedAt: Date.now(), closeHourPT: 24 })).toThrow();
    expect(() => resolveOwnersPollWindow({ publishedAt: Date.now(), closeHourPT: -1 })).toThrow();
  });

  it('uses Wednesday as the close weekday', () => {
    expect(CLOSE_WEEKDAY_PT).toBe(3);
  });
});

describe('ptWallTimeToInstant', () => {
  it('round-trips a Pacific wall time through UTC in both DST regimes', () => {
    const summer = ptWallTimeToInstant(2026, 9, 8, 18);
    const winter = ptWallTimeToInstant(2026, 12, 8, 18);
    expect(ptHour(new Date(summer).toISOString())).toBe('18');
    expect(ptHour(new Date(winter).toISOString())).toBe('18');
    // PDT is UTC-7, PST is UTC-8 — so the same wall hour is an hour apart.
    expect(new Date(summer).toISOString().slice(11, 13)).toBe('01');
    expect(new Date(winter).toISOString().slice(11, 13)).toBe('02');
  });

  it('handles the day rolling over the month boundary', () => {
    // day = 33 in September should normalize into October.
    const parts = ptCalendarParts(ptWallTimeToInstant(2026, 9, 33, 18));
    expect(parts.month).toBe(10);
    expect(parts.day).toBe(3);
  });
});

describe('ptCalendarParts', () => {
  it('reports the Pacific date, not the UTC one', () => {
    // 2026-09-09T05:00Z is still Tuesday the 8th, 22:00, in Pacific.
    const parts = ptCalendarParts('2026-09-09T05:00:00Z');
    expect(parts).toMatchObject({ year: 2026, month: 9, day: 8, weekday: 2 });
  });
});
