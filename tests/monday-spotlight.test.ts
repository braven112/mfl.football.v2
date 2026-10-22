import { describe, it, expect } from 'vitest';
import { selectMondaySpotlight } from '../src/utils/monday-spotlight';
import type { LivePlayerRow } from '../src/types/live-scoring';

const FINAL = 0;
const UNPLAYED = 3600;
const row = (id: string, live: number, secondsRemaining: number): LivePlayerRow => ({
  id,
  live,
  secondsRemaining,
  status: 'starter',
});

describe('selectMondaySpotlight', () => {
  it('judges a game close by projection, not by the current score', () => {
    // A leads B by 1, but B has seven players still to play: a projected blowout.
    const players = {
      A: [row('a1', 81, FINAL)],
      B: [row('b1', 80, FINAL), ...Array.from({ length: 7 }, (_, i) => row(`b${i + 2}`, 0, UNPLAYED))],
      C: [row('c1', 90, FINAL), row('c2', 0, UNPLAYED)],
      D: [row('d1', 98, FINAL)],
    };
    const projections = new Map<string, number>([
      ...Array.from({ length: 7 }, (_, i) => [`b${i + 2}`, 10] as [string, number]),
      ['c2', 12],
    ]);
    const s = selectMondaySpotlight({
      matchups: [{ home: 'A', away: 'B' }, { home: 'C', away: 'D' }],
      players,
      projections,
    });
    // A-B (81 vs 150 projected) is out; C-D (102 vs 98) leads.
    expect(s?.game.home.franchiseId).toBe('C');
    expect(s?.others).toEqual([]);
  });

  it('never spotlights a blowout — no close game means no spotlight', () => {
    const s = selectMondaySpotlight({
      matchups: [{ home: 'A', away: 'B' }],
      players: { A: [row('a1', 140, FINAL), row('a2', 0, UNPLAYED)], B: [row('b1', 70, FINAL)] },
      projections: new Map([['a2', 8]]),
    });
    expect(s).toBeNull();
  });

  it('skips a game nobody still to play can swing', () => {
    const s = selectMondaySpotlight({
      matchups: [{ home: 'A', away: 'B' }],
      players: { A: [row('a1', 90, FINAL)], B: [row('b1', 89, FINAL)] },
      projections: new Map(),
    });
    expect(s).toBeNull();
  });

  it('features the still-to-play player with the most projected points, from either side', () => {
    const s = selectMondaySpotlight({
      matchups: [{ home: 'A', away: 'B' }],
      players: {
        A: [row('a1', 90, FINAL), row('a2', 0, UNPLAYED)],
        B: [row('b1', 85, FINAL), row('b2', 0, UNPLAYED), row('b3', 0, UNPLAYED)],
      },
      projections: new Map([['a2', 14], ['b2', 9], ['b3', 11]]),
    });
    expect(s?.players.map((p) => p.playerId)).toEqual(['a2', 'b3', 'b2']);
    expect(s?.players[0].franchiseId).toBe('A');
  });

  it("leads with the viewer's own game when it is close, else the league's closest", () => {
    const players = {
      A: [row('a1', 90, FINAL), row('a2', 0, UNPLAYED)],
      B: [row('b1', 95, FINAL)],
      C: [row('c1', 90, FINAL), row('c2', 0, UNPLAYED)],
      D: [row('d1', 100, FINAL)],
    };
    const projections = new Map([['a2', 10], ['c2', 12]]);
    const matchups = [{ home: 'A', away: 'B' }, { home: 'C', away: 'D' }];
    // A-B projects 100 vs 95 (5); C-D projects 102 vs 100 (2).
    expect(selectMondaySpotlight({ matchups, players, projections })?.game.home.franchiseId).toBe('C');
    const mine = selectMondaySpotlight({ matchups, players, projections, userFranchiseId: 'A' });
    expect(mine?.game.home.franchiseId).toBe('A');
    expect(mine?.game.isViewer).toBe(true);
    expect(mine?.others.map((g) => g.home.franchiseId)).toEqual(['C']);
  });

  it('keeps to the scope it is given', () => {
    const s = selectMondaySpotlight({
      matchups: [{ home: 'A', away: 'B' }],
      players: { A: [row('a1', 90, FINAL), row('a2', 0, UNPLAYED)], B: [row('b1', 95, FINAL)] },
      projections: new Map([['a2', 10]]),
      scopeFranchiseIds: ['C', 'D'],
    });
    expect(s).toBeNull();
  });
});

describe('buildMondaySpotlightProps', () => {
  it('returns nothing when no Monday game is close, so the page keeps its hero', async () => {
    const { buildMondaySpotlightProps } = await import('../src/utils/monday-spotlight-props');
    const props = await buildMondaySpotlightProps({
      league: 'theleague',
      week: 6,
      teams: [],
      loadImpl: async () =>
        ({
          ok: true,
          week: 6,
          scores: {},
          remaining: {},
          matchups: [{ home: 'A', away: 'B' }],
          players: { A: [row('a1', 140, FINAL)], B: [row('b1', 70, FINAL)] },
          bench: {},
          playersYetToPlay: {},
        }) as never,
      projectionsImpl: async () => new Map(),
    });
    expect(props).toBeUndefined();
  });

  it('returns nothing on an upstream failure', async () => {
    const { buildMondaySpotlightProps } = await import('../src/utils/monday-spotlight-props');
    const props = await buildMondaySpotlightProps({
      league: 'theleague',
      week: 6,
      teams: [],
      loadImpl: async () => ({ ok: false }) as never,
      projectionsImpl: async () => new Map(),
    });
    expect(props).toBeUndefined();
  });
});
