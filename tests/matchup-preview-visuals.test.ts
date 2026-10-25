import { describe, it, expect } from 'vitest';
import {
  seasonGames,
  sideSnapshot,
  seriesSnapshot,
  currentStreak,
  buildMatchupVisuals,
} from '../src/utils/matchup-preview-visuals.mjs';
import { recordBook } from '../src/utils/league-history/records.mjs';

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

/**
 * An indexed League History dataset (the series' one source) from games
 * `[year, winner, winnerScore, loser, loserScore, playoff?]`. Every franchise
 * has the same owner in every season, and makes the playoffs.
 */
function historyOf(games: Array<[number, string, number, string, number, boolean?]>, ids = ['A', 'B', 'C', 'D']) {
  const years = [...new Set(games.map((g) => g[0]))].sort();
  const teams = Object.fromEntries(ids.map((id) => [id, { n: id, i: null, h: `o${id}`, w: 0, l: 0, t: 0, pf: 0, r: 'P' }]));
  return recordBook({
    league: 'test',
    owners: Object.fromEntries(ids.map((id) => [`o${id}`, { name: id }])),
    seasons: years.map((y) => ({ y, done: 1, pw: 15, teams })),
    games: games.map(([y, wf, ws, lf, ls, playoff], i) => [y, playoff ? 15 : i % 14 + 1, wf, ws, lf, ls, playoff ? 1 : 0]),
  }).ix;
}

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
  const history = historyOf([
    [2020, 'A', 120, 'B', 80],
    [2021, 'B', 100, 'A', 90, true],
    [2022, 'A', 101, 'B', 100],
    [2023, 'A', 140, 'B', 60],
  ]);

  it('states the record from side A and names the streak holder', () => {
    const s = seriesSnapshot(history, 'A', 'B')!;
    expect(s).toMatchObject({ disputed: false, games: 4, aWins: 3, bWins: 1, since: 2020, playoffGames: 1, playoffWins: 0, playoffLosses: 1 });
    expect(s.streak).toEqual({ franchiseId: 'A', count: 2 });
    expect(s.biggest).toMatchObject({ year: 2023, winnerId: 'A', score: 140, opp: 60 });
    expect(s.closest).toMatchObject({ year: 2022, winnerId: 'A', score: 101, opp: 100 });
  });

  it('flips cleanly when asked from the other side', () => {
    const s = seriesSnapshot(history, 'B', 'A')!;
    expect(s).toMatchObject({ aWins: 1, bWins: 3 });
    expect(s.streak).toEqual({ franchiseId: 'A', count: 2 });
  });

  it('is null for a pairing that never met, or with no history at all', () => {
    expect(seriesSnapshot(history, 'A', 'C')).toBeNull();
    expect(seriesSnapshot(undefined, 'A', 'B')).toBeNull();
  });
});

describe('buildMatchupVisuals', () => {
  // A-B and C-D: the same 3-3 series.
  const even = (x: string, y: string) =>
    [...Array(6)].map((_, i) => [2010 + i, i < 3 ? x : y, 110, i < 3 ? y : x, 100] as [number, string, number, string, number]);
  const history = historyOf([...even('A', 'B'), ...even('C', 'D')]);
  // A and B are 2-0; C and D are 0-2. Same series, so the stakes decide.
  const raw = [
    week(1, [['A', 120, 'C', 80], ['B', 110, 'D', 70]]),
    week(2, [['A', 130, 'D', 60], ['B', 100, 'C', 90]]),
  ];

  it('features the series between the two better teams', () => {
    const v = buildMatchupVisuals({
      pairings: [{ franchise1Id: 'C', franchise2Id: 'D' }, { franchise1Id: 'A', franchise2Id: 'B' }],
      weeklyResultsRaw: raw,
      history,
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
      history,
      year: 2026,
      week: 3,
    });
    expect(v.gameOfWeek).toBeNull();
    expect(v.matchups[0].series).toBeNull();
  });
});
