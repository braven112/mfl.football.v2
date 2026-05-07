import { describe, it, expect } from 'vitest';
// @ts-expect-error — sibling .mjs module, no .d.ts
import {
  findTwoTeamCandidates,
  buildPositionalWants,
  buildHaves,
  franchiseCapSpace,
  valuePlayer,
  __testing__,
// @ts-expect-error — sibling .mjs module, no .d.ts
} from '../scripts/lib/speculation-matching.mjs';

const adpRankById = new Map<string, number>([
  // Marquee tier (rank 1–12 → ~85–100)
  ['p_marquee', 5],
  // Mid tier (~50)
  ['p_mid_a', 22],
  ['p_mid_b', 24],
  // Buyer return pieces — paired so the package value lands within the
  // 15% parity gate around the marquee.
  ['p_buyer_top', 14],
  ['p_buyer_throw_in', 70],
  // Bench fillers
  ['p_filler_a', 90],
  ['p_filler_b', 95],
]);

const teams = new Map<string, { division: string; nameMedium: string }>([
  ['0001', { division: 'Northwest', nameMedium: 'Pigskins' }],
  ['0002', { division: 'Northwest', nameMedium: 'Wabbits' }],
  ['0003', { division: 'East', nameMedium: 'Vitside' }],
]);

const sellerRoster = [
  { id: 'p_marquee', name: 'Star RB', position: 'RB', salary: 8_000_000, contractYear: '2', status: 'ROSTER', age: 25 },
  { id: 's_qb1', name: 'Pocket QB', position: 'QB', salary: 12_000_000, contractYear: '3', status: 'ROSTER', age: 30 },
  { id: 's_wr1', name: 'WR1', position: 'WR', salary: 6_000_000, contractYear: '2', status: 'ROSTER', age: 27 },
  // No TE listed — seller has a TE want
];

const buyerRoster = [
  { id: 'b_qb1', name: 'Veteran QB', position: 'QB', salary: 6_000_000, contractYear: '4', status: 'ROSTER', age: 33 },
  { id: 'b_qb2', name: 'Backup QB', position: 'QB', salary: 1_000_000, contractYear: '1', status: 'ROSTER', age: 26 },
  // RB-thin so the buyer "wants" RB
  { id: 'b_rb1', name: 'Aging RB', position: 'RB', salary: 2_000_000, contractYear: '4', status: 'ROSTER', age: 30 },
  // WR-stacked surplus + TE filler
  { id: 'b_wr1', name: 'WR1', position: 'WR', salary: 4_000_000, contractYear: '3', status: 'ROSTER', age: 27 },
  { id: 'b_wr2', name: 'WR2', position: 'WR', salary: 3_500_000, contractYear: '3', status: 'ROSTER', age: 27 },
  { id: 'b_wr3', name: 'WR3', position: 'WR', salary: 3_000_000, contractYear: '2', status: 'ROSTER', age: 26 },
  { id: 'b_wr4', name: 'WR4', position: 'WR', salary: 1_000_000, contractYear: '1', status: 'ROSTER', age: 24 },
  { id: 'b_wr5', name: 'WR5', position: 'WR', salary: 800_000, contractYear: '1', status: 'ROSTER', age: 24 },
  { id: 'b_wr6', name: 'WR6', position: 'WR', salary: 600_000, contractYear: '1', status: 'ROSTER', age: 24 },
  // The headline return TE
  { id: 'p_buyer_top', name: 'Star TE', position: 'TE', salary: 4_500_000, contractYear: '2', status: 'ROSTER', age: 26 },
  { id: 'p_buyer_throw_in', name: 'Backup TE', position: 'TE', salary: 600_000, contractYear: '1', status: 'ROSTER', age: 25 },
];

const playersByFranchise = new Map<string, typeof sellerRoster>([
  ['0001', sellerRoster],
  ['0002', buyerRoster],
]);

const tradeBaitByFranchise = new Map<string, string[]>([
  ['0001', ['p_marquee']],
  // Buyer lists their top TE plus a throw-in TE so the matcher can pad
  // the return package within the 15% parity gate.
  ['0002', ['p_buyer_top', 'p_buyer_throw_in']],
]);

describe('valuePlayer + age curve', () => {
  it('top-tier ADP rank yields a high value', () => {
    const v = valuePlayer({
      player: { id: 'p_marquee', position: 'RB', age: 25 },
      adpRankById,
    });
    expect(v).toBeGreaterThan(85);
  });

  it('age 31 RB gets a heavy discount', () => {
    const youngVal = valuePlayer({ player: { id: 'p_marquee', position: 'RB', age: 25 }, adpRankById });
    const oldVal = valuePlayer({
      player: { id: 'p_marquee', position: 'RB', age: 31 },
      adpRankById,
    });
    expect(oldVal).toBeLessThan(youngVal * 0.6);
  });
});

describe('isWithinParity (15% tolerance)', () => {
  it('exact match passes', () => {
    expect(__testing__.isWithinParity(80, 80)).toBe(true);
  });
  it('14% diff passes', () => {
    expect(__testing__.isWithinParity(100, 87)).toBe(true);
  });
  it('20% diff fails', () => {
    expect(__testing__.isWithinParity(100, 80)).toBe(false);
  });
});

describe('buildPositionalWants', () => {
  it('flags TE as want when seller has zero TEs', () => {
    expect(buildPositionalWants(sellerRoster)).toContain('TE');
  });

  it('flags RB as want when buyer is RB-thin', () => {
    expect(buildPositionalWants(buyerRoster)).toContain('RB');
  });

  it('does not flag QB when buyer has 2 QBs already (≥2 satisfies threshold)', () => {
    expect(buildPositionalWants(buyerRoster)).not.toContain('QB');
  });
});

describe('franchiseCapSpace', () => {
  it('returns 45M cap minus committed salaries', () => {
    const SALARY_CAP = 45_000_000;
    const sellerCommitted = sellerRoster.reduce((s, p) => s + p.salary, 0);
    expect(franchiseCapSpace({ franchisePlayers: sellerRoster })).toBe(SALARY_CAP - sellerCommitted);
  });
});

describe('findTwoTeamCandidates — end-to-end', () => {
  // Hand-supplied medians so the want/have heuristic is independent of the
  // tiny 2-franchise fixture (auto-computed medians on 2 data points are
  // degenerate). Mirrors what the runner script does in production where it
  // computes medians across all 16 league franchises.
  const fixtureMedians = { QB: 2, RB: 4, WR: 5, TE: 2 };

  it('produces at least one candidate respecting parity + cap-fit', () => {
    const candidates = findTwoTeamCandidates({
      playersByFranchise,
      tradeBaitByFranchise,
      adpRankById,
      teams,
      medians: fixtureMedians,
      limit: 5,
    });
    expect(candidates.length).toBeGreaterThan(0);
    const top = candidates[0];
    expect(top.seller).toBe('0001');
    expect(top.buyer).toBe('0002');
    expect(top.marquee.id).toBe('p_marquee');
    // Buyer's TE return must hit the seller's TE want
    expect(top.returnPkg.some((p: { position: string }) => p.position === 'TE')).toBe(true);
  });

  it('returns empty when buyer has no positional want for marquee', () => {
    // Strip RB want from buyer by pretending they're RB-stacked
    const stackedBuyer = [
      ...buyerRoster,
      { id: 'b_rb_pad_1', name: 'RB Pad 1', position: 'RB', salary: 500_000, contractYear: '1', status: 'ROSTER', age: 24 },
      { id: 'b_rb_pad_2', name: 'RB Pad 2', position: 'RB', salary: 500_000, contractYear: '1', status: 'ROSTER', age: 24 },
      { id: 'b_rb_pad_3', name: 'RB Pad 3', position: 'RB', salary: 500_000, contractYear: '1', status: 'ROSTER', age: 24 },
    ];
    const altPlayers = new Map([
      ['0001', sellerRoster],
      ['0002', stackedBuyer],
    ]);
    const altBait = new Map([
      ['0001', ['p_marquee']],
      ['0002', []],
    ]);
    const candidates = findTwoTeamCandidates({
      playersByFranchise: altPlayers,
      tradeBaitByFranchise: altBait,
      adpRankById,
      teams,
      medians: fixtureMedians,
      limit: 5,
    });
    expect(candidates).toEqual([]);
  });
});
