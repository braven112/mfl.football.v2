/**
 * ESPN-first live scores (src/utils/live/espn-overlay.ts): a player moves the
 * moment ESPN's box score has a stat MFL has not counted, MFL takes back over
 * once it catches up, and the stat sheet never shows a "Not itemized" line
 * below zero while ESPN is ahead.
 */
import { describe, expect, it } from 'vitest';
import {
  SETTLE_MS,
  STALE_MS,
  overlayPanel,
  overlayPlayerLive,
  type OverlayMemory,
} from '../src/utils/live/espn-overlay';
import type { PositionRuleSet } from '../src/utils/live/scoring-rules';
import type { LivePanel, LiveTeam } from '../src/types/live';

const MIN = 60_000;

/** One player observed over time: `[atMs, mfl, itemized]` → shown scores. */
function run(steps: Array<[number, number, number | null]>): number[] {
  const memory: OverlayMemory = new Map();
  return steps.map(([now, mfl, itemized]) => overlayPlayerLive({ key: 'L:1', mfl, itemized, now, memory }));
}

describe('overlayPlayerLive', () => {
  it('agrees with MFL when both feeds say the same thing', () => {
    expect(run([[0, 12.3, 12.3], [MIN, 12.3, 12.3]])).toEqual([12.3, 12.3]);
  });

  it('shows ESPN the moment it scores a stat MFL has not counted yet', () => {
    // A 20-yard TD catch: ESPN +8, MFL still on the old number.
    expect(run([[0, 10, 10], [MIN, 10, 18]])).toEqual([10, 18]);
  });

  it('hands back to MFL once it catches up, including a bonus the box score cannot see', () => {
    expect(
      run([
        [0, 10, 10],
        [MIN, 10, 18], // ESPN ahead
        [2 * MIN, 21, 18], // MFL catches up with a +3 long-TD bonus
      ]),
    ).toEqual([10, 18, 21]);
  });

  it('never drops below MFL once MFL has moved', () => {
    expect(run([[0, 10, 10], [MIN, 10, 18], [2 * MIN, 19, 18]])).toEqual([10, 18, 19]);
  });

  it('keeps an unitemized gap MFL scores beyond the box score', () => {
    // MFL counts 2 points ESPN's line cannot see (first downs, say).
    expect(run([[0, 12, 10], [MIN, 12, 16]])).toEqual([12, 18]);
  });

  it('a board opened with ESPN already ahead shows the newer number at once', () => {
    expect(run([[0, 10, 18]])).toEqual([18]);
  });

  it('retakes the baseline once ESPN has sat still long enough for MFL to score it', () => {
    // ESPN ahead; MFL catches up to 18 after SETTLE_MS, then ESPN moves again.
    expect(
      run([
        [0, 10, 10],
        [MIN, 10, 18],
        [MIN + SETTLE_MS, 18, 18],
        [MIN + SETTLE_MS + MIN, 18, 24],
      ]),
    ).toEqual([10, 18, 18, 24]);
  });

  it('follows a stat correction downward once it settles', () => {
    // ESPN takes back a catch; after it settles MFL agrees and the baseline resets.
    expect(
      run([
        [0, 16, 16],
        [MIN, 16, 12],
        [MIN + SETTLE_MS, 12, 12],
      ]),
    ).toEqual([16, 12, 12]);
  });

  it('keeps ESPN while MFL lags past the settle window, then accepts MFL long after', () => {
    expect(
      run([
        [0, 10, 10],
        [MIN, 10, 18],
        [MIN + SETTLE_MS, 10, 18], // MFL still behind: hold ESPN
        [MIN + STALE_MS, 16, 18], // MFL settled lower for good: take its answer
      ]),
    ).toEqual([10, 18, 18, 16]);
  });

  it('stays on MFL with no box score', () => {
    expect(run([[0, 7, null]])).toEqual([7]);
  });
});

const rules: PositionRuleSet[] = [
  {
    positions: ['WR'],
    rules: [
      { event: ['CY'], lo: -999, hi: 999, kind: 'per', points: 0.1, every: 1 },
      { event: ['#C'], lo: 1, hi: 99, kind: 'per', points: 6, every: 1 },
    ],
  },
];

function team(id: string, live: number, players: Array<[string, number]>): LiveTeam {
  return {
    franchiseId: id,
    name: id,
    nameShort: id,
    initials: id.slice(0, 2),
    icon: '',
    iconAlt: '',
    live,
    projectedFinal: live + 10,
    remainingPoints: 10,
    yetToPlay: 0,
    players: players.map(([pid, pts]) => ({ id: pid, live: pts, secondsRemaining: 1800, status: 'live' })),
    bench: [],
  } as unknown as LiveTeam;
}

function panel(provider?: 'sleeper'): LivePanel {
  return {
    leagueId: 'L',
    leagueName: 'L',
    slug: null,
    registered: false,
    provider,
    viewerFranchiseId: null,
    status: 'ok',
    matchups: [
      {
        index: 0,
        sides: [team('0001', 10, [['p1', 10]]), team('0002', 10, [['p2', 10]])],
        viewerSide: null,
        p0: 0.5,
      },
    ],
  } as unknown as LivePanel;
}

const meta = { p1: { position: 'WR' }, p2: { position: 'WR' } } as never;
const box = (cy: number, td = 0) => ({ p1: { stats: { CY: cy, '#C': td } } }) as never;

describe('overlayPanel', () => {
  it('moves the player, the team total and the win odds together', () => {
    const memory: OverlayMemory = new Map();
    const ctx = { rules, meta, memory };
    const before = overlayPanel(panel(), { ...ctx, boxScore: box(100), now: 0 });
    expect(before.matchups[0].sides[0].live).toBe(10);
    const after = overlayPanel(panel(), { ...ctx, boxScore: box(120, 1), now: MIN });
    const side = after.matchups[0].sides[0];
    expect(side.players[0].live).toBe(18);
    expect(side.live).toBe(18);
    expect(side.projectedFinal).toBe(28);
    expect(after.matchups[0].p0).toBeGreaterThan(0.5);
  });

  it('returns the same panel when nothing is newer', () => {
    const p = panel();
    expect(overlayPanel(p, { rules, meta, memory: new Map(), boxScore: box(100), now: 0 })).toBe(p);
  });

  it('leaves a Sleeper league and a league without rules on their own numbers', () => {
    const s = panel('sleeper');
    expect(overlayPanel(s, { rules, meta, memory: new Map(), boxScore: box(200, 1), now: 0 })).toBe(s);
    const p = panel();
    expect(overlayPanel(p, { rules: null, meta, memory: new Map(), boxScore: box(200, 1), now: 0 })).toBe(p);
  });
});
