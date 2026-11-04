/**
 * The AFL live board's sectioned Standings tab: tiers on all-play, divisions
 * on head-to-head, one Live / Projected / Final switch.
 *
 * `src/utils/live/standings-sections.ts` (the views) and
 * `src/utils/live/afl-live-standings.ts` (which tables, and the all-play base).
 */
import { describe, it, expect } from 'vitest';
import {
  projectAllPlaySection,
  projectRecordSection,
  weekScores,
} from '../src/utils/live/standings-sections';
import {
  buildAflStandingsSections,
  buildAllPlayBase,
  readAflLiveStandings,
} from '../src/utils/live/afl-live-standings';
import type {
  LiveAllPlayBase,
  LiveMatchup,
  LiveStandingsRow,
  LiveStandingsSection,
  LiveTeam,
} from '../src/types/live';

const row = (franchiseId: string, rank: number, wins = 0, losses = 0, pointsFor = 0): LiveStandingsRow => ({
  franchiseId,
  rank,
  name: `Team ${franchiseId}`,
  nameShort: '',
  initials: '',
  icon: '',
  iconAlt: '',
  rung: 'text',
  wins,
  losses,
  ties: 0,
  pointsFor,
  isViewer: false,
  weekGamesCounted: 0,
});

const side = (franchiseId: string, live: number, projectedFinal = live, secondsRemaining = 1800): LiveTeam => ({
  franchiseId,
  name: franchiseId,
  nameShort: franchiseId,
  initials: '',
  icon: '',
  iconAlt: '',
  rung: 'text',
  live,
  projectedFinal,
  remainingPoints: projectedFinal - live,
  yetToPlay: 0,
  players: [{ secondsRemaining } as LiveTeam['players'][number]],
  bench: [],
});

const matchup = (a: LiveTeam, b: LiveTeam, index = 0): LiveMatchup => ({
  index,
  sides: [a, b],
  viewerSide: null,
  p0: 0.5,
  colorVars: {},
});

const rows = ['A', 'B', 'C', 'D'].map((id, i) => row(id, i + 1));
const rowsById = new Map(rows.map((r) => [r.franchiseId, r]));

// A "tier" of A and B; C and D are in the other tier but still all-played.
const tier: LiveStandingsSection = {
  id: 'tier-top',
  title: 'Top',
  basis: 'all-play',
  franchiseIds: ['A', 'B'],
  zones: [null, { tone: 'down', label: 'Relegated' }],
};
const base: LiveAllPlayBase = {
  records: {
    A: { wins: 6, losses: 0, ties: 0, pointsFor: 300 },
    B: { wins: 5, losses: 1, ties: 0, pointsFor: 290 },
    C: { wins: 1, losses: 5, ties: 0, pointsFor: 200 },
    D: { wins: 0, losses: 6, ties: 0, pointsFor: 190 },
  },
  weekCounted: false,
  weekInCompetition: true,
};
// B outscores everybody this week; A scores least.
const week = [matchup(side('A', 10, 100), side('C', 50, 50)), matchup(side('B', 90, 90), side('D', 40, 40), 1)];

describe('all-play sections', () => {
  it('Final is the official order with its zones', () => {
    const out = projectAllPlaySection(rowsById, tier, base, week, 'final');
    expect(out.rows.map((r) => [r.franchiseId, r.wins, r.losses, r.zone?.label ?? null])).toEqual([
      ['A', 6, 0, null],
      ['B', 5, 1, 'Relegated'],
    ]);
    expect(out.addsWeek).toBe(false);
  });

  it('Live scores the week against EVERY team, league-wide, and the zone follows the position', () => {
    const out = projectAllPlaySection(rowsById, tier, base, week, 'live');
    // B beats A, C and D (3-0); A loses to all three (0-3).
    expect(out.rows.map((r) => [r.franchiseId, r.wins, r.losses, r.pointsFor, r.move])).toEqual([
      ['B', 8, 1, 380, 1],
      ['A', 6, 3, 310, -1],
    ]);
    expect(out.rows[1].zone?.label).toBe('Relegated');
    expect(out.addsWeek).toBe(true);
  });

  it('Projected uses projected finals', () => {
    const out = projectAllPlaySection(rowsById, tier, base, week, 'projected');
    // A projects 100: beats B (90), C (50), D (40).
    expect(out.rows[0]).toMatchObject({ franchiseId: 'A', wins: 9, losses: 0 });
  });

  it('never adds a week the base already holds, or one past the competition', () => {
    for (const b of [{ ...base, weekCounted: true }, { ...base, weekInCompetition: false }]) {
      const out = projectAllPlaySection(rowsById, tier, b, week, 'live');
      expect(out.rows.map((r) => r.franchiseId)).toEqual(['A', 'B']);
      expect(out.addsWeek).toBe(false);
    }
  });

  it('Live adds nothing before a game starts', () => {
    const unplayed = [matchup(side('A', 0, 100, 3600), side('C', 0, 50, 3600))];
    expect(weekScores(unplayed, 'live')).toBeNull();
  });

  it('a doubleheader is one weekly score, not two', () => {
    const dh = [matchup(side('A', 80), side('C', 50)), matchup(side('A', 80), side('D', 40), 1)];
    expect([...weekScores(dh, 'live')!]).toEqual([
      ['A', 80],
      ['C', 50],
      ['D', 40],
    ]);
  });
});

describe('record sections', () => {
  it('numbers the division from 1 and re-ranks on its own head-to-head', () => {
    const div: LiveStandingsSection = { id: 'd', title: 'AL North', basis: 'record', franchiseIds: ['C', 'D'] };
    const own = new Map([
      ['C', row('C', 3, 4, 2, 500)],
      ['D', row('D', 4, 4, 2, 480)],
    ]);
    const final = projectRecordSection(own, div, [matchup(side('C', 10), side('D', 60))], 'final');
    expect(final.rows.map((r) => [r.franchiseId, r.rank])).toEqual([['C', 1], ['D', 2]]);
    const live = projectRecordSection(own, div, [matchup(side('C', 10), side('D', 60))], 'live');
    expect(live.rows.map((r) => [r.franchiseId, r.rank, r.officialRank])).toEqual([['D', 1, 2], ['C', 2, 1]]);
  });
});

describe('the AFL all-play base', () => {
  // Three teams: each all-plays two others a week.
  const feedRows = [
    { id: '0001', all_play_wlt: '4-0-0', pf: '300' },
    { id: '0002', all_play_wlt: '2-2-0', pf: '250' },
    { id: '0003', all_play_wlt: '0-4-0', pf: '200' },
  ];

  it("reads MFL's own column and counts its weeks", () => {
    const b = buildAllPlayBase({ feedRows, weeklyResults: null, boardWeek: 3, cutoffWeek: 17 })!;
    expect(b.records['0001']).toEqual({ wins: 4, losses: 0, ties: 0, pointsFor: 300 });
    expect(b.weekCounted).toBe(false);
    expect(b.weekInCompetition).toBe(true);
  });

  it('knows when MFL has already folded in the board week', () => {
    expect(buildAllPlayBase({ feedRows, weeklyResults: null, boardWeek: 2, cutoffWeek: 17 })!.weekCounted).toBe(true);
  });

  it("fills only the weeks MFL's column does not carry, never the board week", () => {
    const weeklyResults = {
      weeks: [
        { week: 2, scores: { '0001': 1, '0002': 99, '0003': 50 } }, // already in MFL's 2 weeks
        { week: 3, scores: { '0001': 10, '0002': 30, '0003': 20 } }, // missing: fill it
        { week: 4, scores: { '0001': 99, '0002': 0, '0003': 0 } }, // the board week: never
      ],
    };
    const b = buildAllPlayBase({ feedRows, weeklyResults, boardWeek: 4, cutoffWeek: 17 })!;
    expect(b.records['0001']).toMatchObject({ wins: 4, losses: 2 });
    expect(b.records['0002']).toMatchObject({ wins: 4, losses: 2 });
    expect(b.records['0003']).toMatchObject({ wins: 1, losses: 5 });
  });

  it('a missing column is a failed read, not a season of zeros', () => {
    expect(buildAllPlayBase({ feedRows: [{ id: '0001' }, { id: '0002' }], weeklyResults: null, boardWeek: 3, cutoffWeek: 17 })).toBeNull();
  });
});

describe('the AFL tables', () => {
  const ids = Array.from({ length: 24 }, (_, i) => String(i + 1).padStart(4, '0'));
  const feedRows = ids.map((id) => ({ id, pwr: '0' }));
  const conferences = [
    { name: 'American League', code: '00', divisions: ['North', 'South'] },
    { name: 'National League', code: '01', divisions: ['East', 'West'] },
  ];
  const divisions = ['North', 'South', 'East', 'West'];
  const teams = ids.map((franchiseId, i) => ({ franchiseId, division: divisions[i % 4] }));
  const membership = Object.fromEntries(ids.map((id, i) => [id, i < 12 ? 'Premier League' : 'D-League']));
  const allPlay: LiveAllPlayBase = {
    records: Object.fromEntries(ids.map((id, i) => [id, { wins: 100 - i, losses: i, ties: 0, pointsFor: 0 }])),
    weekCounted: false,
    weekInCompetition: true,
  };
  const built = buildAflStandingsSections({
    feedRows,
    config: { teams, conferences },
    tierMembership: membership,
    allPlay,
    viewerFranchiseId: '0004', // West
    leagueSlug: 'afl-fantasy',
  });

  it('tiers first, then divisions with the viewer’s own first', () => {
    expect(built.groups.map((g) => g.id)).toEqual(['tiers', 'divisions']);
    expect(built.groups[0].sections.map((s) => s.title)).toEqual(['Premier League', 'D-League']);
    expect(built.groups[1].sections.map((s) => s.title)).toEqual(['NL West', 'AL North', 'AL South', 'NL East']);
  });

  it("the constitution's zones on each tier", () => {
    const [premier, dleague] = built.groups[0].sections;
    const labels = (s: LiveStandingsSection) => s.zones!.map((z) => z?.label ?? null);
    expect(labels(premier).slice(8)).toEqual(['Relegation playoff', 'Relegation playoff', 'Relegated', 'Relegated']);
    expect(labels(dleague).slice(0, 4)).toEqual(['Promoted', 'Promoted', 'Promotion playoff', 'Promotion playoff']);
    expect(labels(dleague)[11]).toBe('Name change');
  });

  it('every other league keeps its board unchanged', async () => {
    await expect(
      readAflLiveStandings({ slug: 'theleague', year: 2026, week: 9, viewerFranchiseId: null }),
    ).resolves.toBeUndefined();
  });
});
