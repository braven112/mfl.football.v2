import { describe, expect, it } from 'vitest';
import {
  buildWeeklyAllowed,
  currentWeek,
  indexPlayers,
  indexSchedule,
  matchupCells,
  parseOfficialTotals,
  parsePlannerQuery,
  plannerHref,
  pointsPerGame,
  scheduleTeams,
  stretchScore,
  summarizeAllowed,
} from '../src/utils/matchup-planner';

const game = (a: string, b: string, done: boolean, homeA = true) => ({
  gameSecondsRemaining: done ? '0' : '3600',
  kickoff: '0',
  team: [
    { id: a, isHome: homeA ? '1' : '0', score: done ? '20' : '' },
    { id: b, isHome: homeA ? '0' : '1', score: done ? '17' : '' },
  ],
});

// Four teams. AAA has a week-2 bye; week 3 is not played yet.
const schedulePayload = {
  fullNflSchedule: {
    nflSchedule: [
      { week: '1', matchup: [game('AAA', 'BBB', true), game('CCC', 'DDD', true)] },
      { week: '2', matchup: [game('BBB', 'CCC', true)] },
      { week: '3', matchup: [game('AAA', 'CCC', false, false), game('BBB', 'DDD', false)] },
    ],
  },
};

const playersPayload = {
  players: {
    player: [
      { id: '1', name: 'Back, A', position: 'RB', team: 'AAA' },
      { id: '2', name: 'Back, B', position: 'RB', team: 'BBB' },
      { id: '3', name: 'Back, C', position: 'RB', team: 'CCC' },
      { id: '4', name: 'Back, D', position: 'RB', team: 'DDD' },
      { id: '9', name: 'Linebacker', position: 'LB', team: 'AAA' },
    ],
  },
};

const scores = {
  1: { '1': 10, '2': 20, '3': 5, '4': 15, '9': 99 },
  2: { '1': 0, '2': 30, '3': 12 },
};

const schedule = indexSchedule(schedulePayload);
const players = indexPlayers(playersPayload);
const weekly = buildWeeklyAllowed(scores, players, schedule);

describe('matchup planner maths', () => {
  it('indexes opponents, home/away and byes', () => {
    expect(schedule.get(3)!.get('AAA')).toMatchObject({ opp: 'CCC', home: false, done: false });
    expect(schedule.get(2)!.has('AAA')).toBe(false);
    expect(scheduleTeams(schedule)).toEqual(['AAA', 'BBB', 'CCC', 'DDD']);
    expect(currentWeek(schedule)).toBe(3);
  });

  it('keeps only planner positions', () => {
    expect(players.has('9')).toBe(false);
  });

  it('charges each score to the defense the player faced, final games only', () => {
    expect(weekly.BBB[1].RB).toBe(10); // AAA's back vs BBB
    expect(weekly.AAA[1].RB).toBe(20);
    expect(weekly.CCC[2].RB).toBe(30);
    expect(weekly.BBB[2].RB).toBe(12);
    // A bye week is not a game: AAA played no defense in week 2.
    expect(weekly.AAA[2]).toBeUndefined();
    // Week 3 is not final, so nothing is charged.
    expect(weekly.CCC[3]).toBeUndefined();
  });

  it('averages over games actually played, and ranks 1 = fewest allowed', () => {
    const s = summarizeAllowed(scheduleTeams(schedule), schedule, weekly, null, 'season');
    expect(s.AAA.RB).toMatchObject({ avg: 20, games: 1 }); // one game, not two weeks
    expect(s.BBB.RB).toMatchObject({ avg: 11, games: 2 });
    expect(s.CCC.RB).toMatchObject({ avg: 22.5, games: 2 });
    expect(s.DDD.RB).toMatchObject({ avg: 5, games: 1 });
    expect(s.DDD.RB.rank).toBe(1);
    expect(s.CCC.RB.rank).toBe(4);
  });

  it('prefers MFL official totals for the season view', () => {
    const official = parseOfficialTotals({
      pointsAllowed: { team: [{ id: 'BBB', position: [{ name: 'RB', points: '40' }, { name: 'IDP', points: '1' }] }] },
    });
    expect(official.BBB).toEqual({ RB: 40 });
    const s = summarizeAllowed(['BBB'], schedule, weekly, official, 'season');
    expect(s.BBB.RB.avg).toBe(20); // 40 over 2 games
  });

  it('builds grid cells with opponent, bye and a stretch score', () => {
    const s = summarizeAllowed(scheduleTeams(schedule), schedule, weekly, null, 'season');
    const cells = matchupCells({ position: 'RB', team: 'AAA' }, [2, 3], schedule, s);
    expect(cells[0].bye).toBe(true);
    expect(cells[1]).toMatchObject({ opp: 'CCC', home: false, avg: 22.5, rank: 4 });
    // Bye counts as 0: (0 + 22.5) / 2.
    expect(stretchScore(cells)).toBe(11.3);
  });

  it('counts points per game only in weeks the player’s team played', () => {
    expect(pointsPerGame('1', 'AAA', scores, schedule)).toEqual({ ppg: 10, games: 1 });
  });
});

describe('planner query', () => {
  it('defaults to the playoff weeks and clamps the range', () => {
    const q = parsePlannerQuery(new URLSearchParams(''));
    expect(q).toMatchObject({ view: 'grid', window: 'season', from: 15, to: 17, pos: 'all' });
    const wide = parsePlannerQuery(new URLSearchParams('from=12&to=2'), 18);
    expect([wide.from, wide.to]).toEqual([2, 6]);
  });

  it('round-trips through plannerHref, leaving defaults out', () => {
    const q = parsePlannerQuery(new URLSearchParams(''));
    expect(plannerHref('/p', null, q, {})).toBe('/p');
    const href = plannerHref('/p', 'afl-fantasy', q, { from: 12, to: 14, pos: 'WR', window: 'recent' });
    expect(parsePlannerQuery(new URL(href, 'https://x').searchParams)).toMatchObject({ from: 12, to: 14, pos: 'WR', window: 'recent' });
  });
});
