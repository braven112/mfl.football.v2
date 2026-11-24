import { describe, expect, it } from 'vitest';
import {
  findSeasonQuirks,
  newUpcomingGames,
  runsWaiversMidweek,
  teamNickname,
  usualMidweekRun,
  waiverStatusOn,
} from '../src/utils/nfl-season-quirks.mjs';
import { NFL_SEASON_QUIRKS } from '../src/data/nfl/season-quirks.mjs';

const epoch = (iso: string) => String(Date.parse(iso) / 1000);
const game = (iso: string, away: string, home: string) => ({
  kickoff: epoch(iso),
  team: [{ id: away, isHome: '0' }, { id: home, isHome: '1' }],
});
const BRAND = { GB: { name: 'Green Bay Packers' }, LAR: { name: 'Los Angeles Rams' } };

const WEEKS = [
  // Opener Thursday 5:20 PM PT, a Friday game, a Sunday game.
  {
    week: '1',
    matchup: [
      game('2025-09-05T00:20:00Z', 'DAL', 'PHI'),
      game('2025-09-06T00:00:00Z', 'KCC', 'LAC'),
      game('2025-09-07T17:00:00Z', 'NYG', 'WAS'),
    ],
  },
  // Wednesday 5:00 PM PT, then Thanksgiving Thursday.
  { week: '12', matchup: [game('2026-11-26T01:00:00Z', 'GBP', 'LAR'), game('2026-11-26T17:30:00Z', 'CHI', 'DET')] },
  // Monday 6:00 PM PT is Tuesday in UTC — must NOT count as Tuesday.
  { week: '13', matchup: [game('2026-12-08T02:00:00Z', 'NYG', 'DAL')] },
  // Christmas on a Wednesday (2024).
  { week: '17', matchup: [game('2024-12-25T18:00:00Z', 'KCC', 'PIT')] },
];

describe('findSeasonQuirks', () => {
  const quirks = findSeasonQuirks(WEEKS, BRAND);
  const byHome = (h: string) => quirks.find((q) => q.home === h);

  it('tags the opener, Friday, Wednesday and Christmas games by the Pacific date', () => {
    expect(byHome('PHI')?.tags).toEqual(['opener']);
    expect(byHome('LAC')?.tags).toEqual(['friday']);
    expect(byHome('LAR')).toMatchObject({ tags: ['wednesday'], date: '2026-11-25', time: '5:00 PM', homeName: 'Rams', awayName: 'Packers' });
    expect(byHome('PIT')?.tags).toEqual(['christmas', 'wednesday']);
  });

  it('skips ordinary Thursday, Sunday and Monday games', () => {
    expect(byHome('WAS')).toBeUndefined();
    expect(byHome('DET')).toBeUndefined();
    expect(byHome('DAL')).toBeUndefined();
  });

  it('marks only Tuesday and Wednesday games as affecting waivers', () => {
    expect(quirks.filter((q) => q.affectsWaivers).map((q) => q.home).sort()).toEqual(['LAR', 'PIT']);
  });
});

describe('newUpcomingGames', () => {
  const games = findSeasonQuirks(WEEKS, BRAND).filter((q) => q.affectsWaivers);
  const may = new Date('2024-05-14T00:00:00Z');
  it('reports a game once, and never one already played', () => {
    expect(newUpcomingGames(undefined, games, may)).toHaveLength(2);
    expect(newUpcomingGames(games, games, may)).toHaveLength(0);
    expect(newUpcomingGames(undefined, games, new Date('2026-11-27T00:00:00Z'))).toHaveLength(0);
  });
  it('treats a moved kickoff as a new game', () => {
    const moved = [{ ...games[0], kickoff: '2026-11-25T17:15:00-08:00' }];
    expect(newUpcomingGames(games, moved, may)).toHaveLength(1);
  });
});

describe('waiver calendar', () => {
  // TheLeague 2026: blind bid every Wednesday 7:00 PM PT for 14 more weeks.
  const calendar = [
    { type: 'WAIVER_LOCK', start_time: epoch('2026-09-13T17:00:00Z'), happens: '16' },
    { type: 'WAIVER_BBID', start_time: epoch('2026-09-17T02:00:00Z'), happens: '14' },
  ];
  it('reads the usual midweek run from the league calendar', () => {
    expect(runsWaiversMidweek(calendar)).toBe(true);
    expect(usualMidweekRun(calendar)).toEqual({ day: 'Wednesday', time: '7:00 PM' });
    // A Thursday run is not midweek.
    expect(runsWaiversMidweek([{ type: 'WAIVER_BBID', start_time: epoch('2026-09-18T02:00:00Z'), happens: '14' }])).toBe(false);
  });
  it('flags a run on a Wednesday game day, keeping wall-clock time across DST', () => {
    expect(waiverStatusOn(calendar, '2026-11-25')).toEqual({ status: 'conflict', day: 'Wednesday', time: '7:00 PM' });
  });
  it('flags the Wednesday run after a Tuesday game', () => {
    expect(waiverStatusOn(calendar, '2026-11-24')).toMatchObject({ status: 'conflict', day: 'Wednesday' });
  });
  it('knows when the run was already moved off that week', () => {
    // Weekly Wednesday run through Dec 2; the Dec 9 run is moved to Tuesday Dec 8.
    const movedCal = [
      { type: 'WAIVER_BBID', start_time: epoch('2026-09-17T02:00:00Z'), happens: '11' },
      { type: 'WAIVER_BBID', start_time: epoch('2026-12-09T03:00:00Z') }, // Tue Dec 8, 7 PM PT
      { type: 'WAIVER_BBID', start_time: epoch('2026-12-17T03:00:00Z') }, // Wed Dec 16, 7 PM PT
    ];
    expect(waiverStatusOn(movedCal, '2026-12-02')).toMatchObject({ status: 'conflict' });
    expect(waiverStatusOn(movedCal, '2026-12-09')).toEqual({ status: 'moved', day: null, time: null });
  });
  it('falls back to the usual slot when the calendar does not reach that date', () => {
    expect(waiverStatusOn([], '2027-09-08')).toEqual({ status: 'usual', day: null, time: null });
  });
});

describe('teamNickname', () => {
  it('maps MFL codes onto the brand kit', () => {
    expect(teamNickname('GBP', BRAND)).toBe('Packers');
    expect(teamNickname('XYZ', {})).toBe('XYZ');
  });
});

describe('generated season-quirks.mjs', () => {
  it('carries 2026’s two Wednesday games, both flagged for waivers', () => {
    const wed = (NFL_SEASON_QUIRKS[2026] ?? []).filter((q) => q.tags.includes('wednesday'));
    expect(wed.map((q) => q.date)).toEqual(['2026-09-09', '2026-11-25']);
    expect(wed.every((q) => q.affectsWaivers)).toBe(true);
  });
});
