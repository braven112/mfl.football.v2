import { describe, expect, it } from 'vitest';
import {
  matchupTier,
  ordinal,
  pointsTier,
  seasonAverage,
} from '../src/utils/season-results-cells';

describe('matchupTier', () => {
  it('reads rank 1 as the easiest matchup and 32 as the toughest', () => {
    expect(matchupTier(1)).toBe('easy');
    expect(matchupTier(8)).toBe('easy');
    expect(matchupTier(9)).toBe('mid');
    expect(matchupTier(24)).toBe('mid');
    expect(matchupTier(25)).toBe('hard');
    expect(matchupTier(32)).toBe('hard');
  });

  it('says nothing without a rank', () => {
    expect(matchupTier(null)).toBeNull();
    expect(matchupTier(undefined)).toBeNull();
    expect(matchupTier(0)).toBeNull();
    expect(matchupTier(Number.NaN)).toBeNull();
  });
});

describe('ordinal', () => {
  it('handles the teens and the 1/2/3 endings', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31, 32].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st', '32nd',
    ]);
  });
});

describe('seasonAverage', () => {
  it('averages only the weeks with a score — a real 0 counts, an unplayed week does not', () => {
    expect(seasonAverage([10, null, 0, undefined, 20])).toBe(10);
    expect(seasonAverage([null, null])).toBeNull();
  });
});

describe('pointsTier', () => {
  it('shades against his own average with a 25% band', () => {
    // average 20 → band 5
    expect(pointsTier(25, 20, 6)).toBe('better');
    expect(pointsTier(24.9, 20, 6)).toBe('typical');
    expect(pointsTier(15.1, 20, 6)).toBe('typical');
    expect(pointsTier(15, 20, 6)).toBe('worse');
  });

  it('never flags a low scorer for a one-point swing (3-point floor)', () => {
    // average 4 → 25% is 1, floor lifts the band to 3
    expect(pointsTier(5, 4, 6)).toBe('typical');
    expect(pointsTier(7, 4, 6)).toBe('better');
    expect(pointsTier(1, 4, 6)).toBe('worse');
  });

  it('says nothing for an unplayed week or a one-game season', () => {
    expect(pointsTier(null, 10, 6)).toBeNull();
    expect(pointsTier(12, null, 6)).toBeNull();
    expect(pointsTier(12, 12, 1)).toBeNull();
  });
});
