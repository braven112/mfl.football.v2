import { describe, it, expect } from 'vitest';
import {
  calculatePointsPerDollar,
  pointsToDollarValue,
  estimateAuctionCost,
  calculateSurplusValue,
  calculateAllSurplusValues,
} from '../src/utils/surplus-value';
import type { SurplusValueInput } from '../src/types/surplus-value';

describe('calculatePointsPerDollar', () => {
  it('returns correct ratio with realistic league data', () => {
    const projectedScores = new Map([
      ['p1', 300],
      ['p2', 200],
      ['p3', 150],
    ]);
    const rosteredPlayers = new Map([
      ['p1', { salary: 5_000_000, position: 'QB' }],
      ['p2', { salary: 3_000_000, position: 'RB' }],
      ['p3', { salary: 2_000_000, position: 'WR' }],
    ]);

    const ratio = calculatePointsPerDollar(projectedScores, rosteredPlayers);
    // (300 + 200 + 150) / (5M + 3M + 2M) = 650 / 10,000,000
    expect(ratio).toBeCloseTo(0.000065, 6);
  });

  it('returns 0 when no rostered players have salary', () => {
    const projectedScores = new Map([['p1', 300]]);
    const rosteredPlayers = new Map([
      ['p1', { salary: 0, position: 'QB' }],
    ]);
    expect(calculatePointsPerDollar(projectedScores, rosteredPlayers)).toBe(0);
  });

  it('skips players with 0 projected points', () => {
    const projectedScores = new Map([
      ['p1', 300],
      ['p2', 0],
    ]);
    const rosteredPlayers = new Map([
      ['p1', { salary: 3_000_000, position: 'QB' }],
      ['p2', { salary: 1_000_000, position: 'RB' }],
    ]);
    const ratio = calculatePointsPerDollar(projectedScores, rosteredPlayers);
    // Only p1: 300 / 3,000,000
    expect(ratio).toBeCloseTo(0.0001, 6);
  });

  it('returns 0 for empty inputs', () => {
    expect(calculatePointsPerDollar(new Map(), new Map())).toBe(0);
  });
});

describe('pointsToDollarValue', () => {
  it('converts points to dollar value', () => {
    // 300 pts / 0.000065 ≈ $4,615,384
    const value = pointsToDollarValue(300, 0.000065);
    expect(value).toBe(Math.round(300 / 0.000065));
  });

  it('returns 0 for 0 points', () => {
    expect(pointsToDollarValue(0, 0.000065)).toBe(0);
  });

  it('returns 0 when pointsPerDollar is 0', () => {
    expect(pointsToDollarValue(300, 0)).toBe(0);
  });

  it('returns 0 when pointsPerDollar is negative', () => {
    expect(pointsToDollarValue(300, -1)).toBe(0);
  });
});

describe('estimateAuctionCost', () => {
  const baseSignals = {
    positionSalaryAvg: { top3Average: 8_000_000, top5Average: 6_000_000 },
    totalAvailableCap: 100_000_000,
    totalFreeAgents: 100,
  };

  it('anchors rank 1 near franchise benchmark levels', () => {
    const cost = estimateAuctionCost(
      { id: 'p1', position: 'QB' },
      { ...baseSignals, customRank: 1 },
    );
    expect(cost).toBeGreaterThanOrEqual(6_800_000);
    expect(cost).toBeLessThanOrEqual(10_400_000);
  });

  it('decays meaningfully for mid-range rank 50', () => {
    const cost = estimateAuctionCost(
      { id: 'p1', position: 'RB' },
      { ...baseSignals, customRank: 50 },
    );
    expect(cost).toBeGreaterThanOrEqual(600_000);
    expect(cost).toBeLessThan(3_000_000);
    expect(cost % 50_000).toBe(0);
  });

  it('approaches the floor for deep rank 300', () => {
    const cost = estimateAuctionCost(
      { id: 'p1', position: 'WR' },
      { ...baseSignals, customRank: 300 },
    );
    expect(cost).toBeGreaterThanOrEqual(425_000);
    expect(cost).toBeLessThanOrEqual(1_000_000);
  });

  it('never goes below league minimum ($425K)', () => {
    const cost = estimateAuctionCost(
      { id: 'p1', position: 'PK' },
      {
        ...baseSignals,
        customRank: 999,
        totalAvailableCap: 1_000_000,
        totalFreeAgents: 100,
      },
    );
    expect(cost).toBeGreaterThanOrEqual(425_000);
  });

  it('never exceeds dynamic top-tier ceiling', () => {
    const cost = estimateAuctionCost(
      { id: 'p1', position: 'QB' },
      {
        ...baseSignals,
        customRank: 1,
        positionSalaryAvg: { top3Average: 5_000_000, top5Average: 4_000_000 },
      },
    );
    expect(cost).toBeLessThanOrEqual(5_000_000 * 1.3);
  });

  it('uses ADP as fallback when no custom rank', () => {
    const withCustom = estimateAuctionCost(
      { id: 'p1', position: 'QB' },
      { ...baseSignals, customRank: 5 },
    );
    const withAdp = estimateAuctionCost(
      { id: 'p1', position: 'QB' },
      { ...baseSignals, adpDynasty: 5 },
    );
    expect(withCustom).toBe(withAdp);
  });

  it('defaults to low-tier pricing when no rank signals exist', () => {
    const cost = estimateAuctionCost(
      { id: 'p1', position: 'QB' },
      { ...baseSignals },
    );
    expect(cost).toBeGreaterThanOrEqual(425_000);
    expect(cost).toBeLessThanOrEqual(650_000);
  });

  it('uses position-rank tiers to keep top players higher', () => {
    const elite = estimateAuctionCost(
      { id: 'p1', position: 'WR' },
      { ...baseSignals, customRank: 40, positionRank: 1 },
    );
    const depth = estimateAuctionCost(
      { id: 'p1', position: 'WR' },
      { ...baseSignals, customRank: 40, positionRank: 20 },
    );
    expect(elite).toBeGreaterThan(depth);
  });

  it('pulls median-ranked players toward median salary benchmarks', () => {
    const withoutMedianAnchor = estimateAuctionCost(
      { id: 'p1', position: 'WR' },
      {
        ...baseSignals,
        customRank: 70,
        positionRank: 50,
        positionPlayerCount: 100,
      },
    );
    const withMedianAnchor = estimateAuctionCost(
      { id: 'p1', position: 'WR' },
      {
        ...baseSignals,
        customRank: 70,
        positionRank: 50,
        positionPlayerCount: 100,
        positionSalaryAvg: {
          ...baseSignals.positionSalaryAvg,
          medianSalary: 700_000,
        },
      },
    );

    expect(withMedianAnchor).toBeLessThan(withoutMedianAnchor);
    expect(withMedianAnchor).toBeGreaterThanOrEqual(500_000);
    expect(withMedianAnchor).toBeLessThanOrEqual(1_200_000);
  });

  it('rounds to nearest $50K', () => {
    const cost = estimateAuctionCost(
      { id: 'p1', position: 'RB' },
      { ...baseSignals, customRank: 25 },
    );
    expect(cost % 50_000).toBe(0);
  });
});

describe('calculateSurplusValue', () => {
  it('positive when value exceeds cost (bargain)', () => {
    expect(calculateSurplusValue(5_000_000, 3_000_000)).toBe(2_000_000);
  });

  it('negative when cost exceeds value (overpay)', () => {
    expect(calculateSurplusValue(2_000_000, 5_000_000)).toBe(-3_000_000);
  });

  it('zero when value equals cost', () => {
    expect(calculateSurplusValue(3_000_000, 3_000_000)).toBe(0);
  });
});

describe('calculateAllSurplusValues', () => {
  const mockInput: SurplusValueInput = {
    leagueYear: 2026,
    projectedScores: [
      { id: 'qb1', score: '300' },
      { id: 'rb1', score: '200' },
      { id: 'wr1', score: '180' },
      { id: 'te1', score: '150' },
    ],
    players: [
      { id: 'qb1', name: 'Star QB', position: 'QB', team: 'BUF', draftYear: 2021 },
      { id: 'rb1', name: 'Good RB', position: 'RB', team: 'NYG', draftYear: 2025 },
      { id: 'wr1', name: 'Solid WR', position: 'WR', team: 'CIN', draftYear: 2020 },
      { id: 'te1', name: 'Decent TE', position: 'TE', team: 'KC', draftYear: 2024 },
    ],
    rosters: [
      {
        id: '0001',
        player: [
          { id: 'qb1', salary: '5000000', contractYear: '3', status: 'ROSTER' },
          { id: 'rb1', salary: '850000', contractYear: '2', status: 'ROSTER' },
        ],
      },
      {
        id: '0002',
        player: [
          { id: 'wr1', salary: '4000000', contractYear: '1', status: 'ROSTER' },
        ],
      },
    ],
    salaryAverages: {
      positions: {
        QB: { top3Average: 8_000_000, top5Average: 6_000_000 },
        RB: { top3Average: 5_000_000, top5Average: 4_000_000 },
        WR: { top3Average: 6_000_000, top5Average: 5_000_000 },
        TE: { top3Average: 4_000_000, top5Average: 3_000_000 },
      },
    },
    customRankings: new Map([
      ['qb1', 3],
      ['rb1', 15],
      ['wr1', 8],
    ]),
  };

  it('returns results for all players with projections', () => {
    const results = calculateAllSurplusValues(mockInput);
    expect(results).toHaveLength(4);
  });

  it('identifies rostered vs free agent players', () => {
    const results = calculateAllSurplusValues(mockInput);
    const qb = results.find((r) => r.playerId === 'qb1')!;
    const te = results.find((r) => r.playerId === 'te1')!;
    expect(qb.isRostered).toBe(true);
    expect(qb.currentSalary).toBe(5_000_000);
    expect(qb.contractYears).toBe(3);
    expect(te.isRostered).toBe(false);
    expect(te.currentSalary).toBe(null);
  });

  it('uses market comparable est cost except for rookie deals', () => {
    const results = calculateAllSurplusValues(mockInput);
    const qb = results.find((r) => r.playerId === 'qb1')!;
    const rb = results.find((r) => r.playerId === 'rb1')!;
    const te = results.find((r) => r.playerId === 'te1')!;
    expect(qb.estimatedCost).not.toBe(5_000_000);
    expect(rb.estimatedCost).toBe(850_000);
    expect(te.estimatedCost).toBeGreaterThanOrEqual(425_000);
  });

  it('calculates dollar value based on points-per-dollar ratio', () => {
    const results = calculateAllSurplusValues(mockInput);
    const qb = results.find((r) => r.playerId === 'qb1')!;
    expect(qb.projectedPoints).toBe(300);
    expect(qb.dollarValue).toBeGreaterThan(0);
  });

  it('uses custom rank when available', () => {
    const results = calculateAllSurplusValues(mockInput);
    const qb = results.find((r) => r.playerId === 'qb1')!;
    expect(qb.rank).toBe(3);
  });

  it('uses ADP as fallback when no custom rank', () => {
    const inputWithAdp: SurplusValueInput = {
      ...mockInput,
      customRankings: undefined,
      adpDynasty: new Map([['qb1', 5]]),
    };
    const results = calculateAllSurplusValues(inputWithAdp);
    const qb = results.find((r) => r.playerId === 'qb1')!;
    expect(qb.rank).toBe(5);
  });

  it('uses projected-rank fallback when no custom/ADP rank signals exist', () => {
    const results = calculateAllSurplusValues(mockInput);
    const te = results.find((r) => r.playerId === 'te1')!;
    expect(te.rank).toBe(4);
  });

  it('handles player with 0 projected points', () => {
    const input: SurplusValueInput = {
      ...mockInput,
      projectedScores: [{ id: 'qb1', score: '0' }],
    };
    const results = calculateAllSurplusValues(input);
    // score <= 0 filtered out
    expect(results).toHaveLength(0);
  });

  it('handles empty roster input', () => {
    const input: SurplusValueInput = {
      ...mockInput,
      rosters: [],
    };
    const results = calculateAllSurplusValues(input);
    // All players become free agents, still get results
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => !r.isRostered)).toBe(true);
  });

  it('calculates surplus percent correctly', () => {
    const results = calculateAllSurplusValues(mockInput);
    for (const r of results) {
      if (r.estimatedCost > 0) {
        expect(r.surplusPercent).toBeCloseTo(r.surplusValue / r.estimatedCost, 5);
      }
    }
  });

  it('falls back to projected-points rank when custom/ADP ranks are missing', () => {
    const projectedScores = Array.from({ length: 200 }, (_, i) => ({
      id: `p${i + 1}`,
      score: String(400 - i),
    }));
    const players = Array.from({ length: 200 }, (_, i) => ({
      id: `p${i + 1}`,
      name: `Player ${i + 1}`,
      position: 'WR',
      team: 'BUF',
      draftYear: 2020,
    }));
    const input: SurplusValueInput = {
      leagueYear: 2026,
      projectedScores,
      players,
      rosters: [],
      salaryAverages: {
        positions: {
          WR: { top3Average: 100_000_000, top5Average: 80_000_000 },
        },
      },
    };

    const results = calculateAllSurplusValues(input);
    const top = results.find((r) => r.playerId === 'p1')!;
    const bottom = results.find((r) => r.playerId === 'p200')!;

    expect(top.rank).toBe(1);
    expect(bottom.rank).toBe(200);
    expect(top.estimatedCost).toBeGreaterThan(bottom.estimatedCost);
  });

  it('keeps top 3-5 positional values near benchmark bands', () => {
    const players = Array.from({ length: 8 }, (_, i) => ({
      id: `wr${i + 1}`,
      name: `WR ${i + 1}`,
      position: 'WR',
      team: 'BUF',
      draftYear: 2020,
    }));
    const projectedScores = Array.from({ length: 8 }, (_, i) => ({
      id: `wr${i + 1}`,
      score: String(220 - i * 5),
    }));
    const input: SurplusValueInput = {
      leagueYear: 2026,
      players,
      projectedScores,
      rosters: [],
      salaryAverages: {
        positions: {
          WR: { top3Average: 9_000_000, top5Average: 7_000_000 },
        },
      },
    };

    const results = calculateAllSurplusValues(input)
      .sort((a, b) => (b.projectedPoints - a.projectedPoints));

    expect(results[0].estimatedCost).toBeGreaterThanOrEqual(7_500_000);
    expect(results[4].estimatedCost).toBeGreaterThanOrEqual(5_900_000);
  });

  it('anchors median rank near median salary when benchmark is present', () => {
    const players = Array.from({ length: 101 }, (_, i) => ({
      id: `wr${i + 1}`,
      name: `WR ${i + 1}`,
      position: 'WR',
      team: 'BUF',
      draftYear: 2020,
    }));
    const projectedScores = Array.from({ length: 101 }, (_, i) => ({
      id: `wr${i + 1}`,
      score: String(400 - i),
    }));
    const input: SurplusValueInput = {
      leagueYear: 2026,
      players,
      projectedScores,
      rosters: [],
      salaryAverages: {
        positions: {
          WR: {
            top3Average: 9_000_000,
            top5Average: 7_000_000,
            medianSalary: 700_000,
          },
        },
      },
    };

    const results = calculateAllSurplusValues(input);
    const top = results.find((r) => r.playerId === 'wr1')!;
    const medianRanked = results.find((r) => r.playerId === 'wr51')!;

    expect(top.estimatedCost).toBeGreaterThanOrEqual(7_500_000);
    expect(medianRanked.rank).toBe(51);
    expect(medianRanked.estimatedCost).toBeGreaterThanOrEqual(500_000);
    expect(medianRanked.estimatedCost).toBeLessThanOrEqual(1_200_000);
  });
});
