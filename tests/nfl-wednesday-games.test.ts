import { describe, expect, it } from 'vitest';
import {
  findWednesdayGames,
  newUpcomingGames,
  runsWaiversOnWednesday,
  teamNickname,
  usualWednesdayRunTime,
  waiverStatusOn,
} from '../src/utils/nfl-wednesday-games.mjs';

const epoch = (iso: string) => String(Date.parse(iso) / 1000);
const game = (iso: string, away: string, home: string) => ({
  kickoff: epoch(iso),
  team: [{ id: away, isHome: '0' }, { id: home, isHome: '1' }],
});

// Week 12 of 2026 as MFL publishes it: Wednesday 5:00 PM PT, then Thanksgiving.
const WEEKS = [
  { week: '12', matchup: [game('2026-11-26T01:00:00Z', 'GBP', 'LAR'), game('2026-11-26T17:30:00Z', 'CHI', 'DET')] },
  // A Tuesday 6:00 PM PT game is Wednesday in UTC — must NOT count.
  { week: '13', matchup: [game('2026-12-02T02:00:00Z', 'NYG', 'DAL')] },
];

describe('findWednesdayGames', () => {
  it('finds Wednesday games by the Pacific date, not UTC', () => {
    const games = findWednesdayGames(WEEKS);
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ week: 12, away: 'GBP', home: 'LAR', date: '2026-11-25', time: '5:00 PM', label: 'Wed Nov 25' });
  });
});

describe('newUpcomingGames', () => {
  const games = findWednesdayGames(WEEKS);
  it('reports a game once, and never one already played', () => {
    const before = new Date('2026-05-14T00:00:00Z');
    expect(newUpcomingGames(undefined, games, before)).toHaveLength(1);
    expect(newUpcomingGames(games, games, before)).toHaveLength(0);
    expect(newUpcomingGames(undefined, games, new Date('2026-11-27T00:00:00Z'))).toHaveLength(0);
  });
  it('treats a moved kickoff as a new game', () => {
    const moved = [{ ...games[0], kickoff: '2026-11-25T17:15:00-08:00' }];
    expect(newUpcomingGames(games, moved, new Date('2026-05-14T00:00:00Z'))).toHaveLength(1);
  });
});

describe('waiver calendar', () => {
  // TheLeague 2026: blind bid every Wednesday 7:00 PM PT for 14 more weeks.
  const calendar = [
    { type: 'WAIVER_LOCK', start_time: epoch('2026-09-13T17:00:00Z'), happens: '16' },
    { type: 'WAIVER_BBID', start_time: epoch('2026-09-17T02:00:00Z'), happens: '14' },
  ];
  it('reads the usual Wednesday run from the league calendar', () => {
    expect(runsWaiversOnWednesday(calendar)).toBe(true);
    expect(usualWednesdayRunTime(calendar)).toBe('7:00 PM');
    expect(runsWaiversOnWednesday([{ type: 'WAIVER_BBID', start_time: epoch('2026-09-16T02:00:00Z'), happens: '14' }])).toBe(false);
  });
  it('flags a run on the game day, keeping wall-clock time across DST', () => {
    expect(waiverStatusOn(calendar, '2026-11-25')).toEqual({ status: 'conflict', time: '7:00 PM' });
  });
  it('knows when the run was already moved off that day', () => {
    const moved = [...calendar, { type: 'WAIVER_BBID', start_time: epoch('2026-12-30T04:00:00Z') }];
    expect(waiverStatusOn(moved, '2026-12-23')).toMatchObject({ status: 'conflict' });
    expect(waiverStatusOn(moved, '2026-12-28')).toEqual({ status: 'moved', time: null });
  });
  it('falls back to the usual slot when the calendar does not reach that date', () => {
    expect(waiverStatusOn([], '2027-09-08')).toEqual({ status: 'usual', time: null });
  });
});

describe('teamNickname', () => {
  it('maps MFL codes onto the brand kit', () => {
    expect(teamNickname('GBP', { GB: { name: 'Green Bay Packers' } })).toBe('Packers');
    expect(teamNickname('XYZ', {})).toBe('XYZ');
  });
});
