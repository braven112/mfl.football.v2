import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildKeeperAnalysis,
  buildPlayersById,
  computeReplacementLevels,
  computeSeasonPoints,
  getDraftedPidsByFranchise,
  getUnitDraftedPidsByFranchise,
  getOpeningRosterPids,
  gradeFranchise,
  LINEUP_SLOTS,
  parsePlayerScoresYtd,
  pointsOverReplacement,
  reconstructKeepers,
  selectBestKeepers,
  slotGroupFor,
  BENCH_EXPECTED_STARTS,
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

// A flat replacement of 0 makes PoR == raw points, so a test can reason in
// plain points except where slot caps are the point of the test.
const NO_REPLACEMENT = { QB: 0, PK: 0, Def: 0, FLEX: 0 };
/** Everyone rostered the same number of weeks, so PoR scales uniformly. */
const evenWeeks = (pids: Iterable<string>, n = 14) =>
  new Map([...pids].map((pid) => [pid, n]));

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

describe('computeReplacementLevels', () => {
  const players = playersFeed([
    ['q1', 'Q, One', 'QB'], ['q2', 'Q, Two', 'QB'], ['q3', 'Q, Three', 'QB'], ['q4', 'Q, Four', 'QB'],
  ]);
  const byId = buildPlayersById(players, undefined);
  const pids = ['q1', 'q2', 'q3', 'q4'];
  const points = new Map([['q1', 280], ['q2', 210], ['q3', 140], ['q4', 70]]);

  it('sizes the pool by conference, not by the whole league', () => {
    const deep = playersFeed(
      Array.from({ length: 30 }, (_, i) => [`p${i}`, `P, ${i}`, 'QB'] as [string, string, string])
    );
    const deepById = buildPlayersById(deep, undefined);
    const deepPoints = new Map(
      Array.from({ length: 30 }, (_, i) => [`p${i}`, (30 - i) * 14] as [string, number])
    );
    const deepWeeks = evenWeeks(deepPoints.keys());
    const perConference = computeReplacementLevels(deepPoints, deepWeeks, deepById, 12, 14).levels;
    const wholeLeague = computeReplacementLevels(deepPoints, deepWeeks, deepById, 24, 14).levels;
    expect(perConference.QB).toBeGreaterThan(wholeLeague.QB);
    expect(perConference.QB).toBeCloseTo(30 - 12); // the 13th-best QB
    expect(wholeLeague.QB).toBeCloseTo(30 - 24); // the 25th — far too deep
  });

  it('takes the best player past the last startable slot', () => {
    const { levels } = computeReplacementLevels(points, evenWeeks(pids), byId, 2, 14);
    expect(levels.QB).toBeCloseTo(10); // 2 QB slots => q3 sets it
  });

  it('ignores short stints that would drag the baseline down', () => {
    const weeks = new Map([['q1', 14], ['q2', 14], ['q3', 2], ['q4', 14]]);
    const { levels } = computeReplacementLevels(points, weeks, byId, 2, 14);
    expect(levels.QB).toBeCloseTo(70 / 14);
  });

  it('reports which groups had to clamp instead of hiding it', () => {
    // Only two QBs visible but two startable slots: there is no observable
    // replacement, so the baseline degrades to the worst player we can see.
    const weeks = evenWeeks(['q1', 'q2']);
    const { levels, clamped } = computeReplacementLevels(points, weeks, byId, 2, 14);
    expect(clamped).toContain('QB');
    expect(levels.QB).toBeCloseTo(15); // q2 — biased high, hence the flag
  });

  it('divides YTD totals by the weeks the YTD feed actually spans', () => {
    // MFL's W=YTD includes playoff weeks (feed stamped 18) while our points
    // are regular-season only (14). Dividing by 14 inflates replacement.
    const ytd = new Map([['q1', 360], ['q2', 270], ['q3', 180], ['q4', 90]]);
    const weeks = evenWeeks(pids);
    const correct = computeReplacementLevels(points, weeks, byId, 2, 14, ytd, 18).levels;
    const wrong = computeReplacementLevels(points, weeks, byId, 2, 14, ytd).levels;
    expect(correct.QB).toBeCloseTo(180 / 18);
    expect(wrong.QB).toBeCloseTo(180 / 14);
    expect(wrong.QB).toBeGreaterThan(correct.QB); // the ~29% inflation
  });

  it('prefers the full-pool YTD feed, which can see unrostered players', () => {
    const weeks = evenWeeks(['q1', 'q2']);
    const rosteredOnly = computeReplacementLevels(points, weeks, byId, 2, 14).levels;
    const ytd = new Map([['q1', 280], ['q2', 210], ['q3', 140], ['q4', 70]]);
    const fullPool = computeReplacementLevels(points, weeks, byId, 2, 14, ytd, 14).levels;
    expect(fullPool.QB).toBeLessThan(rosteredOnly.QB);
  });

  it('is all zeros when there is no season yet', () => {
    const { levels } = computeReplacementLevels(new Map(), new Map(), byId, 2, 0);
    expect(levels).toEqual({ QB: 0, PK: 0, Def: 0, FLEX: 0 });
  });
});

describe('parsePlayerScoresYtd', () => {
  it('parses the feed and tolerates a single-object playerScore', () => {
    expect(parsePlayerScoresYtd({ playerScores: { playerScore: { id: 'a', score: '12.5' } } }))
      .toEqual(new Map([['a', 12.5]]));
  });

  it('returns undefined when absent or unusable, so callers fall back', () => {
    expect(parsePlayerScoresYtd(undefined)).toBeUndefined();
    expect(parsePlayerScoresYtd({ playerScores: { playerScore: [] } })).toBeUndefined();
    expect(parsePlayerScoresYtd({ playerScores: { playerScore: [{ id: 'a', score: 'n/a' }] } }))
      .toBeUndefined();
  });
});

describe('pointsOverReplacement', () => {
  const players = playersFeed([['k1', 'K, One', 'PK'], ['r1', 'R, One', 'RB']]);
  const byId = buildPlayersById(players, undefined);

  it('charges a FULL season of replacement — a keeper slot is season-long', () => {
    // The bug this locks out: charging only the weeks a player was rostered
    // reduced value to weeks x (rate - replacement), so a one-week sample
    // outscored a full-season starter. Younghoe Koo (1 week, 9.7 pts) made a
    // real franchise's optimal seven and rendered as "Got away".
    const points = new Map([['r1', 20]]);
    const replacement = { QB: 0, PK: 0, Def: 0, FLEX: 10 };
    // 20 points across a 14-week season is far below a 10/wk replacement.
    expect(pointsOverReplacement('r1', points, byId, replacement, 14)).toBeCloseTo(20 - 140);
  });

  it('prices bench cover by how often he actually starts', () => {
    const points = new Map([['r1', 280]]);
    const replacement = { QB: 0, PK: 0, Def: 0, FLEX: 10 };
    const starter = pointsOverReplacement('r1', points, byId, replacement, 14);
    const bench = pointsOverReplacement('r1', points, byId, replacement, 14, BENCH_EXPECTED_STARTS.FLEX);
    expect(starter).toBeCloseTo(14 * (20 - 10));
    expect(bench).toBeCloseTo(6 * (20 - 10));
    expect(bench).toBeLessThan(starter);
  });

  it('values a 7th skill keep well above a backup QB — he covers six byes', () => {
    expect(BENCH_EXPECTED_STARTS.FLEX).toBeGreaterThan(BENCH_EXPECTED_STARTS.QB);
    expect(BENCH_EXPECTED_STARTS.FLEX).toBe(6); // one per flex starter's bye
    expect(BENCH_EXPECTED_STARTS.QB).toBe(1); // QB1's single bye
  });
});

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
  // Starter value is the raw number; bench value is discounted by role.
  const valueOf = (pid: string, group: 'QB' | 'PK' | 'Def' | 'FLEX', role: 'starter' | 'bench') =>
    (base.get(pid) ?? 0) * (role === 'starter' ? 1 : BENCH_EXPECTED_STARTS[group] / 14);

  it('never exceeds the keeper limit', () => {
    expect(selectBestKeepers(base.keys(), byId, valueOf)).toHaveLength(7);
  });

  it('assigns starting slots first, then bye-week cover', () => {
    const picked = selectBestKeepers(base.keys(), byId, valueOf);
    const roles = Object.fromEntries(picked.map((k) => [k.pid, k.role]));
    expect(roles['q1']).toBe('starter');
    expect(Object.values(roles).filter((r) => r === 'starter').length).toBeLessThanOrEqual(7);
  });

  it('fills the last slot with flex bye-cover ahead of a weak second QB', () => {
    // Both are "backups", but a 7th flex covers six byes while a QB2 covers
    // one, so at comparable value the flex bench slot wins. (With only seven
    // keepers you can never fill all nine starting slots, so a bench pick
    // only competes once a group has surplus beyond its cap.)
    const weak = new Map(base).set('q1', 5).set('q2', 4);
    const weakValue = (pid: string, group: 'QB' | 'PK' | 'Def' | 'FLEX', role: 'starter' | 'bench') =>
      (weak.get(pid) ?? 0) * (role === 'starter' ? 1 : BENCH_EXPECTED_STARTS[group] / 14);
    const pool = ['q1', 'q2', 'r1', 'r2', 'r3', 'w1', 'w2', 'w3', 't1'];
    const picked = selectBestKeepers(pool, byId, weakValue);
    const bench = picked.filter((k) => k.role === 'bench');
    expect(bench).toHaveLength(1);
    expect(bench[0].pid).not.toBe('q2');
    expect(picked.map((k) => k.pid)).not.toContain('q2');
  });

  it('skips negative-value players entirely', () => {
    const neg = (pid: string) => (pid === 'r1' ? -50 : 0);
    expect(selectBestKeepers(['r1'], byId, () => neg('r1'))).toHaveLength(0);
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
  const NO_REP = { QB: 0, PK: 0, Def: 0, FLEX: 0 };
  const grade = (
    keptSet: Set<string>,
    pts = points,
    rosterSet = roster,
    ids = byId,
    replacement = NO_REP
  ) => gradeFranchise('0001', rosterSet, keptSet, pts, ids, replacement, 14);

  it('partitions every keep into hit or miss — no exempt category', () => {
    const analysis = grade(kept);
    expect(analysis.hits + analysis.misses).toBe(analysis.keptCount);
    expect(analysis.efficiency).toBeLessThanOrEqual(1);
  });

  it('handles a 6-keep team without a phantom miss', () => {
    const analysis = grade(new Set(['q1', 'r1', 'r2', 'w1', 'w2', 't1']));
    expect(analysis.keptCount).toBe(6);
    expect(analysis.hits + analysis.misses).toBe(6);
  });

  it('grades a below-replacement QB room without mislabelling the backup', () => {
    // Regression: the old slot-count check compared against players that had
    // ALREADY been dropped for negative value, so when the whole QB room was
    // below replacement BOTH quarterbacks came back `miss` — breaking the
    // documented "a second QB is never a miss" invariant. With bench cover
    // priced, there is no exempt category and the tally stays consistent.
    const twoQbRoster = new Set(['q1', 'q2', 'r1']);
    const twoQbKept = new Set(['q1', 'q2']);
    const weakPoints = new Map([['q1', 10], ['q2', 5], ['r1', 400]]);
    const replacement = { QB: 20, PK: 0, Def: 0, FLEX: 0 };
    const analysis = gradeFranchise('0001', twoQbRoster, twoQbKept, weakPoints, byId, replacement, 14);
    expect(analysis.hits + analysis.misses).toBe(analysis.keptCount);
    expect(analysis.efficiency).toBeLessThanOrEqual(1);
  });

  it('credits a 7th skill keep as bench cover instead of zeroing it', () => {
    const flexOnly = playersFeed(
      Array.from({ length: 8 }, (_, i) => [`s${i}`, `Skill, ${i}`, 'RB'] as [string, string, string])
    );
    const flexById = buildPlayersById(flexOnly, undefined);
    const flexRoster = new Set(Array.from({ length: 8 }, (_, i) => `s${i}`));
    const flexKept = new Set(Array.from({ length: 7 }, (_, i) => `s${i}`));
    const flexPoints = new Map(
      Array.from({ length: 8 }, (_, i) => [`s${i}`, (8 - i) * 60] as [string, number])
    );
    const analysis = gradeFranchise('0001', flexRoster, flexKept, flexPoints, flexById, NO_REP, 14);
    expect(analysis.benchKept).toBe(1);
    const seventh = analysis.players.find((p) => p.id === 's6')!;
    expect(seventh.role).toBe('bench');
    expect(seventh.badge).toBe('hit'); // real value, not an exemption
    expect(analysis.efficiency).toBeLessThanOrEqual(1);
  });

  it('values a kept kicker at its margin over replacement, not its raw total', () => {
    const analysis = grade(
      new Set(['q1', 'r1', 'r2', 'w1', 'w2', 't1', 'k1']), points, roster, byId,
      { QB: 0, PK: 8, Def: 0, FLEX: 0 }
    );
    const k = analysis.players.find((p) => p.id === 'k1')!;
    expect(k.points).toBe(120);
    expect(k.pointsOverReplacement).toBeCloseTo(120 - 8 * 14);
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
  // Replacement level is defined by the players you could have had for free,
  // so a fixture needs a pool deeper than the league's starting slots. These
  // fillers sit at 1 point and never make a roster; they exist to put the
  // baseline on the floor where a real league's would be.
  const FILLERS = [
    ...Array.from({ length: 3 }, (_, i) => [`g${i}`, `Filler, Q${i}`, 'QB'] as const),
    ...Array.from({ length: 25 }, (_, i) => [`f${i}`, `Filler, F${i}`, 'RB'] as const),
  ];
  const deepPool = (real: Record<string, number>) => ({
    playerScores: {
      week: 'YTD',
      playerScore: [
        ...Object.entries(real).map(([id, score]) => ({ id, score: String(score) })),
        ...FILLERS.map(([id]) => ({ id, score: '1' })),
      ],
    },
  });
  const withFillers = (rows: Array<[string, string, string]>) =>
    playersFeed([...rows, ...FILLERS.map((f) => [f[0], f[1], f[2]] as [string, string, string])]);
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
      prevPlayers: withFillers([
        ['a1', 'Ace, One', 'QB'], ['a2', 'Ace, Two', 'RB'],
        ['b1', 'Bench, One', 'QB'], ['b2', 'Bench, Two', 'RB'],
      ]),
      curWeeklyRaw,
      curRosters: rostersFeed({ '0001': ['a1', 'a2'], '0002': ['b1'] }),
      curPlayerScoresYtd: deepPool({ a1: 60, a2: 40, b1: 150, b2: 150 }),
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
      prevPlayers: withFillers([
        ['a1', 'Ace, One', 'QB'], ['a2', 'Ace, Two', 'RB'],
        ['b1', 'Bench, One', 'QB'], ['b2', 'Bench, Two', 'RB'],
      ]),
      curWeeklyRaw,
      curRosters: rostersFeed({ '0001': ['a1'], '0002': ['b1'] }),
      curPlayerScoresYtd: deepPool({ a1: 50, a2: 50, b1: 100, b2: 100 }),
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
      expect(f.hits + f.misses).toBe(f.keptCount);
      expect(f.optimalValue).toBeGreaterThan(0);
      // No class may score above its own ceiling. This held only by luck
      // under the old raw-points model — Boondock Saints reached 100.49% on a
      // backup QB's total. Under PoR both sides of the ratio come from the
      // same slot-capped selection, so it holds by construction.
      expect(f.efficiency).toBeLessThanOrEqual(1);
    }
    // Replacement must be real, not a degenerate all-zero baseline.
    expect(analysis.summary.replacement.FLEX).toBeGreaterThan(0);
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
