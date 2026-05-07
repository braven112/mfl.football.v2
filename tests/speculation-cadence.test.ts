import { describe, it, expect } from 'vitest';
// @ts-expect-error — sibling .mjs module, no .d.ts
import { resolveCadence, permitsPost, calendarDaysUntil, CADENCE_LADDER } from '../scripts/lib/speculation-cadence.mjs';

const events = [
  { id: 'tagging-period', startDate: '2026-02-01T00:00:00.000Z' },
  { id: 'tag-matching-period', startDate: '2026-03-01T00:00:00.000Z' },
  { id: 'offseason-fa-opens', startDate: '2026-03-19T00:00:00.000Z' },
  { id: 'nfl-draft', startDate: '2026-04-23T00:00:00.000Z' },
  { id: 'rookie-draft', startDate: '2026-05-02T00:00:00.000Z' },
  { id: 'nfl-season-starts', startDate: '2026-09-10T00:00:00.000Z' },
  { id: 'trading-deadline', startDate: '2026-11-13T00:00:00.000Z' },
  { id: 'league-championship', startDate: '2026-12-31T00:00:00.000Z' },
];

describe('resolveCadence — calendar-aware quota', () => {
  it('peaks at 2/day in the 7-day window before the trade deadline', () => {
    // Nov 10, 2026 = 3 days before Nov 13 deadline
    const cadence = resolveCadence({ events, now: new Date('2026-11-10T18:00:00Z') });
    expect(cadence.tag).toBe('trade-deadline-peak-week');
    expect(cadence.maxPerDay).toBe(2);
    expect(cadence.reservesGlobalSlot).toBe(true);
  });

  it('drops to 1/day in the 8–21 day ramp before the deadline', () => {
    // Oct 28 = 16 days before Nov 13
    const cadence = resolveCadence({ events, now: new Date('2026-10-28T18:00:00Z') });
    expect(cadence.tag).toBe('trade-deadline-ramp');
    expect(cadence.maxPerDay).toBe(1);
  });

  it('hits NFL Draft window in the days leading up to the draft', () => {
    const cadence = resolveCadence({ events, now: new Date('2026-04-20T18:00:00Z') });
    expect(cadence.tag).toBe('nfl-draft-window');
    expect(cadence.maxPerDay).toBe(1);
  });

  it('lands on quiet-offseason fallback when nothing else matches (mid-July)', () => {
    const cadence = resolveCadence({ events, now: new Date('2026-07-15T18:00:00Z') });
    expect(cadence.tag).toBe('quiet-offseason-default');
    expect(cadence.maxPerDay).toBeCloseTo(1 / 14, 5);
  });

  it('returns 0/day after the trade deadline through the championship', () => {
    const cadence = resolveCadence({ events, now: new Date('2026-11-25T18:00:00Z') });
    expect(cadence.tag).toBe('post-deadline-regular-season');
    expect(cadence.maxPerDay).toBe(0);
  });

  it('uses regular-season default in early October (>22d before deadline)', () => {
    // Oct 1 is 43 days before Nov 13 — still inside the in-season but pre-ramp window
    const cadence = resolveCadence({ events, now: new Date('2026-10-01T18:00:00Z') });
    expect(cadence.tag).toBe('regular-season-default');
    expect(cadence.maxPerDay).toBeCloseTo(1 / 5, 5);
  });

  it('returns NO rule (0 quota) when no events are available', () => {
    // Empty event list: only the fallback rule matches → quiet offseason
    const cadence = resolveCadence({ events: [], now: new Date('2026-06-15T12:00:00Z') });
    expect(cadence.tag).toBe('quiet-offseason-default');
  });
});

describe('permitsPost — fractional vs integer cadence', () => {
  it('allows a post when integer lane cap not yet met', () => {
    const cadence = { tag: 'foo', maxPerDay: 2, reservesGlobalSlot: false };
    expect(permitsPost({ cadence, postsTodayInLane: 1, lastPostAt: null })).toEqual({ allowed: true });
  });

  it('blocks when integer lane cap already met', () => {
    const cadence = { tag: 'foo', maxPerDay: 2, reservesGlobalSlot: false };
    const result = permitsPost({ cadence, postsTodayInLane: 2, lastPostAt: null });
    expect(result.allowed).toBe(false);
  });

  it('allows fractional cadence when never posted before', () => {
    const cadence = { tag: 'quiet', maxPerDay: 1 / 3, reservesGlobalSlot: false };
    expect(permitsPost({ cadence, postsTodayInLane: 0, lastPostAt: null })).toEqual({ allowed: true });
  });

  it('blocks fractional cadence (1 per 3 days) when last post was yesterday', () => {
    const cadence = { tag: 'quiet', maxPerDay: 1 / 3, reservesGlobalSlot: false };
    const now = new Date('2026-06-10T12:00:00Z');
    const yesterday = new Date('2026-06-09T12:00:00Z');
    const result = permitsPost({ cadence, postsTodayInLane: 0, lastPostAt: yesterday, now });
    expect(result.allowed).toBe(false);
  });

  it('allows fractional cadence (1 per 2 days) after the required gap has elapsed', () => {
    const cadence = { tag: 'rs', maxPerDay: 0.5, reservesGlobalSlot: false };
    const now = new Date('2026-10-05T12:00:00Z');
    const twoDaysAgo = new Date('2026-10-03T12:00:00Z');
    const result = permitsPost({ cadence, postsTodayInLane: 0, lastPostAt: twoDaysAgo, now });
    expect(result.allowed).toBe(true);
  });

  it('blocks 1-per-5-day regular-season cadence at 3 days since last post', () => {
    const cadence = { tag: 'rs', maxPerDay: 1 / 5, reservesGlobalSlot: false };
    const now = new Date('2026-10-05T12:00:00Z');
    const threeDaysAgo = new Date('2026-10-02T12:00:00Z');
    const result = permitsPost({ cadence, postsTodayInLane: 0, lastPostAt: threeDaysAgo, now });
    expect(result.allowed).toBe(false);
  });

  it('allows 1-per-5-day regular-season cadence after 4 days have elapsed', () => {
    const cadence = { tag: 'rs', maxPerDay: 1 / 5, reservesGlobalSlot: false };
    const now = new Date('2026-10-05T12:00:00Z');
    const fourDaysAgo = new Date('2026-10-01T12:00:00Z');
    const result = permitsPost({ cadence, postsTodayInLane: 0, lastPostAt: fourDaysAgo, now });
    expect(result.allowed).toBe(true);
  });

  it('blocks 1-per-14-day quiet-offseason cadence after just 1 week', () => {
    const cadence = { tag: 'quiet', maxPerDay: 1 / 14, reservesGlobalSlot: false };
    const now = new Date('2026-07-15T12:00:00Z');
    const sevenDaysAgo = new Date('2026-07-08T12:00:00Z');
    const result = permitsPost({ cadence, postsTodayInLane: 0, lastPostAt: sevenDaysAgo, now });
    expect(result.allowed).toBe(false);
  });
});

describe('calendarDaysUntil — PT calendar diff', () => {
  it('returns 0 for same PT calendar day (both at PT noon)', () => {
    // 19:00 UTC = 12:00 PT in May
    expect(calendarDaysUntil('2026-05-07T19:00:00Z', new Date('2026-05-07T19:00:00Z'))).toBe(0);
  });

  it('returns positive for future, negative for past', () => {
    expect(calendarDaysUntil('2026-05-10T19:00:00Z', new Date('2026-05-07T19:00:00Z'))).toBe(3);
    expect(calendarDaysUntil('2026-05-03T19:00:00Z', new Date('2026-05-07T19:00:00Z'))).toBe(-4);
  });
});

describe('CADENCE_LADDER — sanity', () => {
  it('ends with a fallback rule', () => {
    expect(CADENCE_LADDER[CADENCE_LADDER.length - 1].fallback).toBe(true);
  });

  it('reserves a slot only on peak-deadline week', () => {
    const reservers = CADENCE_LADDER.filter((r: { reservesGlobalSlot: boolean }) => r.reservesGlobalSlot);
    expect(reservers.map((r: { id: string }) => r.id)).toEqual(['trade-deadline-peak-week']);
  });
});
