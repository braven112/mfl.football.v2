/**
 * Every live board's sectioned Standings tab: divisions on head-to-head, the
 * AFL's tiers on all-play, Archie's MAD POWER 99 on Victory Points, one
 * Live / Projected / Final switch.
 *
 * `src/utils/live/standings-sections.ts` (the views),
 * `src/utils/live/league-live-standings.ts` (which tables each league gets) and
 * `src/utils/live/afl-live-standings.ts` (the tiers and their all-play base).
 */
import { describe, it, expect } from 'vitest';
import {
  projectAllPlaySection,
  projectMadSection,
  projectRecordSection,
  weekScores,
  weekVictoryPoints,
} from '../src/utils/live/standings-sections';
import { buildAllPlayBase, buildTierSections } from '../src/utils/live/afl-live-standings';
import {
  buildDivisionSections,
  buildMadSection,
  buildOwnDivisionSection,
  fillPointsFor,
  parseVictoryPointRules,
} from '../src/utils/live/league-live-standings';
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

  it('Live gives a team yet to play no all-play result, never a 0-0 tie', () => {
    // A has played; B is on the board at 0 with every starter yet to kick off.
    const NOT_STARTED = 3600;
    const board = [
      matchup(side('A', 30), side('C', 20)),
      matchup(side('B', 0, 90, NOT_STARTED), side('D', 0, 80, NOT_STARTED), 1),
    ];
    const scores = weekScores(board, 'live')!;
    expect([...scores.keys()].sort()).toEqual(['A', 'C']);
    // Projected still counts everyone.
    expect(weekScores(board, 'projected')!.size).toBe(4);
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

describe('the AFL tiers', () => {
  const ids = Array.from({ length: 24 }, (_, i) => String(i + 1).padStart(4, '0'));
  const feedRows = ids.map((id) => ({ id, pwr: '0' }));
  const membership = Object.fromEntries(ids.map((id, i) => [id, i < 12 ? 'Premier League' : 'D-League']));
  const allPlay: LiveAllPlayBase = {
    records: Object.fromEntries(ids.map((id, i) => [id, { wins: 100 - i, losses: i, ties: 0, pointsFor: 0 }])),
    weekCounted: false,
    weekInCompetition: true,
  };
  const tiers = buildTierSections({
    feedRows,
    teamTier: (id) => membership[id],
    allPlay,
    leagueSlug: 'afl-fantasy',
  });

  it('Premier League, then D-League', () => {
    expect(tiers.map((s) => s.title)).toEqual(['Premier League', 'D-League']);
  });

  it("the constitution's zones on each tier", () => {
    const [premier, dleague] = tiers;
    const labels = (s: LiveStandingsSection) => s.zones!.map((z) => z?.label ?? null);
    expect(labels(premier).slice(8)).toEqual(['Relegation playoff', 'Relegation playoff', 'Relegated', 'Relegated']);
    expect(labels(dleague).slice(0, 4)).toEqual(['Promoted', 'Promoted', 'Promotion playoff', 'Promotion playoff']);
    expect(labels(dleague)[11]).toBe('Name change');
  });
});

describe('division tables, every league', () => {
  const ids = Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(4, '0'));

  it('the AFL: conference-prefixed, the viewer’s own first', () => {
    const divisions = ['North', 'South', 'East', 'West'];
    const sections = buildDivisionSections({
      order: ids,
      config: {
        teams: ids.map((franchiseId, i) => ({ franchiseId, division: divisions[i % 4] })),
        conferences: [
          { name: 'American League', code: '00', divisions: ['North', 'South'] },
          { name: 'National League', code: '01', divisions: ['East', 'West'] },
        ],
      },
      viewerFranchiseId: '0004', // West
    });
    expect(sections.map((s) => s.title)).toEqual(['NL West', 'AL North', 'AL South', 'NL East']);
  });

  it("TheLeague: plain string divisions, MFL's order kept inside each", () => {
    const divisions = ['Northwest', 'Southwest', 'Central', 'East'];
    const order = ids.slice().reverse();
    const sections = buildDivisionSections({
      order,
      config: { divisions, teams: ids.map((franchiseId, i) => ({ franchiseId, division: divisions[i % 4] })) },
      viewerFranchiseId: null,
    });
    expect(sections.map((s) => s.title)).toEqual(divisions);
    expect(sections[0].franchiseIds).toEqual(['0013', '0009', '0005', '0001']);
    expect(sections.every((s) => s.basis === 'record')).toBe(true);
  });

  it("Archie's-shaped object divisions read by name", () => {
    const sections = buildDivisionSections({
      order: ids.slice(0, 2),
      config: {
        divisions: [{ id: '00', name: 'Barry Sanders Division' }],
        teams: [
          { franchiseId: '0001', division: 'Barry Sanders Division' },
          { franchiseId: '0002', division: 'Barry Sanders Division' },
        ],
      },
      viewerFranchiseId: null,
    });
    expect(sections.map((s) => [s.title, s.franchiseIds])).toEqual([['Barry Sanders Division', ['0001', '0002']]]);
  });

  it("Archie's: only the viewer's own division, none signed out", () => {
    const config = {
      divisions: [{ name: 'A' }, { name: 'B' }],
      teams: ids.map((franchiseId, i) => ({ franchiseId, division: i % 2 ? 'B' : 'A' })),
    };
    const own = buildOwnDivisionSection({ order: ids, config, viewerFranchiseId: '0002' });
    expect(own.map((s) => s.title)).toEqual(['B']);
    expect(buildOwnDivisionSection({ order: ids, config, viewerFranchiseId: null })).toEqual([]);
  });

  it('no divisions declared (best ball): no tables, so the single league table', () => {
    expect(buildDivisionSections({ order: ids, config: { teams: [] }, viewerFranchiseId: null })).toEqual([]);
  });
});

describe("Archie's MAD POWER 99", () => {
  // Two divisions of three; one leader and one runner-up seeded each, one wild card.
  const ids = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];
  const divisionOf: Record<string, string> = { M1: 'X', M2: 'Y', M3: 'X', M4: 'Y', M5: 'X', M6: 'Y' };
  const vp = [40, 38, 30, 28, 20, 18];
  const madRows = ids.map((id, i) => ({ ...row(id, i + 1, 0, 0, 1000 - i * 10), victoryPoints: vp[i] }));
  const madById = new Map(madRows.map((r) => [r.franchiseId, r]));
  const section = buildMadSection({
    order: ids,
    config: { teams: ids.map((franchiseId) => ({ franchiseId, division: divisionOf[franchiseId] })) },
    seeding: { divisionLeaders: 2, runnersUp: 2, wildCards: 1 },
  });
  const rules = { win: 2, loss: 0, tie: 1, buckets: [3, 2, 1] };

  it('Final seeds MFL’s order: leaders, runners-up, wild card, field', () => {
    const view = projectMadSection(madById, section, rules, [], 'final');
    expect(view.rows.map((r) => r.franchiseId)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6']);
    expect(view.rows.map((r) => r.zone?.label ?? null)).toEqual([
      'Division leader',
      'Division leader',
      'Runner-up',
      'Runner-up',
      'Wild card',
      null,
    ]);
    expect(view.addsWeek).toBe(false);
  });

  it('collapses after the seeds plus a few, never on a short table', () => {
    expect(section.collapseAfter).toBeUndefined(); // 5 seeds + 3 > 6 teams
    const big = buildMadSection({
      order: Array.from({ length: 99 }, (_, i) => `${i}`),
      config: { teams: [] },
      seeding: { divisionLeaders: 9, runnersUp: 9, wildCards: 12 },
    });
    expect(big.collapseAfter).toBe(33);
  });

  it('Live adds per-game VP plus the weekly bucket, then re-seeds', () => {
    // M5 beats M1 and tops the week; M6 beats M2; M3 beats M4.
    const board = [
      matchup(side('M5', 150), side('M1', 60)),
      matchup(side('M6', 140), side('M2', 50), 1),
      matchup(side('M3', 100), side('M4', 90), 2),
    ];
    const week = weekVictoryPoints(madById, rules, board, 'live')!;
    expect(week.get('M5')).toEqual({ vp: 2 + 3, points: 150 });
    expect(week.get('M2')).toEqual({ vp: 0 + 1, points: 50 });
    const view = projectMadSection(madById, section, rules, board, 'live');
    // M1 40+0+1, M3 30+2+2, M5 18+... — X's order holds.
    const byId = new Map(view.rows.map((r) => [r.franchiseId, r]));
    expect(byId.get('M1')!.victoryPoints).toBe(41);
    expect(byId.get('M3')!.victoryPoints).toBe(34);
    expect(byId.get('M5')!.victoryPoints).toBe(25);
    // Y: M2 38+0+1, M4 28+0+2, M6 18+2+2 — its order holds too.
    expect(view.rows.map((r) => r.franchiseId)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6']);
    expect(view.addsWeek).toBe(true);
  });

  it('a team that takes its division live moves into the leaders and says so', () => {
    // M2 sits on 29: M4 (28+2+3=33) beats it head-to-head and passes it
    // (29+0+1=30) for Y's lead.
    const close = new Map(madById);
    close.set('M2', { ...madById.get('M2')!, victoryPoints: 29 });
    const board = [
      matchup(side('M4', 150), side('M2', 50)),
      matchup(side('M1', 140), side('M3', 60), 1),
      matchup(side('M5', 100), side('M6', 90), 2),
    ];
    const view = projectMadSection(close, section, rules, board, 'live');
    const m4 = view.rows.find((r) => r.franchiseId === 'M4')!;
    expect(m4.zone?.label).toBe('Division leader');
    expect(m4.rank).toBe(2);
    expect(m4.officialRank).toBe(4);
    expect(m4.move).toBe(2);
  });

  it('never adds a week MFL already counted', () => {
    const counted = new Map([...madById].map(([id, r]) => [id, { ...r, weekGamesCounted: 1 }]));
    const board = [matchup(side('M5', 150, 150, 0), side('M1', 60, 60, 0))];
    expect(weekVictoryPoints(counted, rules, board, 'live')).toBeNull();
  });

  it("reads the rules from MFL's league settings", () => {
    expect(
      parseVictoryPointRules({
        league: { victoryPointsWin: '2', victoryPointsLoss: '0', victoryPointsTie: '1', victoryPointsBuckets: '3 2 1' },
      }),
    ).toEqual(rules);
    expect(parseVictoryPointRules({ league: {} })).toBeUndefined();
  });
});

describe('Points For where the public export hides it', () => {
  it("takes the snapshot's pf for an unchanged record, else avgpf × weeks", () => {
    const committed = [
      { id: '0001', h2hw: '14', h2hl: '2', h2ht: '0', pf: '1216.11', avgpf: '152.0' },
      { id: '0002', h2hw: '12', h2hl: '4', h2ht: '0', pf: '1403.20', avgpf: '175.4' },
    ];
    const live = [
      { id: '0001', h2hw: '14', h2hl: '2', h2ht: '0', avgpf: '152.0' },
      // One more week (two games) than the snapshot.
      { id: '0002', h2hw: '14', h2hl: '4', h2ht: '0', avgpf: '170.0' },
    ];
    const filled = fillPointsFor(live, committed);
    expect(filled[0].pf).toBe('1216.11');
    expect(filled[1].pf).toBe('1530.00');
  });

  it('leaves a feed that carries pf alone', () => {
    const live = [{ id: '0001', pf: '10' }];
    expect(fillPointsFor(live, [])).toBe(live);
  });
});
