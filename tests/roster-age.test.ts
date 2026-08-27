import { describe, it, expect } from 'vitest';
import {
  calculateAge,
  calculateAverageAge,
  calculateAverageAgeByPosition,
  getAgeDistribution,
  getAgeDistributionColors,
} from '../src/scripts/rosters/roster-age';

/**
 * The originals read `new Date()` directly, so none of this could be tested
 * without freezing the system clock. "Today" is a parameter now.
 */
const TODAY = new Date('2026-08-27T12:00:00Z');

/** MFL birthdates are UNIX SECONDS, not milliseconds. */
const secs = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

describe('calculateAge', () => {
  it('computes whole years from a unix-seconds birthdate', () => {
    expect(calculateAge(secs('1996-01-07T00:00:00Z'), TODAY)).toBe(30);
  });

  it('does not count a birthday that has not happened yet this year', () => {
    expect(calculateAge(secs('1996-12-31T00:00:00Z'), TODAY)).toBe(29);
  });

  it('counts a birthday earlier in the same month', () => {
    expect(calculateAge(secs('1996-08-01T00:00:00Z'), TODAY)).toBe(30);
  });

  it('does not count a birthday later in the same month', () => {
    expect(calculateAge(secs('1996-08-31T00:00:00Z'), TODAY)).toBe(29);
  });

  it('returns null rather than 0 for a missing birthdate', () => {
    // 0 would silently drag every average down toward newborn.
    expect(calculateAge(null, TODAY)).toBeNull();
    expect(calculateAge(undefined, TODAY)).toBeNull();
    expect(calculateAge(0, TODAY)).toBeNull();
  });
});

describe('calculateAverageAge', () => {
  it('averages to one decimal place', () => {
    const players = [
      { birthdate: secs('1996-01-01T00:00:00Z') }, // 30
      { birthdate: secs('1999-01-01T00:00:00Z') }, // 27
    ];
    expect(calculateAverageAge(players, TODAY)).toBe(28.5);
  });

  it('ignores players with no birthdate', () => {
    const players = [{ birthdate: secs('1996-01-01T00:00:00Z') }, { birthdate: null }];
    expect(calculateAverageAge(players, TODAY)).toBe(30);
  });

  it('returns null when nobody has a birthdate', () => {
    expect(calculateAverageAge([{ birthdate: null }], TODAY)).toBeNull();
    expect(calculateAverageAge([], TODAY)).toBeNull();
  });
});

describe('calculateAverageAgeByPosition', () => {
  it('groups by position with a headcount', () => {
    const players = [
      { position: 'QB', birthdate: secs('1996-01-01T00:00:00Z') }, // 30
      { position: 'QB', birthdate: secs('2000-01-01T00:00:00Z') }, // 26
      { position: 'RB', birthdate: secs('2002-01-01T00:00:00Z') }, // 24
    ];
    const out = calculateAverageAgeByPosition(players, TODAY);
    expect(out.get('QB')).toEqual({ avgAge: 28, count: 2 });
    expect(out.get('RB')).toEqual({ avgAge: 24, count: 1 });
  });

  it('normalizes position case and buckets missing positions under UNK', () => {
    const players = [
      { position: 'qb', birthdate: secs('1996-01-01T00:00:00Z') },
      { birthdate: secs('1996-01-01T00:00:00Z') },
    ];
    const out = calculateAverageAgeByPosition(players, TODAY);
    expect(out.has('QB')).toBe(true);
    expect(out.has('UNK')).toBe(true);
  });

  it('omits a position whose players all lack birthdates', () => {
    const out = calculateAverageAgeByPosition([{ position: 'QB', birthdate: null }], TODAY);
    expect(out.size).toBe(0);
  });
});

describe('getAgeDistribution', () => {
  it('buckets ages ascending with whole-number percentages', () => {
    const players = [
      { birthdate: secs('2004-01-01T00:00:00Z') }, // 22 -> 20-24
      { birthdate: secs('2003-01-01T00:00:00Z') }, // 23 -> 20-24
      { birthdate: secs('1999-01-01T00:00:00Z') }, // 27 -> 25-29
      { birthdate: secs('1992-01-01T00:00:00Z') }, // 34 -> 30-34
    ];
    expect(getAgeDistribution(players, 5, TODAY)).toEqual([
      { range: '20-24', count: 2, percentage: 50 },
      { range: '25-29', count: 1, percentage: 25 },
      { range: '30-34', count: 1, percentage: 25 },
    ]);
  });

  it('honors a custom bucket size', () => {
    const players = [
      { birthdate: secs('2004-01-01T00:00:00Z') }, // 22
      { birthdate: secs('2003-01-01T00:00:00Z') }, // 23
    ];
    const out = getAgeDistribution(players, 2, TODAY);
    expect(out.map((b) => b.range)).toEqual(['22-23']);
  });

  it('returns an empty array rather than a zero bucket when nobody has an age', () => {
    expect(getAgeDistribution([{ birthdate: null }], 5, TODAY)).toEqual([]);
    expect(getAgeDistribution([], 5, TODAY)).toEqual([]);
  });
});

describe('getAgeDistributionColors', () => {
  it('runs green to red for a normal bucket count', () => {
    expect(getAgeDistributionColors(1)).toEqual(['#22c55e']);
    expect(getAgeDistributionColors(5)).toHaveLength(5);
  });

  it('cycles rather than running out', () => {
    const out = getAgeDistributionColors(7);
    expect(out).toHaveLength(7);
    expect(out[5]).toBe(out[0]);
    expect(out[6]).toBe(out[1]);
  });

  it('handles zero', () => {
    expect(getAgeDistributionColors(0)).toEqual([]);
  });
});
