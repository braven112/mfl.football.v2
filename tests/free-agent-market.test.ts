import { describe, it, expect } from 'vitest';
import {
  tallyMarketMoves,
  isAvailableIn,
  isSidelined,
  positionLeaders,
  topMoves,
  nextGamesByTeam,
  type MarketPlayer,
} from '../src/utils/free-agent-market';

const NOW = 1_791_737_922;
const DAY = 86_400;

describe('tallyMarketMoves', () => {
  it('counts free-agent and blind-bid adds and drops inside the window', () => {
    const feed = {
      transactions: {
        transaction: [
          { type: 'FREE_AGENT', timestamp: String(NOW - DAY), transaction: '17030,|16384,' },
          { type: 'BBID_WAIVER', timestamp: String(NOW - 2 * DAY), transaction: '17030,|0.75|0510,' },
          { type: 'FREE_AGENT', timestamp: String(NOW - 3 * DAY), transaction: '17482,|' },
          // outside the window, and not a wire move
          { type: 'FREE_AGENT', timestamp: String(NOW - 9 * DAY), transaction: '17030,|' },
          { type: 'TRADE', timestamp: String(NOW - DAY), transaction: '17030,|' },
        ],
      },
    };
    const moves = tallyMarketMoves(feed, NOW, 7);
    expect(moves.get('17030')).toEqual({ adds: 2, drops: 0 });
    expect(moves.get('16384')).toEqual({ adds: 0, drops: 1 });
    expect(moves.get('0510')).toEqual({ adds: 0, drops: 1 });
    expect(moves.get('17482')).toEqual({ adds: 1, drops: 0 });
  });

  it('reads a single transaction object (MFL drops the array for one row)', () => {
    const feed = { transactions: { transaction: { type: 'FREE_AGENT', timestamp: String(NOW), transaction: '1,|' } } };
    expect(tallyMarketMoves(feed, NOW).get('1')).toEqual({ adds: 1, drops: 0 });
  });

  it('returns nothing for a missing feed', () => {
    expect(tallyMarketMoves(null, NOW).size).toBe(0);
  });
});

describe('availability', () => {
  const p: MarketPlayer = { id: '1', name: 'A', position: 'QB', confs: ['01'], lockedConfs: ['02'] };
  it('is per pool in a duplicate-player league', () => {
    expect(isAvailableIn(p, '00')).toBe(true);
    expect(isAvailableIn(p, '01')).toBe(false);
    expect(isAvailableIn(p, '02')).toBe(false); // locked after a drop
  });
  it('uses the rostered flag in a single-pool league', () => {
    expect(isAvailableIn({ ...p, rostered: true }, null)).toBe(false);
    expect(isAvailableIn({ ...p, rostered: false }, null)).toBe(true);
  });
  it('treats Out and IR as sidelined, Questionable as playable', () => {
    expect(isSidelined('Out')).toBe(true);
    expect(isSidelined('Injured Reserve')).toBe(true);
    expect(isSidelined('Questionable')).toBe(false);
    expect(isSidelined(undefined)).toBe(false);
  });
});

describe('positionLeaders', () => {
  const players: MarketPlayer[] = [
    { id: 'q1', name: 'QB One', position: 'QB', projected: 27.4, confs: [] },
    { id: 'q2', name: 'QB Two', position: 'QB', projected: 30, confs: ['00'] }, // held in 00
    { id: 'q3', name: 'QB Out', position: 'QB', projected: 21.7, confs: [] },
    { id: 'q4', name: 'QB Four', position: 'QB', projected: 17.1, confs: [] },
    { id: 'r1', name: 'RB One', position: 'RB', projected: 10.8, confs: [] },
    { id: 't0', name: 'TE None', position: 'TE', projected: 0, confs: [] },
  ];
  const injury = (id: string) => (id === 'q3' ? 'Out' : null);

  it('ranks the free agents in the pool by projection and skips sidelined players', () => {
    const out = positionLeaders(players, '00', ['QB', 'RB', 'TE'], { perPosition: 3, injuryStatus: injury });
    expect(out.map((g) => g.position)).toEqual(['QB', 'RB']);
    expect(out[0].players.map((p) => p.id)).toEqual(['q1', 'q4']);
  });

  it('includes a player held only in another pool', () => {
    const out = positionLeaders(players, '01', ['QB'], { injuryStatus: injury });
    expect(out[0].players[0].id).toBe('q2');
  });
});

describe('topMoves', () => {
  it('orders by count and drops players the page does not know', () => {
    const players: MarketPlayer[] = [
      { id: 'a', name: 'Alpha', position: 'WR' },
      { id: 'b', name: 'Bravo', position: 'RB' },
    ];
    const moves = new Map([
      ['a', { adds: 2, drops: 0 }],
      ['b', { adds: 5, drops: 1 }],
      ['zz', { adds: 9, drops: 0 }],
    ]);
    expect(topMoves(players, moves, 'adds', 5).map((m) => [m.player.id, m.count])).toEqual([['b', 5], ['a', 2]]);
    expect(topMoves(players, moves, 'drops', 5).map((m) => m.player.id)).toEqual(['b']);
  });
});

describe('nextGamesByTeam', () => {
  it('takes each team’s first game that has not kicked off, in ESPN codes', () => {
    const schedule = {
      fullNflSchedule: {
        nflSchedule: [
          { week: '5', matchup: [{ kickoff: String(NOW - DAY), team: [{ id: 'GBP', isHome: '1' }, { id: 'DAL', isHome: '0' }] }] },
          { week: '6', matchup: [{ kickoff: String(NOW + DAY), team: [{ id: 'GBP', isHome: '0' }, { id: 'KCC', isHome: '1' }] }] },
          { week: '7', matchup: [{ kickoff: String(NOW + 8 * DAY), team: [{ id: 'GBP', isHome: '1' }, { id: 'NOS', isHome: '0' }] }] },
        ],
      },
    };
    const next = nextGamesByTeam(schedule, NOW);
    expect(next.get('GB')).toEqual({ opponent: 'KC', home: false, kickoff: NOW + DAY });
    expect(next.get('KC')?.opponent).toBe('GB');
    expect(next.get('NO')?.opponent).toBe('GB');
    expect(next.has('DAL')).toBe(false);
  });
});
