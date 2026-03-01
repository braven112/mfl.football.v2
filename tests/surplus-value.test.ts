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

  it('gives highest multiplier to rank 1', () => {
    const cost = estimateAuctionCost(
      { id: 'p1', position: 'QB' },
      { ...baseSignals, customRank: 1 },
    );
    // avgPricePerPlayer = 100M / 100 = 1M; multiplier = 10
    // estimated = 10M, capped at top3Average * 1.2 = 9.6M
    expect(cost).toBe(9_600_000);
  });

  it('applies mid-range multiplier for rank 50', () => {
    const cost = estimateAuctionCost(
      { id: 'p1', position: 'RB' },
      { ...baseSignals, customRank: 50 },
    );
    // multiplier = 2.0 - ((50-30)/70) * 1.0 = 2.0 - 0.286 ≈ 1.714
    // estimated = 1M * 1.714 ≈ 1,714,285 → rounded to nearest 50K
    expect(cost).toBeGreaterThan(1_500_000);
    expect(cost).toBeLessThan(2_000_000);
    expect(cost % 50_000).toBe(0);
  });

  it('gives floor multiplier to rank 300', () => {
    const cost = estimateAuctionCost(
      { id: 'p1', position: 'WR' },
      { ...baseSignals, customRank: 300 },
    );
    // multiplier = max(0.5, 1.0 - ((300-100)/200)*0.5) = max(0.5, 1.0 - 0.5) = 0.5
    // estimated = 1M * 0.5 = 500K
    expect(cost).toBe(500_000);
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

  it('never exceeds position top3Average * 1.2', () => {
    const cost = estimateAuctionCost(
      { id: 'p1', position: 'QB' },
      {
        ...baseSignals,
        customRank: 1,
        positionSalaryAvg: { top3Average: 5_000_000, top5Average: 4_000_000 },
      },
    );
    expect(cost).toBeLessThanOrEqual(5_000_000 * 1.2);
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

  it('defaults to rank 999 with no signals', () => {
    const cost = estimateAuctionCost(
      { id: 'p1', position: 'QB' },
      { ...baseSignals },
    );
    // rank 999 → multiplier = max(0.5, 1.0 - ((999-100)/200)*0.5) = 0.5
    expect(cost).toBe(500_000);
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
    projectedScores: [
      { id: 'qb1', score: '300' },
      { id: 'rb1', score: '200' },
      { id: 'wr1', score: '180' },
      { id: 'te1', score: '150' },
    ],
    players: [
      { id: 'qb1', name: 'Star QB', position: 'QB', team: 'BUF' },
      { id: 'rb1', name: 'Good RB', position: 'RB', team: 'NYG' },
      { id: 'wr1', name: 'Solid WR', position: 'WR', team: 'CIN' },
      { id: 'te1', name: 'Decent TE', position: 'TE', team: 'KC' },
    ],
    rosters: [
      {
        id: '0001',
        player: [
          { id: 'qb1', salary: '5000000', contractYear: '3', status: 'ROSTER' },
          { id: 'rb1', salary: '3000000', contractYear: '2', status: 'ROSTER' },
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

  it('handles player with no rank signals', () => {
    const results = calculateAllSurplusValues(mockInput);
    const te = results.find((r) => r.playerId === 'te1')!;
    expect(te.rank).toBe(null);
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
});
