import { describe, it, expect } from 'vitest';
import {
  parseProjectionMap,
  selectTradeBlockStars,
  getTradeBlockStars,
} from '../src/utils/hero-data/trade-block-data';

// parseProjectionMap + selectTradeBlockStars are pure — fixtures anchor the
// join/sort behavior. getTradeBlockStars is exercised against the FROZEN 2026
// feed on disk (populated trade-bait), plus a non-existent year for the
// missing-feed fallback.

describe('parseProjectionMap', () => {
  it('returns an empty map for missing / malformed data', () => {
    expect(parseProjectionMap(null).size).toBe(0);
    expect(parseProjectionMap({}).size).toBe(0);
    expect(parseProjectionMap({ projectedScores: {} }).size).toBe(0);
  });

  it('normalizes a single-object (not array) playerScore', () => {
    const data = { projectedScores: { playerScore: { id: '13593', score: '32.40' } } };
    const map = parseProjectionMap(data);
    expect(map.get('13593')).toBe(32.4);
  });

  it('maps every score and coerces non-numeric scores to 0', () => {
    const data = {
      projectedScores: {
        playerScore: [
          { id: '100', score: '20.5' },
          { id: '200', score: 'N/A' },
          { id: '300' },
        ],
      },
    };
    const map = parseProjectionMap(data);
    expect(map.get('100')).toBe(20.5);
    expect(map.get('200')).toBe(0);
    expect(map.get('300')).toBe(0);
  });
});

describe('selectTradeBlockStars', () => {
  it('returns [] for missing / malformed trade-bait data', () => {
    expect(selectTradeBlockStars(null, null)).toEqual([]);
    expect(selectTradeBlockStars({}, {})).toEqual([]);
    expect(selectTradeBlockStars({ franchises: null }, {})).toEqual([]);
  });

  it('flattens all franchises and sorts by projected score DESC', () => {
    const tradeBait = {
      franchises: {
        '0001': { playerIds: ['100', '200'] },
        '0003': { playerIds: ['300'] },
      },
    };
    const projections = {
      projectedScores: {
        playerScore: [
          { id: '100', score: '10.0' },
          { id: '200', score: '25.0' },
          { id: '300', score: '18.0' },
        ],
      },
    };
    expect(selectTradeBlockStars(tradeBait, projections)).toEqual([
      { playerId: '200', franchiseId: '0001', score: 25 },
      { playerId: '300', franchiseId: '0003', score: 18 },
      { playerId: '100', franchiseId: '0001', score: 10 },
    ]);
  });

  it('scores unprojected players 0 and keeps them at the bottom', () => {
    const tradeBait = { franchises: { '0002': { playerIds: ['900', '800'] } } };
    const projections = { projectedScores: { playerScore: [{ id: '800', score: '5.0' }] } };
    expect(selectTradeBlockStars(tradeBait, projections)).toEqual([
      { playerId: '800', franchiseId: '0002', score: 5 },
      { playerId: '900', franchiseId: '0002', score: 0 },
    ]);
  });

  it('breaks a score tie by player id ascending (stable order)', () => {
    const tradeBait = { franchises: { '0005': { playerIds: ['777', '333'] } } };
    const projections = {
      projectedScores: {
        playerScore: [
          { id: '777', score: '12.0' },
          { id: '333', score: '12.0' },
        ],
      },
    };
    expect(selectTradeBlockStars(tradeBait, projections).map((s) => s.playerId)).toEqual([
      '333',
      '777',
    ]);
  });

  it('coerces numeric player ids to strings and handles empty playerIds', () => {
    const tradeBait = {
      franchises: {
        '0001': { playerIds: [100] },
        '0004': { playerIds: [] },
        '0008': {},
      },
    };
    const projections = { projectedScores: { playerScore: [{ id: '100', score: '9.0' }] } };
    expect(selectTradeBlockStars(tradeBait, projections)).toEqual([
      { playerId: '100', franchiseId: '0001', score: 9 },
    ]);
  });
});

describe('getTradeBlockStars', () => {
  it('returns [] for a non-existent year (missing feed → fallback)', () => {
    expect(getTradeBlockStars(1999)).toEqual([]);
  });

  it('reads the populated 2026 feed and returns a score-sorted block', () => {
    const stars = getTradeBlockStars(2026);
    expect(stars.length).toBeGreaterThan(0);
    // Sorted by projected score DESC.
    for (let i = 1; i < stars.length; i++) {
      expect(stars[i - 1].score).toBeGreaterThanOrEqual(stars[i].score);
    }
    // The top star carries a real franchise + a positive projection.
    expect(stars[0].franchiseId).toMatch(/^\d{4}$/);
    expect(stars[0].score).toBeGreaterThan(0);
  });
});
