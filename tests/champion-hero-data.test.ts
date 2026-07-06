import { describe, it, expect } from 'vitest';
import {
  getChampionshipWeekTopScorer,
  type ChampionDataDeps,
} from '../src/utils/hero-data/champion-hero-data';

/** Build an injectable deps stub from fixture data keyed by season year. */
function makeDeps(byYear: Record<number, {
  result: { winnerFranchiseId: string; loserFranchiseId: string; winnerScore: number; loserScore: number } | null;
  week: number;
  candidates: Array<{ playerId: string; franchiseId: string; score: number }>;
}>): ChampionDataDeps {
  return {
    getChampionshipResult: (year: number) => byYear[year]?.result ?? null,
    getWeekTopScorerCandidates: (year: number) => {
      const entry = byYear[year];
      return entry ? { week: entry.week, candidates: entry.candidates } : { week: 0, candidates: [] };
    },
  };
}

describe('getChampionshipWeekTopScorer (fixtures)', () => {
  it('picks the winning franchise\'s highest scorer in the title-game week', () => {
    const deps = makeDeps({
      2030: {
        result: { winnerFranchiseId: '0003', loserFranchiseId: '0007', winnerScore: 140, loserScore: 110 },
        week: 17,
        candidates: [
          { playerId: 'p1', franchiseId: '0003', score: 22.5 },
          { playerId: 'p2', franchiseId: '0003', score: 38.1 }, // <- winner, highest
          { playerId: 'p3', franchiseId: '0007', score: 44.0 }, // loser, higher overall but not champion
          { playerId: 'p4', franchiseId: '0003', score: 12.0 },
        ],
      },
    });
    expect(getChampionshipWeekTopScorer(2030, deps)).toEqual({
      playerId: 'p2',
      franchiseId: '0003',
      score: 38.1,
      week: 17,
    });
  });

  it('returns null when there is no championship result', () => {
    const deps = makeDeps({
      2030: { result: null, week: 17, candidates: [{ playerId: 'p1', franchiseId: '0003', score: 10 }] },
    });
    expect(getChampionshipWeekTopScorer(2030, deps)).toBeNull();
  });

  it('returns null when the winning franchise has no scored players', () => {
    const deps = makeDeps({
      2030: {
        result: { winnerFranchiseId: '0003', loserFranchiseId: '0007', winnerScore: 100, loserScore: 90 },
        week: 17,
        candidates: [{ playerId: 'p3', franchiseId: '0007', score: 30 }],
      },
    });
    expect(getChampionshipWeekTopScorer(2030, deps)).toBeNull();
  });

  it('returns null when the box-score week is empty (week 0)', () => {
    const deps = makeDeps({
      2030: {
        result: { winnerFranchiseId: '0003', loserFranchiseId: '0007', winnerScore: 100, loserScore: 90 },
        week: 0,
        candidates: [],
      },
    });
    expect(getChampionshipWeekTopScorer(2030, deps)).toBeNull();
  });

  it('falls back to seasonYear-1 across the Dec→Jan boundary', () => {
    const deps = makeDeps({
      // Requested year has nothing (January reference resolved a year too high)
      2031: { result: null, week: 0, candidates: [] },
      2030: {
        result: { winnerFranchiseId: '0009', loserFranchiseId: '0002', winnerScore: 121, loserScore: 118 },
        week: 17,
        candidates: [
          { playerId: 'q1', franchiseId: '0009', score: 29.9 },
          { playerId: 'q2', franchiseId: '0002', score: 40.0 },
        ],
      },
    });
    expect(getChampionshipWeekTopScorer(2031, deps)).toEqual({
      playerId: 'q1',
      franchiseId: '0009',
      score: 29.9,
      week: 17,
    });
  });

  it('prefers the requested year over the fallback year', () => {
    const deps = makeDeps({
      2031: {
        result: { winnerFranchiseId: '0001', loserFranchiseId: '0002', winnerScore: 100, loserScore: 90 },
        week: 16,
        candidates: [{ playerId: 'cur', franchiseId: '0001', score: 25 }],
      },
      2030: {
        result: { winnerFranchiseId: '0009', loserFranchiseId: '0002', winnerScore: 121, loserScore: 118 },
        week: 17,
        candidates: [{ playerId: 'prev', franchiseId: '0009', score: 50 }],
      },
    });
    expect(getChampionshipWeekTopScorer(2031, deps)?.playerId).toBe('cur');
  });
});

describe('getChampionshipWeekTopScorer (frozen 2025 real data)', () => {
  it('casts Drake Maye — Computer Jocks (0010) top scorer in the title game', () => {
    // 2025 is frozen + populated: franchise 0010 beat 0015, week 17 box score.
    const top = getChampionshipWeekTopScorer(2025);
    expect(top).not.toBeNull();
    expect(top!.franchiseId).toBe('0010');
    expect(top!.week).toBe(17);
    // Drake Maye (MFL id 16580) put up the winning franchise's top score.
    expect(top!.playerId).toBe('16580');
    expect(top!.score).toBeCloseTo(42.44, 2);
  });
});
