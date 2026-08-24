import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  gamesFromSchedule,
  longestStreaks,
  rivalryTotals,
  rankBy,
  officialRecord,
  MIN_LOPSIDED_MEETINGS,
} from '../src/utils/record-book.mjs';

/**
 * The record book claims "ever". That claim rests on two things being right:
 * counting every game exactly once, and excluding the ones nobody played.
 *
 * It deliberately does NOT read franchise-history.json. That ledger is
 * owner-scoped and drops games played under a slot's previous owner — 63% of
 * 2004, none of 2024 — so a record book built on it would bias every all-time
 * record toward the modern era while claiming to span the league's history.
 */
const toArray = (v: any) => (Array.isArray(v) ? v : v == null ? [] : [v]);

const scheduleOf = (
  weeks: Array<{ week: number; games: Array<[string, number, string, number]> }>
) => ({
  schedule: {
    weeklySchedule: weeks.map((w) => ({
      week: String(w.week),
      matchup: w.games.map(([a, sa, b, sb]) => ({
        franchise: [
          { id: a, score: String(sa) },
          { id: b, score: String(sb) },
        ],
      })),
    })),
  },
});

const collect = (schedule: any, year = 2020, firstPlayoffWeek = Infinity) =>
  gamesFromSchedule(schedule, { nameOf: (id: string) => `Team ${id}`, year, firstPlayoffWeek, toArray });

describe('gamesFromSchedule', () => {
  it('orients each game so the winner outscored the loser', () => {
    const [g] = collect(scheduleOf([{ week: 1, games: [['0002', 100, '0001', 120]] }]));
    expect(g).toMatchObject({ winnerId: '0001', loserId: '0002', margin: 20, combined: 220 });
    expect(g.winnerName).toBe('Team 0001');
  });

  it('drops forfeits, which post as 0.00 and are not performances', () => {
    const games = collect(
      scheduleOf([{ week: 1, games: [['0001', 150.64, '0002', 0], ['0003', 120, '0004', 100]] }])
    );
    expect(games).toHaveLength(1);
    expect(games[0].winnerId).toBe('0003');
  });

  it('ignores a franchise scheduled against itself', () => {
    // 2012 week 14 really does carry an outright `0023 vs 0023` bye row.
    const games = collect(scheduleOf([{ week: 14, games: [['0023', 100, '0023', 100]] }]));
    expect(games).toEqual([]);
  });

  it('records a pairing once when a week repeats it', () => {
    // 2014 and 2015 NIT weeks each carry a stray duplicate matchup.
    const games = collect(
      scheduleOf([{ week: 14, games: [['0001', 120, '0002', 100], ['0001', 120, '0002', 100]] }])
    );
    expect(games).toHaveLength(1);
  });

  it('keeps both halves of a doubleheader — one week, two opponents', () => {
    const games = collect(
      scheduleOf([{ week: 1, games: [['0001', 141, '0002', 147], ['0001', 141, '0003', 104]] }])
    );
    expect(games).toHaveLength(2);
  });

  it('marks postseason games from the first playoff week', () => {
    const games = collect(
      scheduleOf([
        { week: 13, games: [['0001', 120, '0002', 100]] },
        { week: 14, games: [['0001', 120, '0003', 100]] },
      ]),
      2020,
      14
    );
    expect(games.map((g: any) => g.isPlayoff)).toEqual([false, true]);
  });
});

describe('longestStreaks', () => {
  const games = [
    ...collect(scheduleOf([{ week: 12, games: [['0001', 120, '0002', 100]] }]), 2019),
    ...collect(scheduleOf([{ week: 13, games: [['0001', 130, '0003', 100]] }]), 2019),
    ...collect(scheduleOf([{ week: 1, games: [['0001', 140, '0004', 100]] }]), 2020),
    ...collect(scheduleOf([{ week: 2, games: [['0005', 100, '0001', 90]] }]), 2020),
  ];

  it('runs across seasons rather than resetting each year', () => {
    const [best] = longestStreaks(games, 'win', 5);
    expect(best.length).toBe(3);
    expect(best.from).toEqual({ year: 2019, week: 12 });
    expect(best.to).toEqual({ year: 2020, week: 1 });
  });

  it('ends a run on a tie, not only on a loss', () => {
    const tied = [
      ...collect(scheduleOf([{ week: 1, games: [['0001', 120, '0002', 100]] }]), 2019),
      ...collect(scheduleOf([{ week: 2, games: [['0001', 110, '0003', 110]] }]), 2019),
      ...collect(scheduleOf([{ week: 3, games: [['0001', 130, '0004', 100]] }]), 2019),
    ];
    expect(longestStreaks(tied, 'win', 5)[0].length).toBe(1);
  });

  it('tracks losing runs independently of winning ones', () => {
    expect(longestStreaks(games, 'loss', 5)[0].length).toBe(1);
  });
});

describe('rivalryTotals', () => {
  it('tallies a series once and keeps the most recent name for each slot', () => {
    const games = [
      ...gamesFromSchedule(scheduleOf([{ week: 1, games: [['0001', 120, '0002', 100]] }]), {
        nameOf: (id: string) => (id === '0001' ? 'Old Name' : 'Rival'),
        year: 2019,
        firstPlayoffWeek: Infinity,
        toArray,
      }),
      ...gamesFromSchedule(scheduleOf([{ week: 1, games: [['0001', 90, '0002', 110]] }]), {
        nameOf: (id: string) => (id === '0001' ? 'New Name' : 'Rival'),
        year: 2020,
        firstPlayoffWeek: Infinity,
        toArray,
      }),
    ];
    const [r] = rivalryTotals(games);
    expect(r.meetings).toBe(2);
    expect(r.aWins + r.bWins + r.ties).toBe(2);
    expect(r.aName).toBe('New Name');
  });
});

describe('officialRecord', () => {
  it('reads the combined h2hwlt field when MFL supplies one', () => {
    expect(officialRecord({ h2hwlt: '14-3-0', h2hw: '14', h2hl: '3', h2ht: '0' })).toEqual({
      wins: 14,
      losses: 3,
      ties: 0,
    });
  });

  it('falls back to the split fields when h2hwlt is absent', () => {
    // The AFL's 2019 and 2021 standings ship exactly this shape. A per-field
    // fallback accepted `Number('') === 0` as a real win total and rendered
    // "2021 · 0-4" beside 2,512 points.
    expect(officialRecord({ h2hw: '13', h2hl: '4', h2ht: '0' })).toEqual({
      wins: 13,
      losses: 4,
      ties: 0,
    });
  });

  it('does not treat an empty combined field as a 0-0-0 season', () => {
    expect(officialRecord({ h2hwlt: '', h2hw: '9', h2hl: '8', h2ht: '1' })).toEqual({
      wins: 9,
      losses: 8,
      ties: 1,
    });
  });

  it('reports a genuinely winless season rather than hiding it', () => {
    expect(officialRecord({ h2hwlt: '0-17-0' })).toEqual({ wins: 0, losses: 17, ties: 0 });
  });
});

describe('rankBy', () => {
  it('sorts ascending when asked, for closest-finish boards', () => {
    const rows = [{ n: 5 }, { n: 1 }, { n: 3 }];
    expect(rankBy(rows, (r: any) => r.n, 2, true).map((r: any) => r.n)).toEqual([1, 3]);
    expect(rankBy(rows, (r: any) => r.n, 2).map((r: any) => r.n)).toEqual([5, 3]);
  });
});

describe('the committed AFL record book', () => {
  const bookPath = path.resolve(__dirname, '../data/afl-fantasy/derived/record-book.json');
  const book = JSON.parse(fs.readFileSync(bookPath, 'utf8'));

  it('spans every season the league has scores for', () => {
    expect(book.seasonsCovered).toBe(22);
    expect(book.firstSeason).toBe(2004);
    expect(book.lastSeason).toBe(2025);
  });

  it('counts every played game, not only the owner-attributable ones', () => {
    // The owner-scoped ledger holds ~4,175 of these. If this number ever falls
    // back to that range, the record book has silently been rebuilt from
    // franchise-history.json and its all-time claims are no longer true.
    expect(book.totalGames).toBeGreaterThan(5000);
  });

  it('has no board ranking a game above its own winning score', () => {
    for (const g of [...book.highestScore, ...book.biggestBlowout, ...book.closestGame, ...book.highestCombined]) {
      expect(g.winnerScore).toBeGreaterThanOrEqual(g.loserScore);
      expect(g.winnerId).not.toBe(g.loserId);
      expect(g.winnerName).toBeTruthy();
    }
  });

  it('only calls a rivalry lopsided once it is a real series', () => {
    for (const r of book.mostLopsided) {
      expect(r.meetings).toBeGreaterThanOrEqual(MIN_LOPSIDED_MEETINGS);
    }
  });

  it('reaches back past the seasons the ledger can attribute', () => {
    // The point of the whole recovery: a record book that stops at 2013 would
    // be describing a different league.
    const years = [
      ...book.highestScore, ...book.biggestBlowout, ...book.closestGame,
      ...book.highestCombined, ...book.bestSeason, ...book.mostPointsSeason,
    ].map((r: any) => r.year);
    expect(Math.min(...years)).toBeLessThan(2012);
  });
});
