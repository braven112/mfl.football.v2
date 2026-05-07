import { describe, it, expect } from 'vitest';
import {
  findThreeTeamCandidate,
  __testing__ as matchingTesting,
// @ts-expect-error — sibling .mjs module, no .d.ts
} from '../scripts/lib/speculation-matching.mjs';
import {
  threeTeamTradeSignature,
// @ts-expect-error — sibling .mjs module, no .d.ts
} from '../scripts/lib/speculation-history.mjs';

const { isThreeWayParity, scoreThreeTeamCandidate, pickPieceFor } = matchingTesting;

// ── isThreeWayParity ──

describe('isThreeWayParity (22% tolerance, mean-based)', () => {
  it('three equal values pass', () => {
    expect(isThreeWayParity(60, 60, 60)).toBe(true);
  });

  it('20% spread off the mean passes', () => {
    // mean = 100; max-min = 20 → 20% < 22%
    expect(isThreeWayParity(90, 110, 100)).toBe(true);
  });

  it('30% spread off the mean fails', () => {
    expect(isThreeWayParity(80, 120, 100)).toBe(false);
  });

  it('any zero or negative value fails closed', () => {
    expect(isThreeWayParity(0, 50, 50)).toBe(false);
    expect(isThreeWayParity(-1, 50, 50)).toBe(false);
  });
});

// ── scoreThreeTeamCandidate ──

describe('scoreThreeTeamCandidate', () => {
  const tightPieces = {
    fromA: { value: 80, onTradeBait: false },
    fromB: { value: 80, onTradeBait: false },
    fromC: { value: 80, onTradeBait: false },
  };
  const noDivisions = { a: 'East', b: 'West', c: 'Central' };

  it('rewards tighter parity with a higher parity score', () => {
    const tight = scoreThreeTeamCandidate({ pieces: tightPieces, divisions: noDivisions });
    const loose = scoreThreeTeamCandidate({
      pieces: {
        fromA: { value: 70, onTradeBait: false },
        fromB: { value: 90, onTradeBait: false },
        fromC: { value: 80, onTradeBait: false },
      },
      divisions: noDivisions,
    });
    expect(tight).toBeGreaterThan(loose);
  });

  it('adds drama for divisional pairs (3 same-division teams = 30 dram pts)', () => {
    const sameDivision = scoreThreeTeamCandidate({
      pieces: tightPieces,
      divisions: { a: 'East', b: 'East', c: 'East' },
    });
    const noShared = scoreThreeTeamCandidate({
      pieces: tightPieces,
      divisions: noDivisions,
    });
    // 3 pairs all in same division → 3 × 10 = 30 drama pts above the no-shared baseline
    expect(sameDivision - noShared).toBe(30);
  });

  it('adds 5 per piece on its team’s tradeBait listing', () => {
    const allBait = scoreThreeTeamCandidate({
      pieces: {
        fromA: { value: 80, onTradeBait: true },
        fromB: { value: 80, onTradeBait: true },
        fromC: { value: 80, onTradeBait: true },
      },
      divisions: noDivisions,
    });
    const noBait = scoreThreeTeamCandidate({ pieces: tightPieces, divisions: noDivisions });
    expect(allBait - noBait).toBe(15);
  });
});

// ── pickPieceFor ──

describe('pickPieceFor', () => {
  const haves = [
    { id: 'p1', position: 'WR', salary: 4_000_000, value: 70, onTradeBait: true },
    { id: 'p2', position: 'RB', salary: 2_000_000, value: 60, onTradeBait: false },
    { id: 'p3', position: 'TE', salary: 800_000, value: 32, onTradeBait: true },
  ];

  it('returns the highest-value have whose position matches a want', () => {
    const out = pickPieceFor({
      srcHaves: haves,
      wantedPositions: ['WR', 'TE'],
      dstCapRoom: 10_000_000,
      claimedIds: new Set(),
    });
    expect(out?.id).toBe('p1');
  });

  it('skips haves whose salary exceeds the receiving team’s cap room', () => {
    const out = pickPieceFor({
      srcHaves: haves,
      wantedPositions: ['WR'],
      dstCapRoom: 1_000_000,
      claimedIds: new Set(),
    });
    expect(out).toBeNull();
  });

  it('skips already-claimed pieces so a triple cycle uses three distinct ids', () => {
    const out = pickPieceFor({
      srcHaves: haves,
      wantedPositions: ['WR', 'TE'],
      dstCapRoom: 10_000_000,
      claimedIds: new Set(['p1']),
    });
    expect(out?.id).toBe('p3');
  });

  it('rejects pieces below MIN_THREE_TEAM_PIECE_VALUE (depth-tier filler)', () => {
    const lowVal = [{ id: 'p_low', position: 'WR', salary: 500_000, value: 10, onTradeBait: false }];
    const out = pickPieceFor({
      srcHaves: lowVal,
      wantedPositions: ['WR'],
      dstCapRoom: 10_000_000,
      claimedIds: new Set(),
    });
    expect(out).toBeNull();
  });
});

// ── threeTeamTradeSignature (rotation) ──

describe('threeTeamTradeSignature — canonical key', () => {
  it('is order-independent on the franchise triple', () => {
    const a = threeTeamTradeSignature({
      a: '0001', b: '0002', c: '0003',
      fromAIds: ['p1'], fromBIds: ['p2'], fromCIds: ['p3'],
    });
    const b = threeTeamTradeSignature({
      a: '0003', b: '0001', c: '0002',
      fromAIds: ['p3'], fromBIds: ['p1'], fromCIds: ['p2'],
    });
    expect(a).toBe(b);
  });

  it('is order-independent on the per-team piece set', () => {
    const a = threeTeamTradeSignature({
      a: '0001', b: '0002', c: '0003',
      fromAIds: ['p1', 'p1b'], fromBIds: ['p2'], fromCIds: ['p3'],
    });
    const b = threeTeamTradeSignature({
      a: '0001', b: '0002', c: '0003',
      fromAIds: ['p1b', 'p1'], fromBIds: ['p2'], fromCIds: ['p3'],
    });
    expect(a).toBe(b);
  });

  it('changes when a piece swaps', () => {
    const a = threeTeamTradeSignature({
      a: '0001', b: '0002', c: '0003',
      fromAIds: ['p1'], fromBIds: ['p2'], fromCIds: ['p3'],
    });
    const b = threeTeamTradeSignature({
      a: '0001', b: '0002', c: '0003',
      fromAIds: ['p1'], fromBIds: ['p2_alt'], fromCIds: ['p3'],
    });
    expect(a).not.toBe(b);
  });
});

// ── findThreeTeamCandidate end-to-end ──
//
// Three-team fixture: A wants TE, B wants RB, C wants WR. Each team holds
// a high-value piece at the position the next team wants, and all three
// pieces sit in a tight parity window so the cycle survives the 22% gate.

describe('findThreeTeamCandidate — end-to-end', () => {
  const teams = new Map<string, { division: string; nameMedium: string }>([
    ['A', { division: 'East', nameMedium: 'Alpha' }],
    ['B', { division: 'West', nameMedium: 'Beta' }],
    ['C', { division: 'Central', nameMedium: 'Gamma' }],
  ]);

  // Salary-based valuation puts $5M players ≈ 65 (well above MIN_THREE_TEAM_PIECE_VALUE).
  // Each team has ROSTER of 3 = below the median of 4 → wants every position.
  const rosterFor = (id: string, marquee: { id: string; pos: string }) => [
    { id: marquee.id, name: `${id}-marquee`, position: marquee.pos, salary: 5_000_000, status: 'ROSTER', age: 26 },
    { id: `${id}-bench-1`, name: 'Bench 1', position: 'WR', salary: 1_000_000, status: 'ROSTER', age: 24 },
    { id: `${id}-bench-2`, name: 'Bench 2', position: 'RB', salary: 1_000_000, status: 'ROSTER', age: 24 },
  ];

  const playersByFranchise = new Map<string, ReturnType<typeof rosterFor>>([
    // A holds a WR (which C wants); A wants TE
    ['A', rosterFor('A', { id: 'pA_wr', pos: 'WR' })],
    // B holds a TE (which A wants); B wants RB
    ['B', rosterFor('B', { id: 'pB_te', pos: 'TE' })],
    // C holds an RB (which B wants); C wants WR
    ['C', rosterFor('C', { id: 'pC_rb', pos: 'RB' })],
  ]);

  const tradeBaitByFranchise = new Map<string, string[]>([
    ['A', ['pA_wr']],
    ['B', ['pB_te']],
    ['C', ['pC_rb']],
  ]);

  const adpRankById = new Map<string, number>();

  // Manually-chosen medians so wants[A] = ['TE'], wants[B] = ['RB'],
  // wants[C] = ['WR'] in the way the cycle expects.
  const fixtureMedians = { QB: 2, RB: 4, WR: 5, TE: 2 };

  it('returns the cycle when each leg fills the next team’s want', () => {
    const cycle = findThreeTeamCandidate({
      playersByFranchise,
      tradeBaitByFranchise,
      adpRankById,
      teams,
      medians: fixtureMedians,
    });
    expect(cycle).not.toBeNull();
    expect([cycle.a, cycle.b, cycle.c].sort()).toEqual(['A', 'B', 'C']);
  });

  it('the resulting cycle satisfies isThreeWayParity', () => {
    const cycle = findThreeTeamCandidate({
      playersByFranchise,
      tradeBaitByFranchise,
      adpRankById,
      teams,
      medians: fixtureMedians,
    });
    expect(cycle).not.toBeNull();
    expect(
      isThreeWayParity(
        cycle.pieces.fromA.value,
        cycle.pieces.fromB.value,
        cycle.pieces.fromC.value,
      ),
    ).toBe(true);
  });

  it('returns null when fewer than 3 franchises exist', () => {
    const tinyMap = new Map<string, ReturnType<typeof rosterFor>>([
      ['A', rosterFor('A', { id: 'pA_wr', pos: 'WR' })],
      ['B', rosterFor('B', { id: 'pB_te', pos: 'TE' })],
    ]);
    const out = findThreeTeamCandidate({
      playersByFranchise: tinyMap,
      tradeBaitByFranchise,
      adpRankById,
      teams,
      medians: fixtureMedians,
    });
    expect(out).toBeNull();
  });

  it('returns null when no cycle satisfies parity (one team has only a low-value piece)', () => {
    // C has only a $0.5M RB → value ≈ 10, well below the 30 floor.
    const brokenMap = new Map<string, any[]>([
      ['A', rosterFor('A', { id: 'pA_wr', pos: 'WR' })],
      ['B', rosterFor('B', { id: 'pB_te', pos: 'TE' })],
      ['C', [
        { id: 'pC_rb_weak', name: 'C-weak', position: 'RB', salary: 500_000, status: 'ROSTER', age: 24 },
        { id: 'C-bench-1', name: 'Bench 1', position: 'WR', salary: 500_000, status: 'ROSTER', age: 24 },
      ]],
    ]);
    const baitMap = new Map<string, string[]>([
      ['A', ['pA_wr']],
      ['B', ['pB_te']],
      ['C', ['pC_rb_weak']],
    ]);
    const out = findThreeTeamCandidate({
      playersByFranchise: brokenMap,
      tradeBaitByFranchise: baitMap,
      adpRankById,
      teams,
      medians: fixtureMedians,
    });
    expect(out).toBeNull();
  });
});
