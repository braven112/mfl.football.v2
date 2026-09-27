/**
 * The Standings tab's Projected / Live / Final views.
 *
 * Final is MFL's table untouched. Live and Projected add this week and
 * re-rank — and must never add a week MFL has already counted.
 * `src/utils/live/standings-projection.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STANDINGS_MODE,
  projectStandings,
} from '../src/utils/live/standings-projection';
import { markWeekCounted } from '../src/utils/live/standings';
import { parsePriorGameCounts } from '../src/utils/mfl-schedule-pairings';
import type { LiveMatchup, LiveStandingsRow, LiveTeam } from '../src/types/live';

const row = (
  franchiseId: string,
  rank: number,
  wins: number,
  losses: number,
  pointsFor: number,
  weekGamesCounted: number | null = 0,
): LiveStandingsRow => ({
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
  weekGamesCounted,
});

const side = (
  franchiseId: string,
  live: number,
  projectedFinal: number,
  secondsRemaining = 1800,
): LiveTeam => ({
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

// MFL order: A (4-0), B (4-0), C (3-1), D (3-1). A plays C, B plays D.
const rows = [row('A', 1, 4, 0, 400), row('B', 2, 4, 0, 390), row('C', 3, 3, 1, 380), row('D', 4, 3, 1, 370)];
// Live: C leads A, D leads B. Projected: A and B come back.
const week = [
  matchup(side('A', 50, 120), side('C', 60, 100)),
  matchup(side('B', 40, 110), side('D', 70, 90), 1),
];

describe('views', () => {
  it('defaults to Live', () => {
    expect(DEFAULT_STANDINGS_MODE).toBe('live');
  });

  it('Final is MFL’s rows, untouched and unmoved', () => {
    const out = projectStandings(rows, week, 'final');
    expect(out.map((r) => r.franchiseId)).toEqual(['A', 'B', 'C', 'D']);
    expect(out.map((r) => [r.wins, r.losses, r.move])).toEqual([
      [4, 0, 0],
      [4, 0, 0],
      [3, 1, 0],
      [3, 1, 0],
    ]);
  });

  it('Live adds the current scores and re-ranks, remembering the official rank', () => {
    const out = projectStandings(rows, week, 'live');
    // Every team is 4-1 now; points decide: A 450, B 430, C 440, D 440 →
    // A, C/D by points then official rank.
    expect(out.map((r) => r.franchiseId)).toEqual(['A', 'C', 'D', 'B']);
    const b = out.find((r) => r.franchiseId === 'B')!;
    expect(b).toMatchObject({ wins: 4, losses: 1, pointsFor: 430, officialRank: 2, rank: 4, move: -2 });
    const c = out.find((r) => r.franchiseId === 'C')!;
    expect(c).toMatchObject({ wins: 4, losses: 1, move: 1, includesWeek: true });
  });

  it('Projected uses projected finals', () => {
    const out = projectStandings(rows, week, 'projected');
    expect(out.map((r) => r.franchiseId)).toEqual(['A', 'B', 'C', 'D']);
    expect(out[0]).toMatchObject({ wins: 5, losses: 0, pointsFor: 520 });
    expect(out[3]).toMatchObject({ wins: 3, losses: 2 });
  });

  it('Live ignores a matchup nobody has played; Projected does not', () => {
    const unplayed = [matchup(side('A', 0, 120), side('C', 0, 100))];
    unplayed[0].sides.forEach((s) => (s.yetToPlay = s.players.length));
    // Nothing to add → MFL's own order, not a re-rank of unchanged records.
    expect(projectStandings(rows, unplayed, 'live').every((r) => !r.includesWeek && r.move === 0)).toBe(true);
    expect(projectStandings(rows, unplayed, 'projected').find((r) => r.franchiseId === 'A')!.wins).toBe(5);
  });

  it('counts both games of a doubleheader', () => {
    const dh = [
      matchup(side('A', 90, 90), side('C', 60, 60)),
      matchup(side('A', 90, 90), side('D', 70, 70), 1),
    ];
    const a = projectStandings(rows, dh, 'live').find((r) => r.franchiseId === 'A')!;
    expect(a).toMatchObject({ wins: 6, losses: 0, pointsFor: 580 });
  });
});

describe('never counts a week twice', () => {
  it('leaves a row MFL has already counted alone', () => {
    const counted = rows.map((r) => ({ ...r, weekGamesCounted: 1 }));
    const out = projectStandings(counted, week, 'live');
    expect(out.map((r) => r.franchiseId)).toEqual(['A', 'B', 'C', 'D']);
    expect(out.every((r) => !r.includesWeek)).toBe(true);
  });

  it('unknown count: adds an unfinished matchup, never a finished one', () => {
    const unknown = rows.map((r) => ({ ...r, weekGamesCounted: null }));
    const inProgress = projectStandings(unknown, week, 'live');
    expect(inProgress.find((r) => r.franchiseId === 'C')!.wins).toBe(4);

    const finished = [
      matchup(side('A', 50, 50, 0), side('C', 60, 60, 0)),
      matchup(side('B', 40, 40, 0), side('D', 70, 70, 0), 1),
    ];
    const out = projectStandings(unknown, finished, 'live');
    expect(out.every((r) => !r.includesWeek)).toBe(true);
  });

  it('half-counted doubleheader: adds only the game MFL does not hold yet', () => {
    // A played C (final, counted by MFL) and is playing D (live).
    const dh = [
      matchup(side('A', 90, 90, 0), side('C', 60, 60, 0)),
      matchup(side('A', 50, 90), side('D', 70, 70), 1),
    ];
    const half = rows.map((r) => ({ ...r, weekGamesCounted: r.franchiseId === 'A' ? 1 : 0 }));
    const a = projectStandings(half, dh, 'live').find((r) => r.franchiseId === 'A')!;
    // Only the live loss to D is added; the counted win over C is not repeated.
    expect(a).toMatchObject({ wins: 4, losses: 1, pointsFor: 450 });
  });

  it('unknown count with a doubleheader: the finished half is never added', () => {
    const dh = [
      matchup(side('A', 90, 90, 0), side('C', 60, 60, 0)),
      matchup(side('A', 50, 90), side('D', 70, 70), 1),
    ];
    const unknown = rows.map((r) => ({ ...r, weekGamesCounted: null }));
    const a = projectStandings(unknown, dh, 'live').find((r) => r.franchiseId === 'A')!;
    expect(a).toMatchObject({ wins: 4, losses: 1, pointsFor: 450 });
  });

  it('markWeekCounted counts the games held beyond the schedule before the week', () => {
    const marked = markWeekCounted(
      [row('A', 1, 4, 0, 0), row('B', 2, 3, 0, 0), row('C', 3, 5, 0, 0)],
      { A: 3, B: 3, C: 3 },
    );
    expect(marked.map((r) => r.weekGamesCounted)).toEqual([1, 0, 2]);
    expect(markWeekCounted([row('A', 1, 0, 0, 0)], null)[0].weekGamesCounted).toBeNull();
    // Week 1: no prior games in the map at all, nothing played yet.
    expect(markWeekCounted([row('A', 1, 0, 0, 0)], {})[0].weekGamesCounted).toBe(0);
  });
});

describe('parsePriorGameCounts', () => {
  const schedule = {
    schedule: {
      weeklySchedule: [
        { week: '1', matchup: [{ franchise: [{ id: '0001' }, { id: '0002' }] }] },
        {
          week: '2',
          // A doubleheader for 0001, and a one-sided BYE entry for 0003.
          matchup: [
            { franchise: [{ id: '0001' }, { id: '0002' }] },
            { franchise: [{ id: '0001' }, { id: '0003' }] },
            { franchise: { id: '0004' } },
          ],
        },
        { week: '3', matchup: [{ franchise: [{ id: '0001' }, { id: '0002' }] }] },
      ],
    },
  };

  it('counts games strictly before the week, per franchise', () => {
    expect(parsePriorGameCounts(schedule, 3)).toEqual({ '0001': 3, '0002': 2, '0003': 1 });
    expect(parsePriorGameCounts(schedule, 1)).toEqual({});
  });

  it('is null for a payload with no weeks — a failed read, not an empty season', () => {
    expect(parsePriorGameCounts({ error: 'nope' }, 3)).toBeNull();
    expect(parsePriorGameCounts(null, 3)).toBeNull();
  });
});
