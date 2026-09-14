import { describe, it, expect } from 'vitest';
import type { LivePlayerRow, PlayerMeta } from '../src/types/live-scoring';
import {
  MFL_LIVE_POSITION_ORDER,
  normalizePosition,
  orderLineupRows,
  positionLabel,
  positionRank,
} from '../src/utils/mfl-live-lineup';

/**
 * The reading order of a matchup on MFL Live: QB, RB, WR, TE, K, DEF, with
 * several of a position sitting together, and the bench in the same order.
 *
 * The property that matters most is not the order itself but its STABILITY.
 * MFL returns arrays in nondeterministic order, so any ordering that falls
 * back to the feed's own sequence reshuffles itself between two polls of an
 * unchanged lineup — which is also why there is no FLEX group here: a flex
 * label is derived by filling required slots and calling the leftovers flex,
 * so "the flex" would be whichever back the feed happened to list second.
 */

const row = (id: string, live = 0, secondsRemaining = 0): LivePlayerRow => ({
  id,
  live,
  secondsRemaining,
  status: 'starter',
});

const meta = (entries: Record<string, string>): Record<string, PlayerMeta> => {
  const out: Record<string, PlayerMeta> = {};
  for (const [id, position] of Object.entries(entries)) {
    out[id] = {
      id,
      name: `Player ${id}`,
      position,
      nflTeam: 'KC',
      headshot: '',
      espnId: null,
      projected: 0,
    };
  }
  return out;
};

const positionsOf = (rows: LivePlayerRow[], m: Record<string, PlayerMeta>) =>
  rows.map((r) => m[r.id]?.position ?? '');

describe('normalizePosition — MFL is not self-consistent', () => {
  it('folds the kicker spellings together', () => {
    expect(normalizePosition('K')).toBe('PK');
    expect(normalizePosition('PK')).toBe('PK');
    expect(normalizePosition('pk')).toBe('PK');
  });

  it('folds the team-defence spellings together', () => {
    // `league.starters` says Def, the player feed says DEF, ESPN-shaped
    // sources say DST or D/ST.
    for (const spelling of ['DEF', 'Def', 'def', 'DST', 'D/ST', 'defense']) {
      expect(normalizePosition(spelling), spelling).toBe('DEF');
    }
  });

  it('passes an unknown position through rather than guessing', () => {
    expect(normalizePosition('LB')).toBe('LB');
  });

  it.each([null, undefined, '', '   '])('treats %o as no position', (input) => {
    expect(normalizePosition(input)).toBe('');
  });
});

describe('positionLabel — what the chip says', () => {
  it('shows K, never MFL’s PK', () => {
    expect(positionLabel('PK')).toBe('K');
    expect(positionLabel('K')).toBe('K');
  });

  it('leaves every other position alone', () => {
    expect(positionLabel('QB')).toBe('QB');
    expect(positionLabel('DEF')).toBe('DEF');
    expect(positionLabel('Def')).toBe('DEF');
  });
});

describe('positionRank', () => {
  it('ranks the six positions in reading order', () => {
    const ranks = MFL_LIVE_POSITION_ORDER.map((p) => positionRank(p));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(MFL_LIVE_POSITION_ORDER.length);
  });

  it('is the order the user asked for', () => {
    expect([...MFL_LIVE_POSITION_ORDER]).toEqual(['QB', 'RB', 'WR', 'TE', 'PK', 'DEF']);
  });

  it('sorts an unknown position last, and all of them together', () => {
    const last = MFL_LIVE_POSITION_ORDER.length;
    expect(positionRank('LB')).toBe(last);
    expect(positionRank('')).toBe(last);
    expect(positionRank('LB')).toBe(positionRank('P'));
  });
});

describe('orderLineupRows', () => {
  it('puts a full lineup in QB, RB, WR, TE, K, DEF order', () => {
    const m = meta({
      d: 'DEF', k: 'PK', w1: 'WR', q: 'QB', t: 'TE', r1: 'RB',
    });
    const out = orderLineupRows([row('d'), row('k'), row('w1'), row('q'), row('t'), row('r1')], m);
    expect(positionsOf(out, m)).toEqual(['QB', 'RB', 'WR', 'TE', 'PK', 'DEF']);
  });

  /** The whole point of dropping flex: the second back sits with the first. */
  it('groups several of a position together instead of flexing one out', () => {
    const m = meta({ q: 'QB', r1: 'RB', r2: 'RB', w1: 'WR', w2: 'WR', w3: 'WR', t: 'TE' });
    const out = orderLineupRows(
      [row('w3'), row('r2'), row('t'), row('q'), row('w1'), row('r1'), row('w2')],
      m,
    );
    expect(positionsOf(out, m)).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE']);
  });

  it('leads each position with its highest scorer', () => {
    const m = meta({ r1: 'RB', r2: 'RB', r3: 'RB' });
    const out = orderLineupRows([row('r1', 4.2), row('r2', 18.7), row('r3', 11.1)], m);
    expect(out.map((r) => r.id)).toEqual(['r2', 'r3', 'r1']);
  });

  it('accepts a kicker written K and still sorts it fifth', () => {
    const m = meta({ k: 'K', q: 'QB', d: 'DEF' });
    const out = orderLineupRows([row('d'), row('k'), row('q')], m);
    expect(out.map((r) => r.id)).toEqual(['q', 'k', 'd']);
  });

  it('puts a position it cannot resolve last rather than in a bucket it is not in', () => {
    const m = meta({ q: 'QB', mystery: '', d: 'DEF' });
    const out = orderLineupRows([row('mystery'), row('d'), row('q')], m);
    expect(out.map((r) => r.id)).toEqual(['q', 'd', 'mystery']);
  });

  it('handles a row with no meta at all', () => {
    const m = meta({ q: 'QB' });
    const out = orderLineupRows([row('ghost'), row('q')], m);
    expect(out.map((r) => r.id)).toEqual(['q', 'ghost']);
  });

  describe('stability — MFL orders its arrays nondeterministically', () => {
    const m = meta({ q: 'QB', r1: 'RB', r2: 'RB', w1: 'WR', w2: 'WR', k: 'PK', d: 'DEF' });
    const ids = ['q', 'r1', 'r2', 'w1', 'w2', 'k', 'd'];

    it('gives the same answer whatever order the feed used', () => {
      const scores: Record<string, number> = { q: 0, r1: 0, r2: 0, w1: 0, w2: 0, k: 0, d: 0 };
      const shuffles = [
        ['q', 'r1', 'r2', 'w1', 'w2', 'k', 'd'],
        ['d', 'k', 'w2', 'w1', 'r2', 'r1', 'q'],
        ['w1', 'd', 'q', 'k', 'r2', 'w2', 'r1'],
        ['r2', 'w2', 'q', 'd', 'r1', 'w1', 'k'],
      ];
      const results = shuffles.map((order) =>
        orderLineupRows(order.map((id) => row(id, scores[id])), m).map((r) => r.id).join(','),
      );
      // An all-zero lineup is every Sunday morning before kickoff — the case
      // where a feed-index tiebreak would visibly reshuffle between polls.
      expect(new Set(results).size).toBe(1);
    });

    it('is stable when scores tie mid-game too', () => {
      const tied = ids.map((id) => row(id, 7.5));
      const a = orderLineupRows(tied, m).map((r) => r.id);
      const b = orderLineupRows([...tied].reverse(), m).map((r) => r.id);
      expect(a).toEqual(b);
    });
  });

  it('never mutates the input', () => {
    const m = meta({ d: 'DEF', q: 'QB' });
    const input = [row('d'), row('q')];
    const before = input.map((r) => r.id);
    orderLineupRows(input, m);
    expect(input.map((r) => r.id)).toEqual(before);
  });

  it('returns an empty list for an empty lineup', () => {
    expect(orderLineupRows([], {})).toEqual([]);
  });
});

/**
 * The bench is ordered by the SAME function, which is the whole requirement —
 * "then bench in the same order".
 */
describe('the bench reads the same way as the lineup', () => {
  it('orders a bench by position exactly as it orders a lineup', () => {
    const m = meta({ b1: 'DEF', b2: 'RB', b3: 'QB', b4: 'WR' });
    const out = orderLineupRows([row('b1'), row('b2'), row('b3'), row('b4')], m);
    expect(positionsOf(out, m)).toEqual(['QB', 'RB', 'WR', 'DEF']);
  });
});
