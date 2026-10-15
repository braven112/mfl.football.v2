/**
 * The handheld board's matchup sheet: both starting lineups, and the numbers
 * the player card prints. docs/plans/broadcast-handheld.md, Phase 2.
 */

import { describe, it, expect } from 'vitest';
import { handheldLineup, matchupKey } from '../src/utils/broadcast-handheld';
import type { LivePlayerRow, NflGame, PlayerMeta } from '../src/types/live-scoring';

const meta: Record<string, PlayerMeta> = {
  qb: { id: 'qb', name: 'Q Back', position: 'QB', nflTeam: 'KC', headshot: '', espnId: null, projected: 0 },
  rb: { id: 'rb', name: 'R Back', position: 'RB', nflTeam: 'BUF', headshot: '', espnId: null, projected: 0 },
  wr: { id: 'wr', name: 'W Rec', position: 'WR', nflTeam: 'SF', headshot: '', espnId: null, projected: 0 },
};

const game = (home: string, away: string, state: NflGame['state'], shortDetail: string) =>
  ({ home: { code: home }, away: { code: away }, state, shortDetail }) as unknown as NflGame;

describe('matchupKey', () => {
  it('keys by league and the matchup index, so a doubleheader is two sheets', () => {
    expect(matchupKey('13522', 0)).not.toBe(matchupKey('13522', 1));
    expect(matchupKey('13522', 0)).not.toBe(matchupKey('19621', 0));
  });
});

describe('handheldLineup', () => {
  const rows: LivePlayerRow[] = [
    { id: 'wr', live: 4, secondsRemaining: 3600, status: 'starter', projected: 12 },
    { id: 'qb', live: 18, secondsRemaining: 1800, status: 'starter', projected: 22 },
    { id: 'rb', live: 9.5, secondsRemaining: 0, status: 'starter' },
  ];
  const games = [game('KC', 'LV', 'in', 'Q3 4:08'), game('SF', 'SEA', 'pre', '1:25 PM')];

  it('lists starters in lineup order, by position', () => {
    expect(handheldLineup(rows, meta, games).map((p) => p.id)).toEqual(['qb', 'rb', 'wr']);
  });

  it('reads the projection from the ROW and works out what is still to come', () => {
    const qb = handheldLineup(rows, meta, games).find((p) => p.id === 'qb')!;
    expect(qb.projected).toBe(22);
    // Half a game left on a 22-point projection.
    expect(qb.projectedLeft).toBeCloseTo(11, 5);
  });

  it('says "no projection" rather than inventing a 0', () => {
    // `meta.projected` is a deliberate shared 0 and must never stand in.
    const rb = handheldLineup(rows, meta, games).find((p) => p.id === 'rb')!;
    expect(rb.projected).toBeNull();
    expect(rb.projectedLeft).toBeNull();
  });

  it('prints the game the way the TV strip does', () => {
    const byId = Object.fromEntries(handheldLineup(rows, meta, games).map((p) => [p.id, p]));
    expect(byId.qb.clock).toBe('Q3 4:08');
    expect(byId.wr.clock).toBe('Yet to play');
    // No ESPN game for BUF: MFL's own state word, never a derived number.
    expect(byId.rb.clock).toBe('Final');
  });

  it('names a player the board has no identity for instead of dropping the row', () => {
    const [p] = handheldLineup([{ id: 'x', live: 1, secondsRemaining: 0, status: 'starter' }], {}, []);
    expect(p.name).toBe('Player x');
  });
});
