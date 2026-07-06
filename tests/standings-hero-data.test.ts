import { describe, it, expect } from 'vitest';
import { rankStandings, getStandingsRanking } from '../src/utils/hero-data/standings-hero-data';

// rankStandings is pure — fixtures anchor the sort + tie-break behavior.
// getStandingsRanking is exercised against a FROZEN historical year (2025)
// whose feed never changes; the current/in-progress year would flip as the
// season advances.

describe('rankStandings', () => {
  it('returns empty array for missing / malformed data', () => {
    expect(rankStandings(null)).toEqual([]);
    expect(rankStandings({})).toEqual([]);
    expect(rankStandings({ leagueStandings: {} })).toEqual([]);
  });

  it('normalizes a single-franchise (object, not array) shape', () => {
    const data = { leagueStandings: { franchise: { id: '0007', h2hw: '3', pf: '400.0' } } };
    expect(rankStandings(data)).toEqual([{ franchiseId: '0007', rank: 1 }]);
  });

  it('ranks by head-to-head wins descending', () => {
    const data = {
      leagueStandings: {
        franchise: [
          { id: '0001', h2hw: '5', pf: '900.0' },
          { id: '0002', h2hw: '9', pf: '850.0' },
          { id: '0003', h2hw: '7', pf: '870.0' },
        ],
      },
    };
    expect(rankStandings(data)).toEqual([
      { franchiseId: '0002', rank: 1 },
      { franchiseId: '0003', rank: 2 },
      { franchiseId: '0001', rank: 3 },
    ]);
  });

  it('breaks a wins tie by points-for (pf) descending', () => {
    const data = {
      leagueStandings: {
        franchise: [
          { id: '0001', h2hw: '8', pf: '1100.5' },
          { id: '0002', h2hw: '8', pf: '1250.7' }, // same wins, more points → higher
          { id: '0003', h2hw: '8', pf: '990.0' },
        ],
      },
    };
    expect(rankStandings(data)).toEqual([
      { franchiseId: '0002', rank: 1 },
      { franchiseId: '0001', rank: 2 },
      { franchiseId: '0003', rank: 3 },
    ]);
  });

  it('breaks a full tie by franchise id (stable order) — offseason reset', () => {
    // All zeros (offseason reset): still returns a deterministic rank order.
    const data = {
      leagueStandings: {
        franchise: [
          { id: '0012', h2hw: '0', pf: '0' },
          { id: '0003', h2hw: '0', pf: '0' },
          { id: '0007', h2hw: '0', pf: '0' },
        ],
      },
    };
    expect(rankStandings(data)).toEqual([
      { franchiseId: '0003', rank: 1 },
      { franchiseId: '0007', rank: 2 },
      { franchiseId: '0012', rank: 3 },
    ]);
  });

  it('handles missing wins/pf fields as zeros', () => {
    const data = {
      leagueStandings: {
        franchise: [
          { id: '0001' },
          { id: '0002', h2hw: '1' },
        ],
      },
    };
    expect(rankStandings(data)).toEqual([
      { franchiseId: '0002', rank: 1 },
      { franchiseId: '0001', rank: 2 },
    ]);
  });

  it('supports the default-wrapped import shape', () => {
    const data = { default: { leagueStandings: { franchise: [{ id: '0005', h2hw: '2', pf: '10' }] } } };
    expect(rankStandings(data)).toEqual([{ franchiseId: '0005', rank: 1 }]);
  });
});

describe('getStandingsRanking', () => {
  it('returns [] for a non-existent year', () => {
    expect(getStandingsRanking(1999)).toEqual([]);
  });

  it('ranks the frozen 2025 season with 0009 (Wabbits) on top', () => {
    // 2025 final standings: 0009 leads at 15 h2h wins, 1998.36 pf.
    const ranking = getStandingsRanking(2025);
    expect(ranking.length).toBe(16);
    expect(ranking[0]).toEqual({ franchiseId: '0009', rank: 1 });
    // Ranks are contiguous 1..N with no duplicates.
    expect(ranking.map((r) => r.rank)).toEqual(
      Array.from({ length: ranking.length }, (_, i) => i + 1),
    );
  });
});
