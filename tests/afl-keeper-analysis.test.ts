import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  BENCH_CREDIT,
  buildKeeperAnalysis,
  buildPlayersById,
  computeSeasonPoints,
  getDraftedPidsByFranchise,
  getUnitDraftedPidsByFranchise,
  getOpeningRosterPids,
  gradeFranchise,
  keeperValue,
  reconstructKeepers,
  resolveOfficialKeepers,
  selectBestKeepers,
  slotGroupFor,
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

describe('slotGroupFor', () => {
  it('maps RB/WR/TE to the shared flex pool and the rest to their own slot', () => {
    expect(['RB', 'WR', 'TE'].map(slotGroupFor)).toEqual(['FLEX', 'FLEX', 'FLEX']);
    expect(slotGroupFor('QB')).toBe('QB');
    expect(slotGroupFor('PK')).toBe('PK');
    expect(slotGroupFor('Def')).toBe('Def');
  });

  it('returns null for a position that cannot start', () => {
    expect(slotGroupFor('?')).toBeNull();
    expect(slotGroupFor('Coach')).toBeNull();
  });
});

describe('keeperValue', () => {
  it('credits a starter his full points', () => {
    expect(keeperValue(280, 'QB', 'starter')).toBe(280);
    expect(keeperValue(154, 'PK', 'starter')).toBe(154);
    expect(keeperValue(200, 'FLEX', 'starter')).toBe(200);
  });

  it('credits a backup QB/PK/Def a tenth of his points', () => {
    expect(BENCH_CREDIT.QB).toBe(0.1);
    expect(BENCH_CREDIT.PK).toBe(0.1);
    expect(BENCH_CREDIT.Def).toBe(0.1);
    expect(keeperValue(280, 'QB', 'bench')).toBeCloseTo(28);
    expect(keeperValue(150, 'Def', 'bench')).toBeCloseTo(15);
  });

  it('credits a flex backup seven tenths — he rotates in across six starters', () => {
    expect(BENCH_CREDIT.FLEX).toBe(0.7);
    expect(keeperValue(200, 'FLEX', 'bench')).toBeCloseTo(140);
  });
});

// Starter value is the raw points; a backup gets the group's fixed share —
// via the production helper, so the tests can't drift from the real formula.
const creditValueOf =
  (base: Map<string, number>) =>
  (pid: string, group: 'QB' | 'PK' | 'Def' | 'FLEX', role: 'starter' | 'bench') =>
    keeperValue(base.get(pid) ?? 0, group, role);

describe('selectBestKeepers', () => {
  const players = playersFeed([
    ['q1', 'Q, One', 'QB'], ['q2', 'Q, Two', 'QB'],
    ['r1', 'R, One', 'RB'], ['r2', 'R, Two', 'RB'], ['r3', 'R, Three', 'RB'],
    ['w1', 'W, One', 'WR'], ['w2', 'W, Two', 'WR'], ['w3', 'W, Three', 'WR'],
    ['t1', 'T, One', 'TE'], ['t2', 'T, Two', 'TE'],
    ['k1', 'K, One', 'PK'], ['d1', 'D, One', 'Def'],
  ]);
  const byId = buildPlayersById(players, undefined);
  const base = new Map<string, number>([
    ['q1', 300], ['q2', 290],
    ['r1', 200], ['r2', 190], ['r3', 180],
    ['w1', 170], ['w2', 160], ['w3', 150],
    ['t1', 140], ['t2', 130], ['k1', 120], ['d1', 110],
  ]);
  const valueOf = creditValueOf(base);

  it('never exceeds the keeper limit', () => {
    expect(selectBestKeepers(base.keys(), byId, valueOf)).toHaveLength(7);
  });

  it('assigns starting slots first, then backup cover', () => {
    const picked = selectBestKeepers(base.keys(), byId, valueOf);
    const roles = Object.fromEntries(picked.map((k) => [k.pid, k.role]));
    expect(roles['q1']).toBe('starter');
    expect(Object.values(roles).filter((r) => r === 'starter').length).toBeLessThanOrEqual(7);
  });

  it('fills the last slot with a flex backup ahead of a weak second QB', () => {
    // Both are backups, but a 7th flex banks 7/10 of his points while a QB2
    // banks 1/10, so at comparable totals the flex backup wins. (With only
    // seven keepers you can never fill all nine starting slots, so a backup
    // only competes once a group has surplus beyond its cap.)
    const weak = new Map(base).set('q1', 5).set('q2', 4);
    const pool = ['q1', 'q2', 'r1', 'r2', 'r3', 'w1', 'w2', 'w3', 't1'];
    const picked = selectBestKeepers(pool, byId, creditValueOf(weak));
    const bench = picked.filter((k) => k.role === 'bench');
    expect(bench).toHaveLength(1);
    expect(bench[0].pid).not.toBe('q2');
    expect(picked.map((k) => k.pid)).not.toContain('q2');
  });

  it('lets a big enough 7th flex displace a starting kicker — and not a lesser one', () => {
    // The cross-group trade-off the credits exist to price: a flex backup
    // banks 7/10 of his points, so once the 7th-best skill player clears
    // PK-points / 0.7 he outbids the kicker for the last keeper slot. Locks
    // the behavior so a future BENCH_CREDIT tweak can't flip it silently.
    const pool = playersFeed([
      ...Array.from({ length: 7 }, (_, i) => [`f${i}`, `Flex, ${i}`, 'RB'] as [string, string, string]),
      ['pk', 'Kick, Er', 'PK'],
    ]);
    const poolById = buildPlayersById(pool, undefined);
    const pids = [...Array.from({ length: 7 }, (_, i) => `f${i}`), 'pk'];
    const flexPts: Array<[string, number]> = [
      ['f0', 250], ['f1', 240], ['f2', 230], ['f3', 220], ['f4', 210], ['f5', 200], ['f6', 180],
    ];
    // 7th flex banks 0.7 × 180 = 126 > the kicker's 120 — kicker is out.
    const cheapKicker = new Map<string, number>([...flexPts, ['pk', 120]]);
    const withoutPk = selectBestKeepers(pids, poolById, creditValueOf(cheapKicker));
    expect(withoutPk.map((k) => k.pid)).not.toContain('pk');
    expect(withoutPk.find((k) => k.pid === 'f6')?.role).toBe('bench');
    // At 130 the kicker beats the 126 bench credit — he's back in, f6 is out.
    const betterKicker = new Map<string, number>([...flexPts, ['pk', 130]]);
    const withPk = selectBestKeepers(pids, poolById, creditValueOf(betterKicker));
    expect(withPk.map((k) => k.pid)).toContain('pk');
    expect(withPk.map((k) => k.pid)).not.toContain('f6');
  });

  it('skips zero- and negative-value players entirely', () => {
    expect(selectBestKeepers(['r1'], byId, () => 0)).toHaveLength(0);
    expect(selectBestKeepers(['r1'], byId, () => -50)).toHaveLength(0);
  });

  it('ignores players with no startable position', () => {
    const odd = playersFeed([['x1', 'X, One', 'Coach']]);
    expect(selectBestKeepers(['x1'], buildPlayersById(odd, undefined), () => 100)).toHaveLength(0);
  });
});

describe('gradeFranchise', () => {
  const players = playersFeed([
    ['q1', 'Q, One', 'QB'], ['q2', 'Q, Two', 'QB'],
    ['r1', 'R, One', 'RB'], ['r2', 'R, Two', 'RB'],
    ['w1', 'W, One', 'WR'], ['w2', 'W, Two', 'WR'],
    ['t1', 'T, One', 'TE'], ['t2', 'T, Two', 'TE'],
    ['x1', 'X, One', 'WR'], ['k1', 'K, One', 'PK'],
  ]);
  const byId = buildPlayersById(players, undefined);
  const roster = new Set(['q1', 'r1', 'r2', 'w1', 'w2', 't1', 't2', 'x1', 'k1']);
  const points = new Map([
    ['q1', 300], ['r1', 200], ['r2', 190], ['w1', 180], ['w2', 170],
    ['t1', 160], ['t2', 150], ['x1', 30], ['k1', 120],
  ]);
  const kept = new Set(['q1', 'r1', 'r2', 'w1', 'w2', 'x1', 'k1']);
  const grade = (keptSet: Set<string>, pts = points, rosterSet = roster, ids = byId) =>
    gradeFranchise('0001', rosterSet, keptSet, pts, ids);

  it('partitions every keep into hit, miss, or filler', () => {
    const analysis = grade(kept);
    expect(analysis.hits + analysis.misses + analysis.fillerKept).toBe(analysis.keptCount);
    expect(analysis.efficiency).toBeLessThanOrEqual(1);
  });

  it('marks a hit for keeping a top scorer you could have started', () => {
    const analysis = grade(kept);
    const q = analysis.players.find((p) => p.id === 'q1')!;
    expect(q.badge).toBe('hit');
    expect(q.role).toBe('starter');
    // t1 (160) outscored x1 (30) at the same flex slot and walked — got away,
    // and the x1 keep is the miss it displaced.
    expect(analysis.players.find((p) => p.id === 't1')?.badge).toBe('got-away');
    expect(analysis.players.find((p) => p.id === 'x1')?.badge).toBe('miss');
  });

  it('counts the starting kicker at his full points', () => {
    // No replacement-level haircut any more: the PK starter banks his raw
    // total, same as a QB or RB.
    const analysis = grade(new Set(['q1', 'r1', 'r2', 'w1', 'w2', 't1', 'k1']));
    expect(analysis.keptValue).toBeCloseTo(300 + 200 + 190 + 180 + 170 + 160 + 120);
    expect(analysis.efficiency).toBeLessThanOrEqual(1);
  });

  it('credits a second QB a tenth of his points, not zero and not full', () => {
    const twoQbRoster = new Set(['q1', 'q2', 'r1']);
    const twoQbKept = new Set(['q1', 'q2']);
    const qbPoints = new Map([['q1', 300], ['q2', 200], ['r1', 400]]);
    const analysis = gradeFranchise('0001', twoQbRoster, twoQbKept, qbPoints, byId);
    expect(analysis.keptValue).toBeCloseTo(300 + 200 * BENCH_CREDIT.QB);
    expect(analysis.benchKept).toBe(1);
    expect(analysis.hits + analysis.misses + analysis.fillerKept).toBe(analysis.keptCount);
    expect(analysis.efficiency).toBeLessThanOrEqual(1);
  });

  it('only counts a miss when somebody better actually got away', () => {
    // A thin roster: two scorers plus two keeps who put up nothing. Nothing
    // better walked, so the zero keeps are filler, not misses — the old rule
    // branded them misses and produced the nonsense card "100% of optimal,
    // 3/7 hits".
    const thinRoster = new Set(['r1', 'r2', 'x1', 'k1']);
    const thinKept = new Set(['r1', 'r2', 'x1', 'k1']);
    const thinPoints = new Map([['r1', 400], ['r2', 380], ['x1', 0], ['k1', 0]]);
    const a = gradeFranchise('0001', thinRoster, thinKept, thinPoints, byId);
    expect(a.gotAway).toBe(0);
    expect(a.misses).toBe(0); // nothing better was available
    expect(a.fillerKept).toBe(2);
    expect(a.efficiency).toBe(1); // captured everything worth capturing
  });

  it('handles a 6-keep team without a phantom miss', () => {
    const analysis = grade(new Set(['q1', 'r1', 'r2', 'w1', 'w2', 't1']));
    expect(analysis.keptCount).toBe(6);
    expect(analysis.hits + analysis.misses + analysis.fillerKept).toBe(6);
  });

  it('breaks Miss ties among crowded-out keeps by points, blaming the worse one', () => {
    // Crowded-out keeps are all worth zero to the class, so they tie; the
    // stable sort used to fall back to row order — points DESCENDING — and
    // the better of two stockpiled kickers took the Miss badge.
    // FOUR kickers: PK holds one starter + one backup, so TWO are crowded out
    // and the comparator actually runs. With three, nonOptimalKeeps has a
    // single element, .sort() never invokes the comparator, and the test
    // passes with the tie-break reverted — which is exactly what happened.
    const kk = playersFeed([
      ['k1', 'Kick, One', 'PK'], ['k2', 'Kick, Two', 'PK'],
      ['k3', 'Kick, Three', 'PK'], ['k4', 'Kick, Four', 'PK'],
      ['r1', 'Runner, One', 'RB'],
    ]);
    const kkById = buildPlayersById(kk, undefined);
    const roster = new Set(['k1', 'k2', 'k3', 'k4', 'r1']);
    const kept = new Set(['k1', 'k2', 'k3', 'k4']);
    const pts = new Map([
      ['k1', 300], ['k2', 280], ['k3', 260], ['k4', 240], ['r1', 400],
    ]);
    const a = gradeFranchise('0001', roster, kept, pts, kkById);
    const missed = a.players.filter((p) => p.badge === 'miss').map((p) => p.id);
    // Both k3 and k4 are worth zero to the class; the WORSE one takes the
    // blame. r1 (400, got away) displaced exactly one keep.
    expect(missed).toEqual(['k4']);
  });

  it('credits a 7th skill keep as a backup instead of zeroing it', () => {
    const flexOnly = playersFeed(
      Array.from({ length: 8 }, (_, i) => [`s${i}`, `Skill, ${i}`, 'RB'] as [string, string, string])
    );
    const flexById = buildPlayersById(flexOnly, undefined);
    const flexRoster = new Set(Array.from({ length: 8 }, (_, i) => `s${i}`));
    const flexKept = new Set(Array.from({ length: 7 }, (_, i) => `s${i}`));
    const flexPoints = new Map(
      Array.from({ length: 8 }, (_, i) => [`s${i}`, (8 - i) * 60] as [string, number])
    );
    const analysis = gradeFranchise('0001', flexRoster, flexKept, flexPoints, flexById);
    expect(analysis.benchKept).toBe(1);
    const seventh = analysis.players.find((p) => p.id === 's6')!;
    expect(seventh.role).toBe('bench');
    expect(seventh.badge).toBe('hit'); // real value, not an exemption
    // The seventh flex banks 7/10 of his 120 points; the six ahead bank all.
    const starters = [8, 7, 6, 5, 4, 3].reduce((sum, n) => sum + n * 60, 0);
    expect(analysis.keptValue).toBeCloseTo(starters + 120 * BENCH_CREDIT.FLEX);
    expect(analysis.efficiency).toBeLessThanOrEqual(1);
  });

  it('never scores a class above its own ceiling', () => {
    const full = new Set([...roster, 'q2']);
    for (const s of [
      new Set(['q1', 'q2']), new Set(['k1']),
      new Set(['q1', 'r1', 'r2', 'w1', 'w2', 't1', 't2']),
      new Set(['x1', 'k1', 'q1']), roster,
    ]) {
      expect(grade(s, points, full).efficiency).toBeLessThanOrEqual(1);
    }
  });

  it('computes kept/optimal value and efficiency', () => {
    const analysis = grade(kept);
    expect(analysis.optimalValue).toBeGreaterThan(0);
    expect(analysis.efficiency).toBeCloseTo(analysis.keptValue / analysis.optimalValue);
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
    // better roster (300 available vs 100) and banks more kept points (150)
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
    expect(f1.efficiency).toBe(1); // captured its whole ceiling
    expect(f2.efficiency).toBeLessThan(1); // left half of a better one behind
    expect(f2.keptValue).toBeGreaterThan(f1.keptValue); // and yet...
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
    expect(f1.efficiency).toBeCloseTo(f2.efficiency); // both captured the same share
    expect(f2.keptValue).toBeGreaterThan(f1.keptValue);
    expect(analysis.summary.rankedFranchiseIds[0]).toBe('0002'); // bigger ceiling captured
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
      expect(f.hits + f.misses + f.fillerKept).toBe(f.keptCount);
      expect(f.optimalValue).toBeGreaterThan(0);
      // No class may score above its own ceiling. This held only by luck
      // under the old unconstrained raw-points model — Boondock Saints
      // reached 100.49% on a backup QB's total. With both sides of the ratio
      // built by the same slot-capped selection, it holds by construction.
      expect(f.efficiency).toBeLessThanOrEqual(1);
    }
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
