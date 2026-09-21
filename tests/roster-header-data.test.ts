import { describe, expect, it } from 'vitest';
import {
  buildTeamGroups,
  buildSeasonRail,
  topPlayerBySalary,
  bestPlayerByPositionRank,
  positionalRanks,
  compactSalary,
} from '../src/utils/roster-header-data';
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

/**
 * The header's featured player. Which player it is depends on what the league
 * HAS: a cap league shows the biggest contract, a league with no salaries at
 * all (the AFL) shows who ranks best at his own position.
 */
describe('the featured player', () => {
  const roster = [
    { id: '1', name: 'Saquon Barkley', position: 'RB', salary: 7200000, headshot: '/a.png' },
    { id: '2', name: 'Jake Ferguson', position: 'TE', salary: 4207142.5 },
    { id: '3', name: 'Bo Nix', position: 'QB', salary: 968000 },
    { id: '4', name: 'A Kicker', position: 'PK', salary: 9000000 },
  ];

  describe('in a salary league', () => {
    it('is the biggest contract', () => {
      expect(topPlayerBySalary(roster)).toMatchObject({
        name: 'A Kicker',
        statValue: '$9.0M',
        statLabel: 'Top salary',
      });
    });

    it('carries the headshot when there is one, and null when there is not', () => {
      expect(topPlayerBySalary([roster[0]])!.headshot).toBe('/a.png');
      expect(topPlayerBySalary([roster[1]])!.headshot).toBeNull();
    });

    it('is null when nobody has a salary — which is every non-cap league', () => {
      expect(topPlayerBySalary([{ id: '1', name: 'X', position: 'RB' }])).toBeNull();
      expect(topPlayerBySalary([{ id: '1', name: 'X', position: 'RB', salary: 0 }])).toBeNull();
      expect(topPlayerBySalary([])).toBeNull();
    });
  });

  describe('in a league with no salaries', () => {
    // Nix is QB8, Barkley RB2, Ferguson TE1 -> Ferguson wins on positional rank.
    const rankOf = (id: string) => ({ '1': 2, '2': 1, '3': 8, '4': 1 }[id] ?? null);

    it('is whoever ranks best at his own position', () => {
      expect(bestPlayerByPositionRank(roster, rankOf)).toMatchObject({
        name: 'Jake Ferguson',
        statValue: 'TE1',
        statLabel: 'Best at position',
      });
    });

    it('never picks a kicker or defence, however well they rank', () => {
      // The kicker is also rank 1 and listed after Ferguson; skipping the
      // position entirely is what keeps him out, not tie-break luck.
      const kickerOnly = [{ id: '4', name: 'A Kicker', position: 'PK' }];
      expect(bestPlayerByPositionRank(kickerOnly, () => 1)).toBeNull();
      const withDef = [{ id: '5', name: 'A Defence', position: 'DEF' }];
      expect(bestPlayerByPositionRank(withDef, () => 1)).toBeNull();
    });

    it('skips a player the ranking does not know rather than calling him best', () => {
      // An unranked player is unknown, not rank 0.
      expect(bestPlayerByPositionRank([roster[0]], () => null)).toBeNull();
    });

    it('is null on an empty roster', () => {
      expect(bestPlayerByPositionRank([], () => 1)).toBeNull();
    });
  });

  describe('positionalRanks', () => {
    const pool = [
      { id: 'a', position: 'WR', score: 200 },
      { id: 'b', position: 'WR', score: 300 },
      { id: 'c', position: 'QB', score: 400 },
      { id: 'd', position: 'PK', score: 999 },
    ];

    it('ranks within a position, best first', () => {
      const r = positionalRanks(pool);
      expect(r.get('b')).toBe(1);
      expect(r.get('a')).toBe(2);
      expect(r.get('c')).toBe(1);
    });

    it('leaves out positions the header never features', () => {
      expect(positionalRanks(pool).has('d')).toBe(false);
    });

    it('ignores a player with no usable score', () => {
      expect(positionalRanks([{ id: 'x', position: 'WR', score: NaN }]).has('x')).toBe(false);
    });
  });

  describe('compactSalary', () => {
    it('reads at a glance at every magnitude', () => {
      expect(compactSalary(7200000)).toBe('$7.2M');
      expect(compactSalary(968000)).toBe('$968K');
      expect(compactSalary(450)).toBe('$450');
      expect(compactSalary(-2400000)).toBe('-$2.4M');
      expect(compactSalary(Number.NaN)).toBe('—');
    });
  });
});
