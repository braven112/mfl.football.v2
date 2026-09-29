/**
 * The package-league homepage's view models: the team snapshot and the What's
 * Next calendar (the hero is the shared league hero — tests/league-hero.test.ts) (src/utils/package-league-home.ts,
 * src/utils/package-league-events.ts). Pinned against archies' real 2026
 * feeds, which carry doubleheader weeks — every "this week" must be a LIST.
 */
import { describe, expect, it } from 'vitest';
import schedule from '../data/archies/mfl-feeds/2026/schedule.json';
import standings from '../data/archies/mfl-feeds/2026/standings.json';
import brackets from '../data/archies/mfl-feeds/2026/playoff-brackets.json';
import config from '../data/archies/archies.config.json';
import { buildTeamSnapshot, weekInTheBooks } from '../src/utils/package-league-home';
import { buildPackageLeagueEvents, packageWhatsNext } from '../src/utils/package-league-events';
import { groupStandingsByDivision } from '../src/utils/package-league';
import { parseWeeklySchedule } from '../src/utils/schedule-data.mjs';
import { getLeagueBySlug } from '../src/config/leagues';

const league = getLeagueBySlug('archies')!;
const groups = groupStandingsByDivision(standings, config.teams as any, (config as any).divisions ?? []);

describe('weekInTheBooks', () => {
  it('lists a doubleheader team once, by its best game', () => {
    const b = weekInTheBooks(parseWeeklySchedule(schedule))!;
    expect(b).not.toBeNull();
    expect(b.top.score).toBeGreaterThanOrEqual(b.low.score);
    expect(b.blowout!.margin).toBeGreaterThanOrEqual(b.nailBiter!.margin);
  });
});

describe('buildTeamSnapshot', () => {
  it('places the viewer in their division', () => {
    const snap = buildTeamSnapshot(groups, schedule, '0014', 14)!;
    expect(snap.row.franchiseId).toBe('0014');
    expect(snap.divisionSize).toBeGreaterThan(1);
    expect(snap.games.next?.games.length).toBe(2);
  });

  it('is null for no viewer or a franchise not in the league', () => {
    expect(buildTeamSnapshot(groups, schedule, null, null)).toBeNull();
    expect(buildTeamSnapshot(groups, schedule, '9999', null)).toBeNull();
  });
});

describe('buildPackageLeagueEvents', () => {
  const now = new Date('2026-09-28T12:00:00-07:00');

  it('derives kickoff, playoffs, championship and the new league year without an MFL calendar', () => {
    const events = buildPackageLeagueEvents({ league, seasons: [{ seasonYear: 2026, calendar: null, playoffBrackets: brackets }], referenceDate: now });
    const names = events.map((e) => e.definition.name);
    expect(names).toEqual(expect.arrayContaining(['Week 1 kicks off', 'Playoffs begin', 'Championship week', 'New league year']));
    const po = events.find((e) => e.definition.name === 'Playoffs begin')!;
    const champ = events.find((e) => e.definition.name === 'Championship week')!;
    expect(champ.startDate.getTime()).toBeGreaterThan(po.startDate.getTime());
    // Sorted by start date.
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i].startDate.getTime()).toBeGreaterThanOrEqual(events[i - 1].startDate.getTime());
    }
  });

  it('reads the MFL calendar: timestamps and week numbers, skipping waiver noise and untitled customs', () => {
    const calendar = [
      { id: '1', type: 'DRAFT_START_DIVISION00', start_time: '1788031800', end_time: '' },
      { id: '2', type: 'TRADE', start_time: '11', end_time: '' },
      { id: '3', type: 'WAIVER_LOCK', start_time: '1788105600', end_time: '' },
      { id: '4', type: 'CUSTOM', title: 'Dues due', start_time: '1783914300', end_time: '' },
      { id: '5', type: 'CUSTOM', title: '', start_time: '1783914300', end_time: '' },
    ];
    const events = buildPackageLeagueEvents({ league, seasons: [{ seasonYear: 2026, calendar }], referenceDate: now });
    const names = events.map((e) => e.definition.name);
    expect(names).toEqual(expect.arrayContaining(['Draft', 'Trade deadline', 'Dues due']));
    expect(names.filter((n) => n === '')).toEqual([]);
    expect(events.some((e) => e.definition.id.includes('-mfl-3-'))).toBe(false);
  });

  it('feeds a forward-looking timeline', () => {
    const events = buildPackageLeagueEvents({
      league,
      seasons: [2026, 2027].map((seasonYear) => ({ seasonYear, playoffBrackets: brackets })),
      referenceDate: now,
    });
    const t = packageWhatsNext(events, now, 2026);
    expect(t.current).not.toBeNull();
    expect(t.current!.isPast).toBe(false);
  });
});
