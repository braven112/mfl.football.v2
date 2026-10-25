import { describe, it, expect } from 'vitest';
import {
  seasonGames,
  sideSnapshot,
  seriesSnapshot,
  currentStreak,
  buildMatchupVisuals,
} from '../src/utils/matchup-preview-visuals.mjs';

/** One MFL weeklyResults entry: [[idA, scoreA, idB, scoreB], ...]. */
function week(n: number, games: Array<[string, number, string, number]>) {
  return {
    weeklyResults: {
      week: String(n),
      matchup: games.map(([a, sa, b, sb]) => ({
        franchise: [
          { id: a, score: String(sa), result: sa > sb ? 'W' : sa < sb ? 'L' : 'T' },
          { id: b, score: String(sb), result: sb > sa ? 'W' : sb < sa ? 'L' : 'T' },
        ],
      })),
    },
  };
}

const meeting = (year: number, score: number, opponentScore: number, extra = {}) => ({
  year, week: 1, score, opponentScore, isPlayoff: false, bothAttributed: true, ...extra,
});

describe('seasonGames / sideSnapshot', () => {
  const raw = [
    week(1, [['A', 100, 'B', 90], ['C', 80, 'D', 70]]),
    week(2, [['A', 60, 'C', 120], ['B', 110, 'D', 50]]),
    // The previewed week and later are never read, even when they carry scores.
    week(3, [['A', 999, 'D', 1]]),
  ];

  it('reads only weeks before the previewed one', () => {
    const s = sideSnapshot('A', seasonGames(raw, 3));
    expect(s.form).toEqual(['W', 'L']);
    expect(s.weekly).toEqual([100, 60]);
    expect(s.streak).toBe('L1');
  });

  it('counts all-play once per week and measures luck against it', () => {
    const s = sideSnapshot('A', seasonGames(raw, 3));
    // Week 1: 100 beats 90, 80, 70. Week 2: 60 beats 50 only.
    expect(s.allPlay).toEqual({ wins: 4, losses: 2, ties: 0 });
    // 1 actual win vs 4/6 × 2 games expected.
    expect(s.luck).toBe(-0.3);
  });

  it('gives a doubleheader week two games but one weekly score', () => {
    const dh = [week(1, [['A', 100, 'B', 90], ['A', 100, 'C', 120], ['B', 90, 'C', 120]])];
    const s = sideSnapshot('A', seasonGames(dh, 2));
    expect(s.form).toEqual(['W', 'L']);
    expect(s.weekly).toEqual([100]);
  });

  it('skips an unplayed 0-0 placeholder', () => {
    const s = sideSnapshot('A', seasonGames([week(1, [['A', 0, 'B', 0]])], 2));
    expect(s.form).toEqual([]);
    expect(s.streak).toBeNull();
    expect(s.luck).toBeNull();
  });
});

describe('currentStreak', () => {
  it('counts the trailing run', () => {
    expect(currentStreak(['W', 'L', 'W', 'W'])).toBe('W2');
    expect(currentStreak([])).toBeNull();
  });
});

describe('seriesSnapshot', () => {
  const franchises = {
    A: { matchupHistory: { B: [meeting(2020, 120, 80), meeting(2021, 90, 100, { isPlayoff: true }), meeting(2022, 101, 100), meeting(2023, 140, 60)] } },
    B: { matchupHistory: { A: [meeting(2020, 80, 120), meeting(2021, 100, 90, { isPlayoff: true }), meeting(2022, 100, 101), meeting(2023, 60, 140)] } },
  };

  it('states the record from side A and names the streak holder', () => {
    const s = seriesSnapshot(franchises, 'A', 'B')!;
    expect(s).toMatchObject({ disputed: false, games: 4, aWins: 3, bWins: 1, since: 2020, playoffGames: 1, playoffWins: 0, playoffLosses: 1 });
    expect(s.streak).toEqual({ franchiseId: 'A', count: 2 });
    expect(s.biggest).toMatchObject({ year: 2023, winnerId: 'A', score: 140, opp: 60 });
    expect(s.closest).toMatchObject({ year: 2022, winnerId: 'A', score: 101, opp: 100 });
  });

  it('flips cleanly when asked from the other side', () => {
    const s = seriesSnapshot(franchises, 'B', 'A')!;
    expect(s).toMatchObject({ aWins: 1, bWins: 3 });
    expect(s.streak).toEqual({ franchiseId: 'A', count: 2 });
  });

  it('refuses a record when the two stored copies disagree', () => {
    const disputed = { A: franchises.A, B: { matchupHistory: { A: franchises.B.matchupHistory.A.slice(0, 3) } } };
    expect(seriesSnapshot(disputed, 'A', 'B')).toEqual({ disputed: true, games: 4 });
  });

  it('ignores meetings with a former owner', () => {
    const former = {
      A: { matchupHistory: { B: [meeting(2020, 120, 80, { bothAttributed: false })] } },
      B: { matchupHistory: { A: [meeting(2020, 80, 120, { bothAttributed: false })] } },
    };
    expect(seriesSnapshot(former, 'A', 'B')).toBeNull();
  });
});

describe('buildMatchupVisuals', () => {
  const series = (aWins: number, bWins: number) => {
    const a = [...Array(aWins)].map((_, i) => meeting(2010 + i, 110, 100));
    const b = [...Array(bWins)].map((_, i) => meeting(2030 + i, 90, 100));
    return [...a, ...b];
  };
  const mirror = (ms: ReturnType<typeof meeting>[]) => ms.map((m) => ({ ...m, score: m.opponentScore, opponentScore: m.score }));
  const ab = series(3, 3);
  const cd = series(3, 3);
  const franchises = {
    A: { matchupHistory: { B: ab } },
    B: { matchupHistory: { A: mirror(ab) } },
    C: { matchupHistory: { D: cd } },
    D: { matchupHistory: { C: mirror(cd) } },
  };
  // A and B are 2-0; C and D are 0-2. Same series, so the stakes decide.
  const raw = [
    week(1, [['A', 120, 'C', 80], ['B', 110, 'D', 70]]),
    week(2, [['A', 130, 'D', 60], ['B', 100, 'C', 90]]),
  ];

  it('features the series between the two better teams', () => {
    const v = buildMatchupVisuals({
      pairings: [{ franchise1Id: 'C', franchise2Id: 'D' }, { franchise1Id: 'A', franchise2Id: 'B' }],
      weeklyResultsRaw: raw,
      franchises,
      year: 2026,
      week: 3,
    });
    expect(v.gameOfWeek).toBe(1);
    expect(v.matchups[1].series!.meetings).toHaveLength(6);
    // Only the featured game carries its meeting list.
    expect(v.matchups[0].series!.meetings).toBeUndefined();
  });

  it('features nothing when no series is long enough', () => {
    const v = buildMatchupVisuals({
      pairings: [{ franchise1Id: 'A', franchise2Id: 'C' }],
      weeklyResultsRaw: raw,
      franchises,
      year: 2026,
      week: 3,
    });
    expect(v.gameOfWeek).toBeNull();
    expect(v.matchups[0].series).toBeNull();
  });
});
