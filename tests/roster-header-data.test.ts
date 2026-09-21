import { describe, expect, it } from 'vitest';
import { buildTeamGroups, buildSeasonRail } from '../src/utils/roster-header-data';
import { franchiseSchedule, parseWeeklySchedule } from '../src/utils/schedule-data.mjs';
import aflConfig from '../data/afl-fantasy/afl.config.json';
import tlConfig from '../src/data/theleague.config.json';

/**
 * The roster header's team switcher. The two leagues nest differently, and the
 * difference is load-bearing: the AFL's two conferences use DISJOINT division
 * names (American runs North/South, National runs East/West), so a flat
 * division grouping would merge clubs under labels that do not mean the same
 * thing in both halves of the league.
 */
describe('buildTeamGroups', () => {
  it('gives a single-table league one group with no conference rail', () => {
    const groups = buildTeamGroups({
      teams: tlConfig.teams,
      conferences: null,
      divisions: tlConfig.divisions,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].conferenceId).toBeNull();
    expect(groups[0].conferenceName).toBeNull();
    expect(groups[0].divisions.map((d) => d.name)).toEqual(tlConfig.divisions);
  });

  it('carries a short code for the vertical rail', () => {
    const groups = buildTeamGroups({
      teams: aflConfig.teams,
      conferences: aflConfig.conferences,
      viewerConference: '00',
    });
    // "American League" set vertically is taller than the crest row, so the
    // rail shows the code and keeps the full name as its accessible label.
    expect(groups.map((g) => g.conferenceShort)).toEqual(['AL', 'NL']);
  });

  it('has no conference rail in a single-table league', () => {
    const groups = buildTeamGroups({
      teams: tlConfig.teams,
      conferences: null,
      divisions: tlConfig.divisions,
    });
    expect(groups[0].conferenceShort).toBeNull();
  });

  it('nests division inside conference for the AFL', () => {
    const groups = buildTeamGroups({
      teams: aflConfig.teams,
      conferences: aflConfig.conferences,
      viewerConference: '00',
    });
    expect(groups.map((g) => g.conferenceName)).toEqual(['American League', 'National League']);
    expect(groups[0].divisions.map((d) => d.name)).toEqual(['North', 'South']);
    expect(groups[1].divisions.map((d) => d.name)).toEqual(['East', 'West']);
  });

  it('leads with the viewer’s own conference', () => {
    const nl = buildTeamGroups({
      teams: aflConfig.teams,
      conferences: aflConfig.conferences,
      viewerConference: '01',
    });
    expect(nl.map((g) => g.conferenceName)).toEqual(['National League', 'American League']);
  });

  it('keeps the historical order for a viewer with no conference', () => {
    for (const viewer of [null, undefined]) {
      const groups = buildTeamGroups({
        teams: aflConfig.teams,
        conferences: aflConfig.conferences,
        viewerConference: viewer,
      });
      expect(groups.map((g) => g.conferenceId)).toEqual(['00', '01']);
    }
  });

  /**
   * A club missing from the switcher is unreachable, which is a worse failure
   * than one under an unexpected heading. Whatever the ordering, every club
   * must appear exactly once.
   */
  it('never drops or duplicates a club, in either league or any order', () => {
    const cases = [
      { teams: tlConfig.teams, conferences: null, divisions: tlConfig.divisions },
      { teams: aflConfig.teams, conferences: aflConfig.conferences, viewerConference: '00' },
      { teams: aflConfig.teams, conferences: aflConfig.conferences, viewerConference: '01' },
      { teams: aflConfig.teams, conferences: aflConfig.conferences, viewerConference: null },
    ];
    for (const input of cases) {
      const ids = buildTeamGroups(input as any)
        .flatMap((g) => g.divisions)
        .flatMap((d) => d.teams.map((t) => t.franchiseId));
      expect(ids).toHaveLength(input.teams.length);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('surfaces a division the config forgot rather than dropping its clubs', () => {
    const groups = buildTeamGroups({
      teams: [
        { franchiseId: '0001', name: 'A', division: 'Known' },
        { franchiseId: '0002', name: 'B', division: 'Undeclared' },
      ],
      conferences: null,
      divisions: ['Known'],
    });
    expect(groups[0].divisions.map((d) => d.name)).toEqual(['Known', 'Undeclared']);
  });
});

describe('buildSeasonRail', () => {
  const feed = {
    schedule: {
      weeklySchedule: [
        {
          week: '1',
          matchup: [
            {
              franchise: [
                { id: '0001', isHome: '1', result: 'W', score: '120.5' },
                { id: '0002', isHome: '0', result: 'L', score: '99.0' },
              ],
            },
          ],
        },
        {
          // 0001 is on bye — the week exists but it plays nobody.
          week: '2',
          matchup: [
            {
              franchise: [
                { id: '0003', isHome: '1', result: 'W', score: '110.0' },
                { id: '0002', isHome: '0', result: 'L', score: '90.0' },
              ],
            },
          ],
        },
        {
          week: '3',
          matchup: [
            {
              franchise: [
                { id: '0001', isHome: '0', result: 'T' },
                { id: '0003', isHome: '1', result: 'T' },
              ],
            },
          ],
        },
      ],
    },
  };
  const weeks = parseWeeklySchedule(feed);
  const rail = buildSeasonRail(
    franchiseSchedule(weeks, '0001'),
    weeks.map((w) => w.week),
    3,
  );

  it('keeps one slot per scheduled week so every club’s rail is the same width', () => {
    expect(rail.map((r) => r.week)).toEqual([1, 2, 3]);
  });

  it('marks a bye week as unplayed with no opponent', () => {
    expect(rail[1]).toMatchObject({ week: 2, played: false, outcome: null, opponentId: null });
  });

  it('does not treat an unplayed game as a result', () => {
    expect(rail[2]).toMatchObject({ week: 3, played: false, outcome: null, isCurrent: true });
  });

  it('carries the outcome of a played week', () => {
    expect(rail[0]).toMatchObject({ week: 1, played: true, outcome: 'W', opponentId: '0002' });
  });
});
