/**
 * Two things the Yahoo-style game log needs from the payload:
 *
 *  - UPCOMING weeks carry the opponent's rank vs his position, so the log
 *    doubles as a rest-of-season schedule colored by matchup difficulty. They
 *    used to arrive with the opponent named and its strength blank.
 *  - Week 1 carries his SEASON position rank (`pr`), ranked across the whole
 *    scored pool before any page filters the payload to its own players.
 */
import { describe, expect, it } from 'vitest';
import { buildWeeklyPlayerResults, rankByPosition } from '../src/utils/weekly-player-results';

const PLAYERS = {
  players: {
    player: [
      { id: '1', position: 'RB', team: 'NYJ' },
      { id: '2', position: 'RB', team: 'NYJ' },
      { id: '3', position: 'RB', team: 'NYJ' },
      { id: '4', position: 'LWR', team: 'NYJ' },
    ],
  },
};

const SCHEDULE = {
  fullNflSchedule: {
    nflSchedule: [1, 2, 3].map((week) => ({
      week: String(week),
      matchup: [{ team: [{ id: 'NYJ', isHome: '1' }, { id: 'KCC', isHome: '0' }] }],
    })),
  },
};

const FPA = { fantasyPointsAllowed: { KC: { RB: { avg: 22.4, rank: 3 }, WR: { avg: 30.1, rank: 1 } } } };

// Weeks 1 and 2 scored; week 3 still to play.
const SCORES = new Map<string, Record<number, number>>([
  ['1', { 1: 10, 2: 10 }],
  ['2', { 1: 30, 2: 5 }],
  ['3', { 1: 20 }],
  ['4', { 1: 4 }],
]);

const payload = buildWeeklyPlayerResults([], SCHEDULE, FPA, PLAYERS, { league: {} }, 3, SCORES);

describe('upcoming weeks', () => {
  it('carry the opponent and its rank vs his position', () => {
    const wk3 = payload['3'][2];
    expect(wk3.p).toBeNull();
    expect(wk3.opp).toBe('vs KC');
    expect(wk3.rank).toBe(3);
    expect(wk3.avg).toBe(22.4);
  });
});

describe('season position rank', () => {
  it('ranks by total points within the position, on week 1 only', () => {
    expect(payload['2'][0].pr).toBe(1); // 35
    expect(payload['3'][0].pr).toBe(2); // 20 (ties player 1)
    expect(payload['1'][0].pr).toBe(2); // 20
    expect(payload['4'][0].pr).toBe(1); // only WR — LWR folds into WR
    expect(payload['2'][1].pr).toBeUndefined();
  });

  it('uses competition ranking for ties', () => {
    const ranks = rankByPosition([
      { id: 'a', pos: 'QB', total: 50 },
      { id: 'b', pos: 'QB', total: 40 },
      { id: 'c', pos: 'QB', total: 40 },
      { id: 'd', pos: 'QB', total: 10 },
    ]);
    expect([...ranks.entries()]).toEqual([['a', 1], ['b', 2], ['c', 2], ['d', 4]]);
  });
});
