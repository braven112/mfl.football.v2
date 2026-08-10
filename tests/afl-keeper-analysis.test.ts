import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildKeeperAnalysis,
  buildPlayersById,
  computeKdefExceptions,
  computeOptimalSeven,
  computeSeasonPoints,
  getDraftedPidsByFranchise,
  getUnitDraftedPidsByFranchise,
  getOpeningRosterPids,
  gradeFranchise,
  KDEF_GAP_THRESHOLD,
  reconstructKeepers,
  resolveOfficialKeepers,
  type MflPlayersFeed,
  type MflRostersFeed,
  type WeeklyResultsRaw,
} from '../src/utils/afl-keeper-analysis';

// --- Fixture builders (tiny synthetic league) ---

function playersFeed(
  players: Array<[id: string, name: string, position: string, team?: string]>
): MflPlayersFeed {
  return {
    players: {
      player: players.map(([id, name, position, team]) => ({ id, name, position, team })),
    },
  };
}

function week(
  weekNum: string,
  matchups: Array<{
    regularSeason?: string;
    franchises: Array<{ id: string; players: Array<[id: string, score: string]> }>;
  }>
): WeeklyResultsRaw[number] {
  return {
    weeklyResults: {
      week: weekNum,
      matchup: matchups.map((m) => ({
        regularSeason: m.regularSeason ?? '1',
        franchise: m.franchises.map((f) => ({
          id: f.id,
          player: f.players.map(([id, score]) => ({ id, score })),
        })),
      })),
    },
  };
}

function rostersFeed(rosters: Record<string, string[]>): MflRostersFeed {
  return {
    rosters: {
      franchise: Object.entries(rosters).map(([id, pids]) => ({
        id,
        player: pids.map((pid) => ({ id: pid })),
      })),
    },
  };
}

describe('buildPlayersById', () => {
  it('carries espn_id through as espnId for the headshot cascade', () => {
    const prev = {
      players: { player: [{ id: '100', name: 'Hall, Breece', position: 'RB', team: 'NYJ', espn_id: '4427366' }] },
    };
    const cur = { players: { player: [{ id: '100', name: 'Hall, Breece', position: 'RB', team: 'NYJ' }] } };
    const byId = buildPlayersById(prev, cur);
    // cur-year record has no espn_id — the prev-year value must survive the overlay
    expect(byId.get('100')?.espnId).toBe('4427366');
  });
});

describe('computeSeasonPoints', () => {
  it('sums a player once per week even when rostered in both conferences', () => {
    const raw = [
      week('1', [
        { franchises: [{ id: '0001', players: [['100', '20.5']] }] },
        { franchises: [{ id: '0013', players: [['100', '20.5']] }] },
      ]),
      week('2', [{ franchises: [{ id: '0001', players: [['100', '10.0']] }] }]),
    ];
    const { points } = computeSeasonPoints(raw);
    expect(points.get('100')).toBeCloseTo(30.5);
  });

  it('skips non-regular-season matchups', () => {
    const raw = [
      week('15', [{ regularSeason: '0', franchises: [{ id: '0001', players: [['100', '99']] }] }]),
      week('3', [{ franchises: [{ id: '0001', players: [['100', '7']] }] }]),
    ];
    const { points, maxCompletedWeek } = computeSeasonPoints(raw);
    expect(points.get('100')).toBeCloseTo(7);
    expect(maxCompletedWeek).toBe(3);
  });

  it('excludes top-level franchise blocks on playoff weeks, includes them on bye weeks', () => {
    const playoffWeek = week('15', [
      { regularSeason: '0', franchises: [{ id: '0001', players: [['100', '99']] }] },
    ]);
    // Idle (eliminated) franchise listed outside the matchups with real scores —
    // the 2025 feed's week 17 shape.
    playoffWeek.weeklyResults.franchise = [{ id: '0002', player: [{ id: '200', score: '45.6' }] }];
    const byeWeek = week('3', [{ franchises: [{ id: '0001', players: [['100', '7']] }] }]);
    byeWeek.weeklyResults.franchise = [{ id: '0003', player: [{ id: '300', score: '11.5' }] }];

    const { points, maxCompletedWeek } = computeSeasonPoints([playoffWeek, byeWeek]);
    expect(points.get('200')).toBeUndefined(); // playoff-week idle scores excluded
    expect(points.get('300')).toBeCloseTo(11.5); // regular-season bye scores included
    expect(maxCompletedWeek).toBe(3); // playoff week never counts as "completed"
  });

  it('excludes matchup-less weeks that carry only top-level franchise blocks', () => {
    // The 2026 feed's playoff weeks (15-17) have NO matchup entries at all —
    // just 24 top-level franchise blocks. If those ever fill with scores they
    // must not count as regular-season points.
    const matchlessPlayoff = {
      weeklyResults: {
        week: '15',
        franchise: [{ id: '0001', player: [{ id: '100', score: '31.0' }] }],
      },
    };
    const regular = week('2', [{ franchises: [{ id: '0001', players: [['100', '6']] }] }]);
    const { points, maxCompletedWeek } = computeSeasonPoints([matchlessPlayoff, regular]);
    expect(points.get('100')).toBeCloseTo(6);
    expect(maxCompletedWeek).toBe(2);
  });

  it('skips entries whose week is missing or unparseable', () => {
    const badWeek = week('1', [{ franchises: [{ id: '0001', players: [['100', '50']] }] }]);
    delete badWeek.weeklyResults.week;
    const goodWeek = week('2', [{ franchises: [{ id: '0001', players: [['100', '8']] }] }]);
    const { points, maxCompletedWeek } = computeSeasonPoints([badWeek, goodWeek]);
    expect(points.get('100')).toBeCloseTo(8);
    expect(maxCompletedWeek).toBe(2);
  });

  it('reports maxCompletedWeek 0 and no points for an empty season', () => {
    const { points, maxCompletedWeek } = computeSeasonPoints([]);
    expect(points.size).toBe(0);
    expect(maxCompletedWeek).toBe(0);
  });
});

describe('keeper reconstruction', () => {
  it('kept = prev ∩ opening − drafted', () => {
    const kept = reconstructKeepers(
      new Set(['1', '2', '3', '4']),
      new Set(['2', '3', '4', '9']),
      new Set(['4'])
    );
    expect([...kept].sort()).toEqual(['2', '3']);
  });

  it('uses week-1 starters+nonstarters when week 1 exists', () => {
    const raw = [
      week('1', [
        { franchises: [{ id: '0001', players: [['1', '5'], ['2', '0']] }] },
      ]),
    ];
    const rosters = rostersFeed({ '0001': ['99'] });
    expect([...getOpeningRosterPids(raw, rosters, '0001')].sort()).toEqual(['1', '2']);
  });

  it('falls back to current rosters pre-week-1 (live cycle)', () => {
    const rosters = rostersFeed({ '0001': ['1', '2', '3'] });
    expect([...getOpeningRosterPids([], rosters, '0001')].sort()).toEqual(['1', '2', '3']);
  });

  it('never falls back to end-of-season rosters when week 1 has player data', () => {
    // Franchise 0002 is missing from a populated week 1 — the final
    // rosters.json must NOT stand in for its opening roster (it would count
    // mid-season pickups as keeps).
    const raw = [week('1', [{ franchises: [{ id: '0001', players: [['1', '5']] }] }])];
    const rosters = rostersFeed({ '0002': ['9'] });
    expect(getOpeningRosterPids(raw, rosters, '0002').size).toBe(0);
  });

  it('a pre-season week-1 schedule shell (no player lists) falls through to rosters', () => {
    // The committed 2026 feed already carries week 1 as a schedule shell:
    // matchup franchises with id/isHome/spread but no players. That shell
    // must not suppress the live-cycle rosters fallback.
    const shell = {
      weeklyResults: {
        week: '1',
        matchup: [
          { franchise: [{ id: '0001' }, { id: '0002' }] },
        ],
      },
    };
    const rosters = rostersFeed({ '0001': ['1', '2', '3'] });
    expect([...getOpeningRosterPids([shell], rosters, '0001')].sort()).toEqual(['1', '2', '3']);
  });

  it('scopes the drafted pool to the franchise draft unit (conference)', () => {
    const draftResults = {
      draftResults: {
        draftUnit: [
          // AL unit: 0001 and 0002 draft; 55 drafted by 0002.
          { draftPick: [{ franchise: '0001', player: '54' }, { franchise: '0002', player: '55' }] },
          // NL unit: 0013 drafts the SAME NFL player 55 (duplicate pool).
          { draftPick: [{ franchise: '0013', player: '55' }] },
        ],
      },
    };
    const byUnit = getUnitDraftedPidsByFranchise(draftResults);
    // 0001's pool includes 0002's pick (same unit) — a drafted-then-traded-back
    // player can't be a keep...
    expect(byUnit.get('0001')?.has('55')).toBe(true);
    // ...and 0013's NL pool is independent of the AL picks.
    expect(byUnit.get('0013')?.has('54')).toBe(false);
  });

  it('parses draft picks and ignores passed picks', () => {
    const drafted = getDraftedPidsByFranchise({
      draftResults: {
        draftUnit: [
          { draftPick: [{ franchise: '0001', player: '55' }, { franchise: '0001', player: '----' }] },
          { draftPick: { franchise: '0002', player: '66' } },
        ],
      },
    });
    expect([...(drafted.get('0001') ?? [])]).toEqual(['55']);
    expect([...(drafted.get('0002') ?? [])]).toEqual(['66']);
  });
});

describe('resolveOfficialKeepers', () => {
  const seven = (prefix: string) => Array.from({ length: 7 }, (_, i) => `${prefix}${i}`);

  const LEAGUE = ['0001', '0002'];

  it('returns the first snapshot (by date) where every franchise has exactly 7', () => {
    const unsettled = rostersFeed({ '0001': [...seven('a'), 'extra'], '0002': seven('b') });
    const settled = rostersFeed({ '0001': seven('a'), '0002': seven('b') });
    const later = rostersFeed({ '0001': seven('x'), '0002': seven('y') });
    // Deliberately unsorted input — resolution must sort by date.
    const result = resolveOfficialKeepers(
      [
        { date: '2026-07-20', rosters: later },
        { date: '2026-07-16', rosters: unsettled },
        { date: '2026-07-17', rosters: settled },
      ],
      LEAGUE
    );
    expect(result?.date).toBe('2026-07-17');
    expect([...(result?.byFranchise.get('0001') ?? [])].sort()).toEqual(seven('a').sort());
  });

  it('rejects a truncated snapshot missing expected franchises', () => {
    // 0001 is at exactly 7 but 0002 is absent — a partial payload must not
    // qualify (it would zero out the missing franchises' keeps).
    const partial = rostersFeed({ '0001': seven('a') });
    const complete = rostersFeed({ '0001': seven('a'), '0002': seven('b') });
    const result = resolveOfficialKeepers(
      [
        { date: '2026-07-16', rosters: partial },
        { date: '2026-07-18', rosters: complete },
      ],
      LEAGUE
    );
    expect(result?.date).toBe('2026-07-18');
  });

  it('returns null when no snapshot has settled to all-7', () => {
    const unsettled = rostersFeed({ '0001': ['1', '2'], '0002': seven('b') });
    expect(resolveOfficialKeepers([{ date: '2026-07-16', rosters: unsettled }], LEAGUE)).toBeNull();
    expect(resolveOfficialKeepers([], LEAGUE)).toBeNull();
  });
});

describe('K/DEF dominance rule', () => {
  const players = playersFeed([
    ['k1', 'Kicker, Alpha', 'PK'],
    ['k2', 'Kicker, Beta', 'PK'],
    ['d1', 'Patriots, New England', 'Def', 'NEP'],
    ['d2', 'Bills, Buffalo', 'Def', 'BUF'],
  ]);
  const byId = buildPlayersById(players, undefined);

  it(`no exception below the ${KDEF_GAP_THRESHOLD}-point gap`, () => {
    const points = new Map([
      ['k1', 150], ['k2', 110.1],
      ['d1', 150], ['d2', 111],
    ]);
    expect(computeKdefExceptions(points, byId)).toEqual([]);
  });

  it('grants an exception at exactly the threshold', () => {
    const points = new Map([
      ['d1', 185], ['d2', 185 - KDEF_GAP_THRESHOLD],
      ['k1', 100], ['k2', 90],
    ]);
    const exceptions = computeKdefExceptions(points, byId);
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]).toMatchObject({ position: 'Def', playerId: 'd1', gap: KDEF_GAP_THRESHOLD });
  });
});

describe('computeOptimalSeven', () => {
  const players = playersFeed([
    ['q1', 'Quarterback, One', 'QB'],
    ['r1', 'Runner, One', 'RB'],
    ['r2', 'Runner, Two', 'RB'],
    ['w1', 'Wideout, One', 'WR'],
    ['w2', 'Wideout, Two', 'WR'],
    ['t1', 'Tightend, One', 'TE'],
    ['t2', 'Tightend, Two', 'TE'],
    ['x1', 'Extra, One', 'WR'],
    ['k1', 'Kicker, Alpha', 'PK'],
    ['d1', 'Patriots, New England', 'Def', 'NEP'],
  ]);
  const byId = buildPlayersById(players, undefined);
  const roster = new Set(['q1', 'r1', 'r2', 'w1', 'w2', 't1', 't2', 'x1', 'k1', 'd1']);
  // K and DEF are the top-2 raw scorers.
  const points = new Map([
    ['k1', 300], ['d1', 290],
    ['q1', 200], ['r1', 190], ['r2', 180], ['w1', 170], ['w2', 160], ['t1', 150],
    ['t2', 140], ['x1', 130],
  ]);

  it('excludes K/DEF from optimal but keeps them in rawTopSeven', () => {
    const { optimal, rawTopSeven } = computeOptimalSeven(roster, points, byId, new Set());
    expect(optimal).toEqual(['q1', 'r1', 'r2', 'w1', 'w2', 't1', 't2']);
    expect(rawTopSeven).toContain('k1');
    expect(rawTopSeven).toContain('d1');
    expect(rawTopSeven).toHaveLength(7);
  });

  it('includes an exception position in optimal', () => {
    const { optimal } = computeOptimalSeven(roster, points, byId, new Set(['Def']));
    expect(optimal).toContain('d1');
    expect(optimal).not.toContain('k1');
    expect(optimal).toHaveLength(7);
  });

  it('caps the optimal seven at one QB (the roster top scorer)', () => {
    const twoQbPlayers = playersFeed([
      ['q1', 'Quarterback, One', 'QB'],
      ['q2', 'Quarterback, Two', 'QB'],
      ['r1', 'Runner, One', 'RB'],
      ['r2', 'Runner, Two', 'RB'],
      ['w1', 'Wideout, One', 'WR'],
      ['w2', 'Wideout, Two', 'WR'],
      ['t1', 'Tightend, One', 'TE'],
      ['t2', 'Tightend, Two', 'TE'],
    ]);
    const twoQbById = buildPlayersById(twoQbPlayers, undefined);
    const twoQbRoster = new Set(['q1', 'q2', 'r1', 'r2', 'w1', 'w2', 't1', 't2']);
    // Both QBs are top-2 raw scorers; only q1 may enter the optimal seven.
    const twoQbPoints = new Map([
      ['q1', 300], ['q2', 290],
      ['r1', 200], ['r2', 190], ['w1', 180], ['w2', 170], ['t1', 160], ['t2', 150],
    ]);
    const { optimal, rawTopSeven } = computeOptimalSeven(twoQbRoster, twoQbPoints, twoQbById, new Set());
    expect(optimal).toContain('q1');
    expect(optimal).not.toContain('q2');
    expect(optimal).toHaveLength(7); // t2 backfills the slot
    expect(optimal).toContain('t2');
    expect(rawTopSeven).toContain('q2'); // raw view is unfiltered
  });

  it('breaks point ties deterministically by id', () => {
    const tied = new Map(points);
    tied.set('x1', 140); // tie with t2 at the 7th-slot boundary
    const { optimal } = computeOptimalSeven(roster, tied, byId, new Set());
    expect(optimal[6]).toBe('t2'); // 't2' < 'x1' — x1 misses the cut
    expect(optimal).not.toContain('x1');
  });
});

describe('gradeFranchise', () => {
  const players = playersFeed([
    ['q1', 'Quarterback, One', 'QB'],
    ['r1', 'Runner, One', 'RB'],
    ['r2', 'Runner, Two', 'RB'],
    ['w1', 'Wideout, One', 'WR'],
    ['w2', 'Wideout, Two', 'WR'],
    ['t1', 'Tightend, One', 'TE'],
    ['t2', 'Tightend, Two', 'TE'],
    ['x1', 'Extra, One', 'WR'],
    ['k1', 'Kicker, Alpha', 'PK'],
  ]);
  const byId = buildPlayersById(players, undefined);
  const roster = new Set(['q1', 'r1', 'r2', 'w1', 'w2', 't1', 't2', 'x1', 'k1']);
  const points = new Map([
    ['q1', 200], ['r1', 190], ['r2', 180], ['w1', 170], ['w2', 160], ['t1', 150],
    ['t2', 140], ['x1', 130], ['k1', 120],
  ]);
  // Optimal: q1 r1 r2 w1 w2 t1 t2. Kept: 5 optimal + x1 (miss) + k1 (neutral).
  const kept = new Set(['q1', 'r1', 'r2', 'w1', 'w2', 'x1', 'k1']);

  it('partitions hits / misses / got-away / neutral correctly', () => {
    const analysis = gradeFranchise('0001', roster, kept, points, byId, new Set());
    expect(analysis.hits).toBe(5);
    expect(analysis.misses).toBe(1); // x1
    expect(analysis.gotAway).toBe(2); // t1, t2
    expect(analysis.kdefNeutralKept).toBe(1); // k1 — not a miss
    const byPid = Object.fromEntries(analysis.players.map((p) => [p.id, p.badge]));
    expect(byPid['x1']).toBe('miss');
    expect(byPid['k1']).toBe('kdef-neutral');
    expect(byPid['t1']).toBe('got-away');
    expect(byPid['q1']).toBe('hit');
  });

  it('handles a 6-keep team without a phantom miss', () => {
    const sixKept = new Set(['q1', 'r1', 'r2', 'w1', 'w2', 't1']);
    const analysis = gradeFranchise('0001', roster, sixKept, points, byId, new Set());
    expect(analysis.keptCount).toBe(6);
    expect(analysis.hits).toBe(6);
    expect(analysis.misses).toBe(0);
    expect(analysis.gotAway).toBe(1); // t2
  });

  it('kept backup QB is always neutral — never a miss, never a hit, points uncounted', () => {
    const twoQbPlayers = playersFeed([
      ['q1', 'Quarterback, One', 'QB'],
      ['q2', 'Quarterback, Two', 'QB'],
      ['r1', 'Runner, One', 'RB'],
      ['r2', 'Runner, Two', 'RB'],
      ['w1', 'Wideout, One', 'WR'],
      ['w2', 'Wideout, Two', 'WR'],
      ['t1', 'Tightend, One', 'TE'],
      ['t2', 'Tightend, Two', 'TE'],
      ['x1', 'Extra, One', 'WR'],
    ]);
    const twoQbById = buildPlayersById(twoQbPlayers, undefined);
    const twoQbRoster = new Set(['q1', 'q2', 'r1', 'r2', 'w1', 'w2', 't1', 't2', 'x1']);
    const twoQbPoints = new Map([
      ['q1', 300], ['q2', 290],
      ['r1', 200], ['r2', 190], ['w1', 180], ['w2', 170], ['t1', 160], ['t2', 150],
      ['x1', 10],
    ]);
    // Kept both QBs plus 5 of the optimal; t1 (160) and t2 (150) walked.
    const twoQbKept = new Set(['q1', 'q2', 'r1', 'r2', 'w1', 'w2', 'x1']);
    const analysis = gradeFranchise('0001', twoQbRoster, twoQbKept, twoQbPoints, twoQbById, new Set());
    const byPid = Object.fromEntries(analysis.players.map((p) => [p.id, p.badge]));
    // q2 (290) outscored t1 (160), the best optimal player let go — but a
    // backup QB only starts on a bye or an injury, so those points were never
    // really in the lineup. Neutral, not a hit.
    expect(byPid['q2']).toBe('qb2-neutral');
    expect(byPid['x1']).toBe('miss');
    expect(analysis.gotAway).toBe(2); // t1, t2 — q2 never counts as got-away
    // ...and his 290 points are excluded from the class total.
    expect(analysis.keptPoints).toBeCloseTo(300 + 200 + 190 + 180 + 170 + 10);
    expect(analysis.efficiency).toBeLessThanOrEqual(1);

    // Same shape but the backup QB underperformed the walked alternative.
    const weakQ2 = new Map(twoQbPoints);
    weakQ2.set('q2', 120); // below t1's 160 and t2's 150
    const analysis2 = gradeFranchise('0001', twoQbRoster, twoQbKept, weakQ2, twoQbById, new Set());
    const byPid2 = Object.fromEntries(analysis2.players.map((p) => [p.id, p.badge]));
    expect(byPid2['q2']).toBe('qb2-neutral'); // never a miss
    expect(analysis2.backupQbNeutralKept).toBe(1);
    expect(analysis2.misses).toBe(1); // only x1
  });

  it('kept K/DEF that outscored a walked optimal player grades a hit', () => {
    const kdefPlayers = playersFeed([
      ['q1', 'Quarterback, One', 'QB'],
      ['r1', 'Runner, One', 'RB'],
      ['r2', 'Runner, Two', 'RB'],
      ['w1', 'Wideout, One', 'WR'],
      ['w2', 'Wideout, Two', 'WR'],
      ['t1', 'Tightend, One', 'TE'],
      ['t2', 'Tightend, Two', 'TE'],
      ['k1', 'Kicker, Alpha', 'PK'],
    ]);
    const kdefById = buildPlayersById(kdefPlayers, undefined);
    const kdefRoster = new Set(['q1', 'r1', 'r2', 'w1', 'w2', 't1', 't2', 'k1']);
    const kdefPoints = new Map([
      ['q1', 300], ['r1', 200], ['r2', 190], ['w1', 180], ['w2', 170],
      ['t1', 160], ['t2', 150], ['k1', 155],
    ]);
    // Kept the kicker over t2; k1 (155) outscored the walked t2 (150).
    const keptWithK = new Set(['q1', 'r1', 'r2', 'w1', 'w2', 't1', 'k1']);
    const analysis = gradeFranchise('0001', kdefRoster, keptWithK, kdefPoints, kdefById, new Set());
    const byPid = Object.fromEntries(analysis.players.map((p) => [p.id, p.badge]));
    expect(byPid['k1']).toBe('hit'); // the keep paid off
    expect(analysis.hits).toBe(7);
    expect(analysis.kdefNeutralKept).toBe(0);

    // Kicker below the walked alternative stays neutral (never a miss).
    const weakK = new Map(kdefPoints);
    weakK.set('k1', 100);
    const analysis2 = gradeFranchise('0001', kdefRoster, keptWithK, weakK, kdefById, new Set());
    const byPid2 = Object.fromEntries(analysis2.players.map((p) => [p.id, p.badge]));
    expect(byPid2['k1']).toBe('kdef-neutral');
    expect(analysis2.misses).toBe(0);
  });

  it('computes kept/optimal points and efficiency', () => {
    const analysis = gradeFranchise('0001', roster, kept, points, byId, new Set());
    expect(analysis.keptPoints).toBeCloseTo(200 + 190 + 180 + 170 + 160 + 130 + 120);
    expect(analysis.optimalPoints).toBeCloseTo(200 + 190 + 180 + 170 + 160 + 150 + 140);
    expect(analysis.efficiency).toBeCloseTo(analysis.keptPoints / analysis.optimalPoints);
  });
});

describe('buildKeeperAnalysis', () => {
  const prevPlayers = playersFeed([
    ['a1', 'Ace, One', 'QB'], ['a2', 'Ace, Two', 'RB'], ['a3', 'Ace, Three', 'WR'],
    ['b1', 'Bench, One', 'QB'], ['b2', 'Bench, Two', 'RB'], ['b3', 'Bench, Three', 'WR'],
  ]);

  it('flags previewMode with zero points and still reconstructs keeps', () => {
    const analysis = buildKeeperAnalysis({
      prevRosters: rostersFeed({ '0001': ['a1', 'a2', 'a3'], '0002': ['b1', 'b2', 'b3'] }),
      prevPlayers,
      curWeeklyRaw: [],
      curRosters: rostersFeed({ '0001': ['a1', 'a2'], '0002': ['b1'] }),
    });
    expect(analysis.previewMode).toBe(true);
    expect(analysis.throughWeek).toBe(0);
    const f1 = analysis.franchises.find((f) => f.franchiseId === '0001')!;
    expect(f1.keptCount).toBe(2);
  });

  it('prefers an official snapshot over reconstruction and intersects with the prev roster', () => {
    const seven = ['a1', 'a2', 'a3', 'k1', 'k2', 'k3', 'traded-in'];
    const analysis = buildKeeperAnalysis({
      // prev roster lacks 'traded-in' (acquired via offseason trade)
      prevRosters: rostersFeed({ '0001': ['a1', 'a2', 'a3', 'k1', 'k2', 'k3', 'x1', 'x2'] }),
      prevPlayers,
      curWeeklyRaw: [],
      // rosters.json fallback would say something different — must be ignored
      curRosters: rostersFeed({ '0001': ['x1'] }),
      keeperSnapshots: [{ date: '2026-07-17', rosters: rostersFeed({ '0001': seven }) }],
    });
    expect(analysis.keeperSource).toBe('official');
    expect(analysis.keeperSnapshotDate).toBe('2026-07-17');
    const f = analysis.franchises.find((fr) => fr.franchiseId === '0001')!;
    // 6 of the 7 official keeps are on the prev roster; 'traded-in' is not.
    expect(f.keptCount).toBe(6);
    expect(f.players.some((p) => p.id === 'x1' && p.kept)).toBe(false);
  });

  it('official keeps still subtract the conference draft pool', () => {
    // 'a3' appears in the official snapshot but was drafted by this
    // franchise's conference — dropped after the settle date and re-drafted,
    // so he re-entered the pool and can't be a keep.
    const seven = ['a1', 'a2', 'a3', 'k1', 'k2', 'k3', 'k4'];
    const analysis = buildKeeperAnalysis({
      prevRosters: rostersFeed({ '0001': [...seven, 'x1'] }),
      prevPlayers,
      curWeeklyRaw: [],
      keeperSnapshots: [{ date: '2026-07-17', rosters: rostersFeed({ '0001': seven }) }],
      curDraftResults: {
        draftResults: { draftUnit: [{ draftPick: [{ franchise: '0001', player: 'a3' }] }] },
      },
    });
    expect(analysis.keeperSource).toBe('official');
    const f = analysis.franchises.find((fr) => fr.franchiseId === '0001')!;
    expect(f.keptCount).toBe(6);
    expect(f.players.find((p) => p.id === 'a3')?.kept).toBe(false);
  });

  it('falls back to reconstruction when no snapshot settles', () => {
    const analysis = buildKeeperAnalysis({
      prevRosters: rostersFeed({ '0001': ['a1', 'a2', 'a3'] }),
      prevPlayers,
      curWeeklyRaw: [],
      curRosters: rostersFeed({ '0001': ['a1', 'a2'] }),
      keeperSnapshots: [{ date: '2026-07-16', rosters: rostersFeed({ '0001': ['a1'] }) }],
    });
    expect(analysis.keeperSource).toBe('reconstructed');
    expect(analysis.keeperSnapshotDate).toBeNull();
    expect(analysis.franchises[0].keptCount).toBe(2);
  });

  it('ranks franchises by share of optimal and fills the summary', () => {
    // Week-1 rosters define the opening rosters: 0001 kept a1+a2, 0002 kept
    // only b1 — b2 walked and scored 50 for an unrelated franchise.
    const curWeeklyRaw = [
      week('1', [
        {
          franchises: [
            { id: '0001', players: [['a1', '30'], ['a2', '20']] },
            { id: '0002', players: [['b1', '5']] },
            { id: '0003', players: [['b2', '50']] },
          ],
        },
      ]),
    ];
    const analysis = buildKeeperAnalysis({
      prevRosters: rostersFeed({ '0001': ['a1', 'a2', 'a3'], '0002': ['b1', 'b2', 'b3'] }),
      prevPlayers,
      curWeeklyRaw,
      curRosters: rostersFeed({ '0001': ['a1', 'a2'], '0002': ['b1'] }),
    });
    expect(analysis.previewMode).toBe(false);
    expect(analysis.summary.rankedFranchiseIds[0]).toBe('0001'); // 100% of optimal vs 9%
    expect(analysis.summary.bestFranchiseId).toBe('0001');
    expect(analysis.summary.worstFranchiseId).toBe('0002');
    const f2 = analysis.franchises.find((f) => f.franchiseId === '0002')!;
    expect(f2.gotAway).toBeGreaterThan(0); // let b2 (50 pts) walk
  });

  it('ranks a maxed-out thin roster above a squandered loaded one', () => {
    // The bug this locks out: ranking on raw kept points grades the roster a
    // manager inherited, not the call they made with it. 0002 sits on a far
    // better roster (300 available vs 100) and scores more kept points (150)
    // while leaving half of it on the table; 0001 keeps literally the best
    // pair available to it. The lower-scoring perfect class must rank first.
    const curWeeklyRaw = [
      week('1', [
        {
          franchises: [
            { id: '0001', players: [['a1', '60'], ['a2', '40']] }, // kept the optimal 2 of 2
            { id: '0002', players: [['b1', '150']] }, // kept 1 of an optimal 2
            { id: '0003', players: [['b2', '150']] }, // b2 walked to another team
          ],
        },
      ]),
    ];
    const analysis = buildKeeperAnalysis({
      prevRosters: rostersFeed({ '0001': ['a1', 'a2'], '0002': ['b1', 'b2'] }),
      prevPlayers,
      curWeeklyRaw,
      curRosters: rostersFeed({ '0001': ['a1', 'a2'], '0002': ['b1'] }),
    });

    const f1 = analysis.franchises.find((f) => f.franchiseId === '0001')!;
    const f2 = analysis.franchises.find((f) => f.franchiseId === '0002')!;
    expect(f1.efficiency).toBeCloseTo(1); // 100 of 100
    expect(f2.efficiency).toBeCloseTo(0.5); // 150 of 300
    expect(f2.keptPoints).toBeGreaterThan(f1.keptPoints); // and yet...
    expect(analysis.summary.rankedFranchiseIds[0]).toBe('0001');
    expect(analysis.summary.bestFranchiseId).toBe('0001');
    expect(analysis.summary.worstFranchiseId).toBe('0002');
  });

  it('breaks efficiency ties on kept points', () => {
    // Same share of the ceiling, bigger ceiling captured — the better class.
    const curWeeklyRaw = [
      week('1', [
        {
          franchises: [
            { id: '0001', players: [['a1', '50']] },
            { id: '0002', players: [['b1', '100']] },
            { id: '0003', players: [['a2', '50'], ['b2', '100']] }, // both walked
          ],
        },
      ]),
    ];
    const analysis = buildKeeperAnalysis({
      prevRosters: rostersFeed({ '0001': ['a1', 'a2'], '0002': ['b1', 'b2'] }),
      prevPlayers,
      curWeeklyRaw,
      curRosters: rostersFeed({ '0001': ['a1'], '0002': ['b1'] }),
    });

    const f1 = analysis.franchises.find((f) => f.franchiseId === '0001')!;
    const f2 = analysis.franchises.find((f) => f.franchiseId === '0002')!;
    expect(f1.efficiency).toBeCloseTo(f2.efficiency); // both captured half
    expect(analysis.summary.rankedFranchiseIds[0]).toBe('0002'); // 100 kept pts vs 50
  });
});

// --- Integration: real committed feeds (regression against data drift) ---

const FEEDS_DIR = join(process.cwd(), 'data/afl-fantasy/mfl-feeds');
const hasRealFeeds =
  existsSync(join(FEEDS_DIR, '2024/rosters.json')) &&
  existsSync(join(FEEDS_DIR, '2025/weekly-results-raw.json'));

describe.runIf(hasRealFeeds)('integration: 2024→2025 cycle (real feeds)', () => {
  const load = (rel: string) => JSON.parse(readFileSync(join(FEEDS_DIR, rel), 'utf-8'));

  it('reconstructs 24 franchises with 6-7 keeps each and sane grades', () => {
    const analysis = buildKeeperAnalysis({
      prevRosters: load('2024/rosters.json'),
      prevPlayers: load('2024/players.json'),
      curPlayers: load('2025/players.json'),
      curWeeklyRaw: load('2025/weekly-results-raw.json'),
      curRosters: load('2025/rosters.json'),
      curDraftResults: load('2025/draftResults.json'),
    });
    expect(analysis.franchises).toHaveLength(24);
    expect(analysis.previewMode).toBe(false);
    // Exactly the 14-week regular season — a higher number means playoff-week
    // scores leaked in (the top-level-franchise contamination bug).
    expect(analysis.throughWeek).toBe(14);
    for (const f of analysis.franchises) {
      expect(f.keptCount).toBeGreaterThanOrEqual(6);
      expect(f.keptCount).toBeLessThanOrEqual(7);
      expect(f.hits + f.misses + f.kdefNeutralKept + f.backupQbNeutralKept).toBe(f.keptCount);
      expect(f.optimalPoints).toBeGreaterThan(0);
      // No class may score above its own ceiling. Boondock Saints hit 100.49%
      // before backup-QB points were excluded (Jayden Daniels as a QB2), which
      // rounded to a clean "100%" on the page and put a class that missed one
      // optimal keeper ahead of one that kept all seven.
      expect(f.efficiency).toBeLessThanOrEqual(1);
    }
    // 2025 had no 40-pt dominant K/DEF.
    expect(analysis.summary.kdefExceptions).toEqual([]);
  });
});

const hasLiveFeeds =
  existsSync(join(FEEDS_DIR, '2025/rosters.json')) &&
  existsSync(join(FEEDS_DIR, '2026/rosters.json'));

describe.runIf(hasLiveFeeds)('integration: 2025→2026 live cycle (real feeds)', () => {
  const load = (rel: string) => JSON.parse(readFileSync(join(FEEDS_DIR, rel), 'utf-8'));

  const loadJulySnapshots = (year: string) => {
    const dir = join(FEEDS_DIR, `${year}/roster-history`);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => new RegExp(`^rosters-${year}-07-(1[6-9]|[2-3][0-9])\\.json$`).test(f))
      .map((f) => ({ date: f.slice(8, 18), rosters: load(`${year}/roster-history/${f}`) }));
  };

  it('reconstructs declared keeper classes pre-season despite the week-1 schedule shell', () => {
    const analysis = buildKeeperAnalysis({
      prevRosters: load('2025/rosters.json'),
      prevPlayers: load('2025/players.json'),
      curPlayers: load('2026/players.json'),
      curWeeklyRaw: load('2026/weekly-results-raw.json'),
      curRosters: load('2026/rosters.json'),
      curDraftResults: load('2026/draftResults.json'),
    });
    expect(analysis.franchises).toHaveLength(24);
    expect(analysis.keeperSource).toBe('reconstructed');
    // Pre-week-1 the cycle is a preview and every class is its declared keeps.
    // Once the 2026 season starts this assertion naturally relaxes: preview
    // flips off and keep counts come from the real week-1 rosters.
    if (analysis.previewMode) {
      for (const f of analysis.franchises) {
        expect(f.keptCount).toBeGreaterThanOrEqual(6);
        expect(f.keptCount).toBeLessThanOrEqual(7);
      }
    }
  });

  it('uses the official post-deadline snapshot when July snapshots exist', () => {
    const keeperSnapshots = loadJulySnapshots('2026');
    if (keeperSnapshots.length === 0) return; // archive not present in this checkout
    const analysis = buildKeeperAnalysis({
      prevRosters: load('2025/rosters.json'),
      prevPlayers: load('2025/players.json'),
      curPlayers: load('2026/players.json'),
      curWeeklyRaw: load('2026/weekly-results-raw.json'),
      curRosters: load('2026/rosters.json'),
      curDraftResults: load('2026/draftResults.json'),
      keeperSnapshots,
    });
    expect(analysis.keeperSource).toBe('official');
    // 2026 cuts settled two days after the July 15 deadline.
    expect(analysis.keeperSnapshotDate).toBe('2026-07-17');
    for (const f of analysis.franchises) {
      expect(f.keptCount).toBe(7);
    }
  });
});
