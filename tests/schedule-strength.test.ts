import { describe, it, expect } from 'vitest';
import {
  computeTeamStrengths,
  difficultyStep,
  buildOpponentGrid,
  minMax01,
  rollingAvgPF,
} from '../scripts/lib/team-strength.mjs';
import {
  computeScheduleStrength,
  attachTrends,
} from '../scripts/compute-schedule-strength.mjs';

// ── Fixtures: 4 teams, 6-week round-robin-ish schedule, 3 completed weeks ──

const TEAMS = [
  { franchiseId: '0001', name: 'Alpha', abbrev: 'ALP' },
  { franchiseId: '0002', name: 'Bravo', abbrev: 'BRA' },
  { franchiseId: '0003', name: 'Charlie', abbrev: 'CHA' },
  { franchiseId: '0004', name: 'Delta', abbrev: 'DEL' },
];

function matchup(a: string, b: string) {
  return { franchise: [{ id: a, isHome: '0' }, { id: b, isHome: '1' }] };
}

const SCHEDULE = {
  schedule: {
    weeklySchedule: [
      { week: '1', matchup: [matchup('0001', '0002'), matchup('0003', '0004')] },
      { week: '2', matchup: [matchup('0001', '0003'), matchup('0002', '0004')] },
      { week: '3', matchup: [matchup('0001', '0004'), matchup('0002', '0003')] },
      { week: '4', matchup: [matchup('0001', '0002'), matchup('0003', '0004')] },
      { week: '5', matchup: [matchup('0001', '0003'), matchup('0002', '0004')] },
      // Week 6: 0001 has a bye (only one matchup)
      { week: '6', matchup: [matchup('0002', '0003')] },
    ],
  },
};

// Alpha dominant, Delta weak, Bravo/Charlie mid.
const WEEKLY = {
  weeks: [
    { week: 1, scores: { '0001': 140, '0002': 100, '0003': 110, '0004': 80 } },
    { week: 2, scores: { '0001': 150, '0003': 105, '0002': 95, '0004': 85 } },
    { week: 3, scores: { '0001': 145, '0004': 90, '0002': 105, '0003': 100 } },
  ],
};

const STANDINGS = {
  leagueStandings: {
    franchise: [
      { id: '0001', all_play_pct: '1.000', avgpf: '145' },
      { id: '0002', all_play_pct: '.444', avgpf: '100' },
      { id: '0003', all_play_pct: '.556', avgpf: '105' },
      { id: '0004', all_play_pct: '.000', avgpf: '85' },
    ],
  },
};

function compute(week = 4) {
  return computeScheduleStrength({
    leagueSlug: 'theleague',
    teams: TEAMS,
    schedule: SCHEDULE,
    standings: STANDINGS,
    weeklyResults: WEEKLY,
    week,
    year: 2026,
  });
}

describe('difficultyStep', () => {
  it('buckets the 0-100 scale into 5 steps', () => {
    expect(difficultyStep(0)).toBe(1);
    expect(difficultyStep(19)).toBe(1);
    expect(difficultyStep(20)).toBe(2);
    expect(difficultyStep(40)).toBe(3);
    expect(difficultyStep(60)).toBe(4);
    expect(difficultyStep(80)).toBe(5);
    expect(difficultyStep(100)).toBe(5);
  });
  it('maps non-finite to the neutral step 0', () => {
    expect(difficultyStep(null)).toBe(0);
    expect(difficultyStep(NaN)).toBe(0);
  });
});

describe('minMax01 / rollingAvgPF (shared lib re-home)', () => {
  it('normalizes to 0-100', () => {
    expect(minMax01([10, 20, 30])).toEqual([0, 50, 100]);
  });
  it('rolling average uses last N completed weeks', () => {
    expect(rollingAvgPF(WEEKLY, '0001', 3, 3)).toBeCloseTo((140 + 150 + 145) / 3, 5);
  });
});

describe('computeTeamStrengths', () => {
  it('ranks the dominant team strongest and the weak team weakest', () => {
    const strengths = computeTeamStrengths({
      franchiseIds: TEAMS.map(t => t.franchiseId),
      standingsByFid: new Map(STANDINGS.leagueStandings.franchise.map(f => [f.id, f])),
      weeklyResults: WEEKLY,
      throughWeek: 3,
    });
    expect(strengths.get('0001')!.strength).toBe(100);
    expect(strengths.get('0004')!.strength).toBe(0);
    expect(strengths.get('0003')!.strength).toBeGreaterThan(strengths.get('0004')!.strength);
    expect(strengths.get('0001')!.strength).toBeGreaterThan(strengths.get('0003')!.strength);
  });
});

describe('buildOpponentGrid', () => {
  it('maps both directions of each pairing and omits byes', () => {
    const grid = buildOpponentGrid(SCHEDULE);
    expect(grid.get('0001')!.get(1)).toEqual(['0002']);
    expect(grid.get('0002')!.get(1)).toEqual(['0001']);
    expect(grid.get('0001')!.has(6)).toBe(false); // bye
    expect(grid.get('0002')!.get(6)).toEqual(['0003']);
  });

  it('keeps BOTH games when a franchise plays twice in a week (AFL double-headers)', () => {
    const doubleHeader = {
      schedule: {
        weeklySchedule: [
          { week: '1', matchup: [matchup('0001', '0002'), matchup('0001', '0003'), matchup('0002', '0004'), matchup('0003', '0004')] },
        ],
      },
    };
    const grid = buildOpponentGrid(doubleHeader);
    expect(grid.get('0001')!.get(1)).toEqual(['0002', '0003']);
    expect(grid.get('0004')!.get(1)).toEqual(['0002', '0003']);
  });
});

describe('computeScheduleStrength', () => {
  it('ranks the run-in hardest first', () => {
    const r = compute();
    const diffs = r.runIn.map(x => x.difficulty);
    expect([...diffs].sort((a, b) => b - a)).toEqual(diffs);
    expect(r.runIn[0].rank).toBe(1);
  });

  it('teams facing Alpha more have harder schedules than teams facing Delta', () => {
    const r = compute();
    // Remaining (wk 4-6): Delta faces Charlie, Bravo — never Alpha after wk...
    // Bravo faces Alpha (4), Delta (5), Charlie (6); Charlie faces Delta (4), Alpha (5), Bravo (6).
    // Alpha faces Bravo (4), Charlie (5), bye (6) — mid opponents only.
    // Delta faces Charlie (4), Bravo (5) — mid opponents only.
    const byId = Object.fromEntries(r.runIn.map(x => [x.franchiseId, x.difficulty]));
    expect(byId['0002']).toBeGreaterThan(byId['0001']);
    expect(byId['0003']).toBeGreaterThan(byId['0004']);
  });

  it('marks byes as neutral step-0 cells', () => {
    const r = compute();
    const alpha = r.heatMap.franchises.find(f => f.franchiseId === '0001')!;
    const wk6 = alpha.cells.find(c => c.week === 6)!;
    expect(wk6.bye).toBe(true);
    expect(wk6.step).toBe(0);
    expect(wk6.difficulty).toBeNull();
  });

  it('computes records from completed weeks only', () => {
    const r = compute();
    const alpha = r.played.find(p => p.franchiseId === '0001')!;
    expect(alpha.record).toBe('3-0');
    const delta = r.played.find(p => p.franchiseId === '0004')!;
    expect(delta.record).toBe('0-3');
  });

  it('schedule luck: winless team on a hard slate reads unlucky', () => {
    const r = compute();
    // Delta (0-3) played Charlie, Bravo, Alpha — including the juggernaut.
    const delta = r.scheduleLuck.find(l => l.franchiseId === '0004');
    expect(delta).toBeDefined();
    expect(delta!.direction).toBe('unlucky');
    // Alpha is 3-0 (winPct 100) — any schedule reads lucky.
    const alpha = r.scheduleLuck.find(l => l.franchiseId === '0001');
    if (alpha) expect(alpha.direction).toBe('lucky');
  });

  it('trap weeks cover every remaining week with a league-average', () => {
    const r = compute();
    expect(r.trapWeeks.map(t => t.week)).toEqual([4, 5, 6]);
    for (const t of r.trapWeeks) {
      expect(t.avgDifficulty).not.toBeNull();
      expect(t.step).toBeGreaterThanOrEqual(1);
    }
  });

  it('every non-bye heat-map cell carries opponents + numeric difficulty + step', () => {
    const r = compute();
    for (const f of r.heatMap.franchises) {
      for (const c of f.cells) {
        if (c.bye) continue;
        expect(c.opps.length).toBeGreaterThanOrEqual(1);
        for (const g of c.opps) {
          expect(g.oppId).toBeTruthy();
          expect(g.oppAbbrev).toBeTruthy();
        }
        expect(Number.isFinite(c.difficulty)).toBe(true);
        expect(c.step).toBeGreaterThanOrEqual(1);
        expect(c.step).toBeLessThanOrEqual(5);
      }
    }
  });

  it('double-header weeks count every game in records and averages (AFL)', () => {
    // Week 1-3 each play the SAME two games per team: Alpha beats both
    // Bravo and Delta every week, Delta loses both.
    const dhSchedule = {
      schedule: {
        weeklySchedule: [1, 2, 3, 4].map(wk => ({
          week: String(wk),
          matchup: [
            matchup('0001', '0002'), matchup('0001', '0004'),
            matchup('0002', '0003'), matchup('0003', '0004'),
          ],
        })),
      },
    };
    const r = computeScheduleStrength({
      leagueSlug: 'afl-fantasy',
      teams: TEAMS,
      schedule: dhSchedule,
      standings: STANDINGS,
      weeklyResults: WEEKLY,
      week: 4,
      year: 2026,
    });
    const alpha = r.played.find(p => p.franchiseId === '0001')!;
    expect(alpha.record).toBe('6-0'); // 2 wins × 3 completed weeks
    const delta = r.played.find(p => p.franchiseId === '0004')!;
    expect(delta.record).toBe('0-6');
    // Heat-map cell for the remaining week carries both games.
    const alphaRow = r.heatMap.franchises.find(f => f.franchiseId === '0001')!;
    const wk4 = alphaRow.cells.find(c => c.week === 4)!;
    expect(wk4.opps.map(g => g.oppId)).toEqual(['0002', '0004']);
    expect(Number.isFinite(wk4.difficulty)).toBe(true);
  });
});

describe('attachTrends', () => {
  it('positive delta = schedule got harder (moved up the hardest-first board)', () => {
    const current = compute();
    const previous = {
      runIn: current.runIn.map((r, i, arr) => ({
        ...r,
        // Reverse last week's board so every team has a delta.
        franchiseId: arr[arr.length - 1 - i].franchiseId,
      })),
    };
    attachTrends(current, previous);
    const first = current.runIn[0];
    const last = current.runIn.at(-1)!;
    expect(first.prevRank).toBe(current.runIn.length);
    expect(first.trendDeltaRanks).toBe(current.runIn.length - 1);
    expect(last.trendDeltaRanks).toBe(-(current.runIn.length - 1));
  });

  it('leaves nulls when there is no prior week', () => {
    const current = compute();
    attachTrends(current, null);
    expect(current.runIn.every(r => r.prevRank === null && r.trendDeltaRanks === null)).toBe(true);
  });
});
