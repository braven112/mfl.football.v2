/**
 * `originalProjection` — the starters' full-game projections, summed, which
 * the matchup detail page shows after the final so an owner can see how far
 * off the forecast was (the live projected final equals the score by then).
 */
import { describe, it, expect } from 'vitest';
import { originalProjection } from '../src/utils/live/model';
import type { LivePlayerRow, PlayerMeta } from '../src/types/live-scoring';

const row = (id: string, live: number, projected?: number): LivePlayerRow =>
  ({ id, live, secondsRemaining: 0, ...(projected === undefined ? {} : { projected }) }) as LivePlayerRow;

describe('originalProjection', () => {
  it('sums the starters full-game projections, not their live points', () => {
    const team = { players: [row('1', 30, 20.5), row('2', 4, 12.25)] };
    expect(originalProjection(team)).toBeCloseTo(32.75);
  });

  it('reads the row before the shared meta map', () => {
    const meta = { '1': { projected: 99 }, '2': { projected: 7 } } as unknown as Record<string, PlayerMeta>;
    const team = { players: [row('1', 0, 10), row('2', 0)] };
    expect(originalProjection(team, meta)).toBe(17);
  });

  it('is null when no starter has a projection (Sleeper, a replay)', () => {
    expect(originalProjection({ players: [row('1', 12), row('2', 3, 0)] })).toBeNull();
    expect(originalProjection({ players: [] })).toBeNull();
  });
});
