import { describe, it, expect } from 'vitest';
import { buildMyRanks, contractRedraftShare, redraftScore, toOrdinal } from '../src/utils/my-ranks';
import type { BoardFile, BoardPlayer } from '../src/utils/private-rankings-view';

const board = (players: BoardPlayer[]): BoardFile => ({
  league: { key: 'theleague', label: 'The League' },
  generatedAt: '2026-11-22T00:00:00Z',
  mflYear: 2026,
  rookieClass: 2026,
  sources: {},
  players,
});
const P = (id: string, extra: Partial<BoardPlayer>): BoardPlayer => ({ id, name: id, pos: 'WR', team: 'SEA', age: 25, ...extra });

describe('my ranks', () => {
  it('ranks this week by projected points and never by dynasty', () => {
    const r = buildMyRanks({
      board: board([
        P('a', { dynasty: { avg: 1 }, season: { ros: 30, weekPts: 8 } }),
        P('b', { dynasty: { avg: 90 }, season: { ros: 10, weekPts: 20 } }),
        P('c', { dynasty: { avg: 2 } }), // dynasty only: no lineup rank at all
        P('d', { season: { ros: 5 } }), // no weekly line: follows in ROS order
      ]),
      inSeason: true,
    });
    expect(r.week.ranks).toEqual({ b: 1, a: 2, d: 3 });
    expect(r.week.ranks.c).toBeUndefined();
  });

  it('uses ROS in season and the preseason list off season', () => {
    const p = P('a', { season: { ros: 40 }, redraft: { fbg: 12 } });
    expect(redraftScore(p, true)).toBe(40);
    expect(redraftScore(p, false)).toBe(12);
    expect(redraftScore(P('b', { redraft: { fp: { rank: 7, best: null, worst: null, tier: null } } }), false)).toBe(7);
    expect(redraftScore(P('c', { season: { ros: 9 } }), false)).toBe(9);
  });

  it('blends by contract years left: 1 = redraft, 2 = half, 3+ = mostly dynasty', () => {
    expect(contractRedraftShare(1)).toBe(1);
    expect(contractRedraftShare(undefined)).toBe(1);
    expect(contractRedraftShare(2)).toBe(0.5);
    expect(contractRedraftShare(4)).toBe(0.25);
    // a: great this year, poor long term. b: the reverse.
    const players = [
      P('a', { season: { ros: 1 }, dynasty: { avg: 2 } }),
      P('b', { season: { ros: 2 }, dynasty: { avg: 1 } }),
    ];
    const oneYear = buildMyRanks({ board: board(players), inSeason: true, contractYears: { a: 1, b: 1 } });
    expect(oneYear.contract.ranks).toEqual({ a: 1, b: 2 });
    const long = buildMyRanks({ board: board(players), inSeason: true, contractYears: { a: 4, b: 4 } });
    expect(long.contract.ranks).toEqual({ b: 1, a: 2 });
  });

  it('follows the Blend slider', () => {
    const players = [
      P('a', { season: { ros: 1 }, dynasty: { avg: 2 } }),
      P('b', { season: { ros: 2 }, dynasty: { avg: 1 } }),
    ];
    expect(buildMyRanks({ board: board(players), inSeason: true, blendRedraftPct: 100 }).blend.ranks).toEqual({ a: 1, b: 2 });
    expect(buildMyRanks({ board: board(players), inSeason: true, blendRedraftPct: 0 }).blend.ranks).toEqual({ b: 1, a: 2 });
    expect(buildMyRanks({ board: board(players), inSeason: true, blendRedraftPct: 70 }).blend.label).toBe('your blend, 70% redraft / 30% dynasty');
  });

  it('skips players with no MFL id and ranks ordinally', () => {
    expect(toOrdinal([['x', 5], ['y', 2], ['z', 5]])).toEqual({ y: 1, x: 2, z: 3 });
    const r = buildMyRanks({ board: board([{ ...P('a', { rookie: { avg: 3 } }), id: null }]), inSeason: false });
    expect(r.rookie.ranks).toEqual({});
  });

  it('ranks dynasty by the FBG + DLF average, ignoring redraft (Projected Free Agents)', () => {
    const r = buildMyRanks({
      board: board([
        P('a', { dynasty: { avg: 40 }, season: { ros: 1 } }),
        P('b', { dynasty: { avg: 3 } }),
        P('c', { season: { ros: 2 } }), // no dynasty rank: not on this list
      ]),
      inSeason: true,
    });
    expect(r.dynasty.ranks).toEqual({ b: 1, a: 2 });
    expect(r.dynasty.label).toContain('FBG + DLF');
  });
});
