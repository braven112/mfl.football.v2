import { describe, it, expect } from 'vitest';
import {
  calculatePointsPerDollar,
  pointsToDollarValue,
  estimateAuctionCost,
  calculateSurplusValue,
  calculateAllSurplusValues,
} from '../src/utils/surplus-value';
import type { SurplusValueInput } from '../src/types/surplus-value';

// ── calculatePointsPerDollar ───────────────────────────────────────────

describe('calculatePointsPerDollar', () => {
  it('returns a sensible ratio with realistic league data', () => {
    // ~3,500 total projected points across rostered players, ~$45M in salary
    const projected = new Map([
      ['p1', 350],
      ['p2', 280],
      ['p3', 250],
      ['p4', 200],
      ['p5', 180],
      ['p6', 160],
      ['p7', 140],
      ['p8', 120],
      ['p9', 100],
      ['p10', 90],
      ['p11', 80],
      ['p12', 70],
      ['p13', 60],
      ['p14', 50],
      ['p15', 40],
      ['p16', 330], // ~3,500 total
    ]);

    const rostered = new Map([
      ['p1', { salary: 8_000_000, position: 'QB' }],
      ['p2', { salary: 6_000_000, position: 'RB' }],
      ['p3', { salary: 5_000_000, position: 'WR' }],
      ['p4', { salary: 4_000_000, position: 'WR' }],
      ['p5', { salary: 3_500_000, position: 'TE' }],
      ['p6', { salary: 3_000_000, position: 'RB' }],
      ['p7', { salary: 2_500_000, position: 'WR' }],
      ['p8', { salary: 2_000_000, position: 'QB' }],
      ['p9', { salary: 1_800_000, position: 'WR' }],
      ['p10', { salary: 1_500_000, position: 'TE' }],
      ['p11', { salary: 1_200_000, position: 'RB' }],
      ['p12', { salary: 1_000_000, position: 'WR' }],
      ['p13', { salary: 800_000, position: 'PK' }],
      ['p14', { salary: 600_000, position: 'DEF' }],
      ['p15', { salary: 500_000, position: 'WR' }],
      ['p16', { salary: 7_000_000, position: 'QB' }],
    ]);

    const ratio = calculatePointsPerDollar(projected, rostered);

    // Total points ≈ 2500, total salary ≈ $48.4M → ratio ≈ 0.0000516
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(0.001);
  });

  it('ignores players with 0 projections or 0 salary', () => {
    const projected = new Map([
      ['p1', 300],
      ['p2', 0],   // zero projections
      ['p3', 200],
    ]);
    const rostered = new Map([
      ['p1', { salary: 5_000_000, position: 'QB' }],
      ['p2', { salary: 3_000_000, position: 'WR' }], // should be excluded (0 pts)
      ['p3', { salary: 0, position: 'RB' }],          // should be excluded (0 salary)
    ]);

    const ratio = calculatePointsPerDollar(projected, rostered);
    // Only p1 contributes: 300 / 5,000,000
    expect(ratio).toBeCloseTo(300 / 5_000_000, 10);
  });

  it('returns 0 when no rostered players have salary', () => {
    const projected = new Map([['p1', 300]]);
    const rostered = new Map([['p1', { salary: 0, position: 'QB' }]]);

    expect(calculatePointsPerDollar(projected, rostered)).toBe(0);
  });

  it('returns 0 for empty inputs', () => {
    expect(calculatePointsPerDollar(new Map(), new Map())).toBe(0);
  });
});

// ── pointsToDollarValue ────────────────────────────────────────────────

describe('pointsToDollarValue', () => {
  it('converts 300 projected points to a multi-million dollar value', () => {
    // ppd ≈ 0.00006 (300pts / $5M salary)
    const ppd = 300 / 5_000_000;
    const value = pointsToDollarValue(300, ppd);
    expect(value).toBe(5_000_000);
  });

  it('returns 0 for 0 projected points', () => {
    expect(pointsToDollarValue(0, 0.00006)).toBe(0);
  });

  it('returns 0 when pointsPerDollar is 0', () => {
    expect(pointsToDollarValue(300, 0)).toBe(0);
  });

  it('returns 0 when pointsPerDollar is negative', () => {
    expect(pointsToDollarValue(300, -0.00006)).toBe(0);
  });
});

// ── estimateAuctionCost ────────────────────────────────────────────────

describe('estimateAuctionCost', () => {
  const defaultSignals = {
    positionSalaryAvg: { top3Average: 8_000_000, top5Average: 6_000_000 },
    totalAvailableCap: 100_000_000,
    totalFreeAgents: 100,
  };

  it('rank 1 gets the highest multiplier (~10x average)', () => {
    const cost = estimateAuctionCost(
      { id: 'p1', position: 'WR', age: 25 },
      { ...defaultSignals, customRank: 1 }
    );
    // avg = $100M / 100 = $1M, rank 1 multiplier = 10x → $10M
    // but capped at top3Average * 1.2 = $9.6M
    expect(cost).toBe(9_600_000);
  });

  it('rank 50 gets a mid-range multiplier', () => {
    const cost = estimateAuctionCost(
      { id: 'p2', position: 'WR', age: 27 },
      { ...defaultSignals, customRank: 50 }
    );
    // avg = $1M, rank 50 → multiplier ≈ 1.71x → ~$1.71M → rounded to $1,700,000
    expect(cost).toBeGreaterThan(1_000_000);
    expect(cost).toBeLessThan(3_000_000);
  });

  it('rank 200+ gets the floor multiplier (0.5x)', () => {
    const cost = estimateAuctionCost(
      { id: 'p3', position: 'TE', age: 30 },
      { ...defaultSignals, customRank: 300 }
    );
    // avg = $1M, multiplier = 0.5x → $500K → rounds to $500K
    expect(cost).toBe(500_000);
  });

  it('never goes below the league minimum ($425K)', () => {
    const cost = estimateAuctionCost(
      { id: 'p4', position: 'PK', age: 30 },
      {
        ...defaultSignals,
        customRank: 999,
        totalAvailableCap: 1_000_000, // Very low cap → low avg
        totalFreeAgents: 100,
      }
    );
    expect(cost).toBe(450_000); // rounded to nearest $50K ≥ $425K
  });

  it('never exceeds position top3Average * 1.2', () => {
    const cost = estimateAuctionCost(
      { id: 'p5', position: 'QB', age: 25 },
      {
        customRank: 1,
        positionSalaryAvg: { top3Average: 5_000_000, top5Average: 4_000_000 },
        totalAvailableCap: 500_000_000, // Huge cap
        totalFreeAgents: 10,
      }
    );
    // Ceiling = $5M * 1.2 = $6M
    expect(cost).toBeLessThanOrEqual(6_000_000);
  });

  it('uses ADP as fallback when no custom rank', () => {
    const withCustom = estimateAuctionCost(
      { id: 'p6', position: 'WR', age: 25 },
      { ...defaultSignals, customRank: 5, adpDynasty: 50 }
    );
    const withAdpOnly = estimateAuctionCost(
      { id: 'p6', position: 'WR', age: 25 },
      { ...defaultSignals, adpDynasty: 5 }
    );
    // When custom rank is 5, it should use that — same as ADP rank 5
    expect(withCustom).toBe(withAdpOnly);
  });

  it('defaults to rank 999 when no rank signal at all', () => {
    const cost = estimateAuctionCost(
      { id: 'p7', position: 'WR', age: 28 },
      { ...defaultSignals }
    );
    // rank 999 → multiplier = 0.5x → $500K
    expect(cost).toBe(500_000);
  });

  it('rounds to nearest $50K', () => {
    const cost = estimateAuctionCost(
      { id: 'p8', position: 'WR', age: 25 },
      { ...defaultSignals, customRank: 40 }
    );
    expect(cost % 50_000).toBe(0);
  });
});

// ── calculateSurplusValue ──────────────────────────────────────────────

describe('calculateSurplusValue', () => {
  it('returns positive surplus for a bargain player', () => {
    expect(calculateSurplusValue(5_000_000, 2_000_000)).toBe(3_000_000);
  });

  it('returns negative surplus for an overpay', () => {
    expect(calculateSurplusValue(1_000_000, 4_000_000)).toBe(-3_000_000);
  });

  it('returns zero for fair value', () => {
    expect(calculateSurplusValue(3_000_000, 3_000_000)).toBe(0);
  });
});

// ── calculateAllSurplusValues ──────────────────────────────────────────

describe('calculateAllSurplusValues', () => {
  function buildInput(overrides?: Partial<SurplusValueInput>): SurplusValueInput {
    return {
      projectedScores: [
        { id: 'p1', score: '300' },
        { id: 'p2', score: '250' },
        { id: 'p3', score: '200' },
        { id: 'p4', score: '150' },
        { id: 'p5', score: '120' },
        { id: 'p6', score: '100' },
        { id: 'p7', score: '80' },
        { id: 'p8', score: '60' },
        { id: 'p9', score: '40' },
        { id: 'p10', score: '20' },
      ],
      players: [
        { id: 'p1', name: 'Mahomes, Patrick', position: 'QB', team: 'KCC', birthdate: '811382400' },
        { id: 'p2', name: 'McCaffrey, Christian', position: 'RB', team: 'SFO', birthdate: '834451200' },
        { id: 'p3', name: 'Jefferson, Justin', position: 'WR', team: 'MIN', birthdate: '930700800' },
        { id: 'p4', name: 'Kelce, Travis', position: 'TE', team: 'KCC', birthdate: '623462400' },
        { id: 'p5', name: 'Allen, Josh', position: 'QB', team: 'BUF', birthdate: '832924800' },
        { id: 'p6', name: 'Hill, Tyreek', position: 'WR', team: 'MIA', birthdate: '763171200' },
        { id: 'p7', name: 'Barkley, Saquon', position: 'RB', team: 'PHI', birthdate: '855014400' },
        { id: 'p8', name: 'Adams, Davante', position: 'WR', team: 'NYJ', birthdate: '724982400' },
        { id: 'p9', name: 'Tucker, Justin', position: 'PK', team: 'BLT', birthdate: '627264000' },
        { id: 'p10', name: 'Free Agent, Test', position: 'WR', team: 'DAL' },
      ],
      rosters: [
        {
          id: '0001',
          player: [
            { id: 'p1', salary: '8000000', contractYear: '3', status: 'ROSTER' },
            { id: 'p2', salary: '6000000', contractYear: '2', status: 'ROSTER' },
            { id: 'p3', salary: '4000000', contractYear: '4', status: 'ROSTER' },
          ],
        },
        {
          id: '0002',
          player: [
            { id: 'p4', salary: '5000000', contractYear: '1', status: 'ROSTER' },
            { id: 'p5', salary: '7000000', contractYear: '3', status: 'ROSTER' },
          ],
        },
      ],
      salaryAverages: {
        positions: {
          QB: { top3Average: 10_000_000, top5Average: 8_000_000 },
          RB: { top3Average: 7_000_000, top5Average: 5_500_000 },
          WR: { top3Average: 8_000_000, top5Average: 6_500_000 },
          TE: { top3Average: 6_000_000, top5Average: 4_500_000 },
          PK: { top3Average: 2_000_000, top5Average: 1_500_000 },
          DEF: { top3Average: 2_000_000, top5Average: 1_500_000 },
        },
      },
      adpDynasty: new Map([
        ['p1', 1],
        ['p2', 5],
        ['p3', 3],
        ['p4', 15],
        ['p5', 2],
        ['p6', 10],
        ['p7', 12],
        ['p8', 25],
        ['p9', 100],
        ['p10', 150],
      ]),
      ...overrides,
    };
  }

  it('returns results for all players with projections', () => {
    const results = calculateAllSurplusValues(buildInput());
    expect(results.length).toBe(10);
  });

  it('marks rostered players correctly', () => {
    const results = calculateAllSurplusValues(buildInput());
    const p1 = results.find((r) => r.playerId === 'p1')!;
    const p6 = results.find((r) => r.playerId === 'p6')!;
    expect(p1.isRostered).toBe(true);
    expect(p1.currentSalary).toBe(8_000_000);
    expect(p1.contractYears).toBe(3);
    expect(p6.isRostered).toBe(false);
    expect(p6.currentSalary).toBeNull();
  });

  it('formats player names from "Last, First" to "First Last"', () => {
    const results = calculateAllSurplusValues(buildInput());
    const p1 = results.find((r) => r.playerId === 'p1')!;
    expect(p1.name).toBe('Patrick Mahomes');
  });

  it('calculates age from birthdate', () => {
    const results = calculateAllSurplusValues(buildInput());
    const p1 = results.find((r) => r.playerId === 'p1')!;
    // birthdate 811382400 = Sept 17, 1995 → age depends on current date
    expect(p1.age).toBeGreaterThan(25);
    expect(p1.age).toBeLessThan(40);
  });

  it('returns null age when no birthdate', () => {
    const results = calculateAllSurplusValues(buildInput());
    const p10 = results.find((r) => r.playerId === 'p10')!;
    expect(p10.age).toBeNull();
  });

  it('populates rank from ADP when no custom rankings', () => {
    const results = calculateAllSurplusValues(buildInput({ customRankings: undefined }));
    const p1 = results.find((r) => r.playerId === 'p1')!;
    expect(p1.rank).toBe(1);
  });

  it('prefers custom rankings over ADP', () => {
    const customRankings = new Map([['p1', 50]]);
    const results = calculateAllSurplusValues(buildInput({ customRankings }));
    const p1 = results.find((r) => r.playerId === 'p1')!;
    expect(p1.rank).toBe(50); // Custom rank, not ADP of 1
  });

  it('surplus = dollarValue - estimatedCost for every result', () => {
    const results = calculateAllSurplusValues(buildInput());
    for (const r of results) {
      expect(r.surplusValue).toBe(r.dollarValue - r.estimatedCost);
    }
  });

  it('normalizes "Def" position to "DEF"', () => {
    const input = buildInput({
      players: [
        { id: 'def1', name: 'Bears, Chicago', position: 'Def', team: 'CHI' },
      ],
      projectedScores: [{ id: 'def1', score: '100' }],
    });
    const results = calculateAllSurplusValues(input);
    const def = results.find((r) => r.playerId === 'def1')!;
    expect(def.position).toBe('DEF');
  });

  it('handles player with no projections (0 points)', () => {
    const input = buildInput({
      projectedScores: [], // no projections at all
    });
    const results = calculateAllSurplusValues(input);
    // All players get 0 projected points → $0 dollar value
    for (const r of results) {
      expect(r.projectedPoints).toBe(0);
      expect(r.dollarValue).toBe(0);
    }
  });

  it('handles empty rosters input', () => {
    const input = buildInput({ rosters: [] });
    const results = calculateAllSurplusValues(input);
    // All players should be free agents
    for (const r of results) {
      expect(r.isRostered).toBe(false);
    }
  });

  it('handles player with no ADP or custom rank', () => {
    const input = buildInput({
      adpDynasty: undefined,
      customRankings: undefined,
    });
    const results = calculateAllSurplusValues(input);
    for (const r of results) {
      expect(r.rank).toBeNull();
    }
  });

  it('surplusPercent is correctly calculated', () => {
    const results = calculateAllSurplusValues(buildInput());
    for (const r of results) {
      if (r.estimatedCost > 0) {
        const expected = r.surplusValue / r.estimatedCost;
        expect(r.surplusPercent).toBeCloseTo(expected, 5);
      }
    }
  });
});
