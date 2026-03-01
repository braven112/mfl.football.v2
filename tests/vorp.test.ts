import { describe, it, expect } from 'vitest';
import {
  calculateReplacementLevels,
  calculateVORP,
  calculateAllVORP,
  THE_LEAGUE_VORP_CONFIG,
} from '../src/utils/vorp';

/**
 * Build a mock set of players and projected scores for testing.
 * Creates N players per position with linearly decreasing scores.
 */
function buildMockData(playersPerPosition: number, topScore: number) {
  const positions = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];
  const projectedScores = new Map<string, number>();
  const players = new Map<string, { position: string }>();

  for (const pos of positions) {
    for (let i = 0; i < playersPerPosition; i++) {
      const id = `${pos.toLowerCase()}${i + 1}`;
      const score = Math.max(0, topScore - i * 5);
      projectedScores.set(id, score);
      players.set(id, { position: pos });
    }
  }

  return { projectedScores, players };
}

describe('calculateReplacementLevels', () => {
  it('sets QB replacement at index 16 (QB17) with 16 teams, 1 starter', () => {
    const { projectedScores, players } = buildMockData(30, 300);
    const levels = calculateReplacementLevels(projectedScores, players);
    // QB17 = index 16, score = 300 - 16*5 = 220
    expect(levels.get('QB')).toBe(220);
  });

  it('sets RB replacement at index 32 (RB33) with 16 teams, 2 starters', () => {
    const { projectedScores, players } = buildMockData(50, 250);
    const levels = calculateReplacementLevels(projectedScores, players);
    // RB33 = index 32, score = 250 - 32*5 = 90
    expect(levels.get('RB')).toBe(90);
  });

  it('sets WR replacement at index 48 (WR49) with 16 teams, 3 starters', () => {
    const { projectedScores, players } = buildMockData(60, 250);
    const levels = calculateReplacementLevels(projectedScores, players);
    // WR49 = index 48, score = 250 - 48*5 = 10
    expect(levels.get('WR')).toBe(10);
  });

  it('sets TE replacement at index 16 (TE17) with 16 teams, 1 starter', () => {
    const { projectedScores, players } = buildMockData(30, 200);
    const levels = calculateReplacementLevels(projectedScores, players);
    // TE17 = index 16, score = 200 - 16*5 = 120
    expect(levels.get('TE')).toBe(120);
  });

  it('returns 0 when fewer players than replacement threshold', () => {
    const { projectedScores, players } = buildMockData(10, 300);
    const levels = calculateReplacementLevels(projectedScores, players);
    // Only 10 QBs, need index 16 → falls off the array → 0
    expect(levels.get('QB')).toBe(0);
  });

  it('handles empty inputs', () => {
    const levels = calculateReplacementLevels(new Map(), new Map());
    expect(levels.get('QB')).toBe(0);
    expect(levels.get('RB')).toBe(0);
  });

  it('uses custom config when provided', () => {
    const { projectedScores, players } = buildMockData(20, 300);
    const config = { teamCount: 8, startersPerPosition: { QB: 2 } };
    const levels = calculateReplacementLevels(projectedScores, players, config);
    // QB replacement index = 8 * 2 = 16, score = 300 - 16*5 = 220
    expect(levels.get('QB')).toBe(220);
    // Other positions not in config won't have entries
    expect(levels.has('RB')).toBe(false);
  });
});

describe('calculateVORP', () => {
  const replacementLevel = new Map([
    ['QB', 200],
    ['RB', 100],
    ['WR', 80],
    ['TE', 120],
  ]);

  it('returns positive VORP for elite player', () => {
    expect(calculateVORP(350, 'QB', replacementLevel)).toBe(150);
  });

  it('returns approximately 0 for replacement-level player', () => {
    expect(calculateVORP(200, 'QB', replacementLevel)).toBe(0);
  });

  it('returns negative VORP for below-replacement player', () => {
    expect(calculateVORP(80, 'RB', replacementLevel)).toBe(-20);
  });

  it('handles 0 projected points', () => {
    expect(calculateVORP(0, 'QB', replacementLevel)).toBe(-200);
  });

  it('handles unknown position (replacement = 0)', () => {
    expect(calculateVORP(150, 'K', replacementLevel)).toBe(150);
  });

  it('normalizes position case', () => {
    expect(calculateVORP(350, 'qb', replacementLevel)).toBe(150);
  });
});

describe('calculateAllVORP', () => {
  it('returns VORP for all players with projections', () => {
    const { projectedScores, players } = buildMockData(30, 300);
    const results = calculateAllVORP(projectedScores, players, 0.000065);
    // 30 players per 6 positions = 180 total
    expect(results.size).toBe(180);
  });

  it('top player has highest positive VORP', () => {
    const { projectedScores, players } = buildMockData(30, 300);
    const results = calculateAllVORP(projectedScores, players, 0.000065);
    const qb1 = results.get('qb1')!;
    // QB1 score = 300, replacement (QB17) = 220, VORP = 80
    expect(qb1.vorpPoints).toBe(80);
  });

  it('replacement-level player has ~0 VORP', () => {
    const { projectedScores, players } = buildMockData(30, 300);
    const results = calculateAllVORP(projectedScores, players, 0.000065);
    // QB17 = index 16, score = 300 - 16*5 = 220, replacement = 220
    const qb17 = results.get('qb17')!;
    expect(qb17.vorpPoints).toBe(0);
  });

  it('below-replacement player has negative VORP', () => {
    const { projectedScores, players } = buildMockData(30, 300);
    const results = calculateAllVORP(projectedScores, players, 0.000065);
    // QB30 = score = 300 - 29*5 = 155, replacement = 220, VORP = -65
    const qb30 = results.get('qb30')!;
    expect(qb30.vorpPoints).toBe(-65);
  });

  it('calculates dollar VORP using pointsToDollarValue', () => {
    const { projectedScores, players } = buildMockData(30, 300);
    const pointsPerDollar = 0.000065;
    const results = calculateAllVORP(projectedScores, players, pointsPerDollar);
    const qb1 = results.get('qb1')!;
    // vorpDollar = pointsToDollarValue(80, 0.000065)
    expect(qb1.vorpDollar).toBe(Math.round(80 / pointsPerDollar));
  });

  it('skips players not in the players map', () => {
    const projectedScores = new Map([
      ['qb1', 300],
      ['unknown', 200],
    ]);
    const players = new Map([['qb1', { position: 'QB' }]]);
    const results = calculateAllVORP(projectedScores, players, 0.000065);
    expect(results.has('qb1')).toBe(true);
    expect(results.has('unknown')).toBe(false);
  });

  it('handles DEF position correctly', () => {
    const { projectedScores, players } = buildMockData(20, 150);
    const results = calculateAllVORP(projectedScores, players, 0.000065);
    const def1 = results.get('def1')!;
    // DEF1 = 150, DEF replacement at index 16 = 150 - 16*5 = 70, VORP = 80
    expect(def1.vorpPoints).toBe(80);
  });
});
