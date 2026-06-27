import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PREMIER,
  DLEAGUE,
  computeAllPlayThroughCutoff,
  rankWithinTier,
  splitMembership,
  flattenMembership,
  computeTierMovement,
  CONSTITUTION_MOVEMENT_RULES,
} from '../scripts/lib/afl-tier-standings.mjs';

const ROOT = path.resolve(__dirname, '..');
const readJson = (rel: string) =>
  JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

// Build an all-play Map from a plain { id: pct } (pf defaults from pct so the
// secondary tiebreak is consistent with the primary).
const allPlayFrom = (pcts: Record<string, number>) =>
  new Map(Object.entries(pcts).map(([id, pct]) => [id, { pct, pf: pct * 1000 }]));

describe('afl-tier-standings: all-play from weekly results', () => {
  it('counts all-play wins/losses/ties against every other team each week', () => {
    const weekly = {
      weeks: [
        { week: 1, scores: { a: 100, b: 90, c: 80 } }, // a:2-0 b:1-1 c:0-2
        { week: 2, scores: { a: 70, b: 90, c: 90 } }, // a:0-2 b:1-0-1 c:1-0-1
      ],
    };
    const ap = computeAllPlayThroughCutoff(weekly, 17);
    expect(ap.get('a')).toMatchObject({ wins: 2, losses: 2, ties: 0 });
    expect(ap.get('b')).toMatchObject({ wins: 2, losses: 1, ties: 1 });
    expect(ap.get('c')).toMatchObject({ wins: 1, losses: 2, ties: 1 });
    // PF is the sum of the team's own scores across counted weeks.
    expect(ap.get('a')!.pf).toBeCloseTo(170);
    // pct = (wins + 0.5*ties) / games
    expect(ap.get('b')!.pct).toBeCloseTo((2 + 0.5) / 4);
  });

  it('gates to the cutoff week (later weeks are ignored)', () => {
    const weekly = {
      weeks: [
        { week: 1, scores: { a: 100, b: 50 } },
        { week: 18, scores: { a: 0, b: 100 } }, // beyond cutoff — must not count
      ],
    };
    const ap = computeAllPlayThroughCutoff(weekly, 17);
    expect(ap.get('a')).toMatchObject({ wins: 1, losses: 0 });
    expect(ap.get('b')).toMatchObject({ wins: 0, losses: 1 });
  });
});

describe('afl-tier-standings: ranking + membership helpers', () => {
  it('ranks by all-play pct desc, then PF, then id', () => {
    const ap = new Map([
      ['x', { pct: 0.5, pf: 100 }],
      ['y', { pct: 0.5, pf: 200 }], // higher PF wins the tie
      ['z', { pct: 0.9, pf: 1 }],
    ]);
    expect(rankWithinTier(['x', 'y', 'z'], ap)).toEqual(['z', 'y', 'x']);
  });

  it('splits and flattens membership round-trip', () => {
    const flat = { '0001': PREMIER, '0003': DLEAGUE, '0002': PREMIER };
    const split = splitMembership(flat);
    expect(split[PREMIER].sort()).toEqual(['0001', '0002']);
    expect(split[DLEAGUE]).toEqual(['0003']);
    expect(flattenMembership(split)).toEqual(flat);
  });
});

describe('afl-tier-standings: movement (full constitution rule)', () => {
  // Premier P1..P12, D-League D1..D12. pct chosen so within-tier rank is the
  // natural numeric order, EXCEPT the swing pool, where D-League's 3rd/4th
  // outrank Premier's 9th/10th and cross over.
  const premier = Array.from({ length: 12 }, (_, i) => `P${i + 1}`);
  const dleague = Array.from({ length: 12 }, (_, i) => `D${i + 1}`);
  // Explicit, collision-free pcts. Within each tier the natural numeric order
  // holds, but the swing pool crosses over: D-League 3rd/4th (.60/.58) outrank
  // Premier 9th/10th (.40/.38), so the two D-League teams take the swing spots.
  const pcts: Record<string, number> = {
    P1: 0.99, P2: 0.98, P3: 0.97, P4: 0.96, P5: 0.95, P6: 0.94,
    P7: 0.93, P8: 0.92, P9: 0.4, P10: 0.38, P11: 0.3, P12: 0.28,
    D1: 0.8, D2: 0.78, D3: 0.6, D4: 0.58, D5: 0.5, D6: 0.48,
    D7: 0.46, D8: 0.44, D9: 0.42, D10: 0.36, D11: 0.34, D12: 0.32,
  };
  const allPlay = allPlayFrom(pcts);
  const membership = { [PREMIER]: premier, [DLEAGUE]: dleague };
  const m = computeTierMovement(membership, allPlay);

  it('names the #1 of each tier as champion', () => {
    expect(m.champions['premier-league']).toBe('P1');
    expect(m.champions['dleague-champion']).toBe('D1');
  });

  it('auto-relegates Premier 11/12 and auto-promotes D-League 1/2', () => {
    expect(m.autoRelegated.sort()).toEqual(['P11', 'P12']);
    expect(m.autoPromoted.sort()).toEqual(['D1', 'D2']);
  });

  it('runs the 4-team swing playoff (PL 9/10 vs DL 3/4), top 2 by all-play to Premier', () => {
    expect(m.swing!.pool.sort()).toEqual(['D3', 'D4', 'P10', 'P9']);
    expect(m.swing!.promoted.sort()).toEqual(['D3', 'D4']);
    expect(m.swing!.relegated.sort()).toEqual(['P10', 'P9']);
  });

  it('rolls the makeup forward to a disjoint, full 12/12 split', () => {
    expect(m.next[PREMIER]).toHaveLength(12);
    expect(m.next[DLEAGUE]).toHaveLength(12);
    expect(m.next[PREMIER].sort()).toEqual(
      ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'D1', 'D2', 'D3', 'D4'].sort()
    );
    expect(m.next[DLEAGUE].sort()).toEqual(
      ['D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'P9', 'P10', 'P11', 'P12'].sort()
    );
    // Every team accounted for exactly once.
    const all = [...m.next[PREMIER], ...m.next[DLEAGUE]];
    expect(new Set(all).size).toBe(24);
  });
});

describe('afl-tier-standings: pre-2024 eight-team era falls back to simple up/down', () => {
  it('skips the swing playoff when tiers are too small for the configured ranks', () => {
    const premier = Array.from({ length: 8 }, (_, i) => `P${i + 1}`);
    const dleague = Array.from({ length: 8 }, (_, i) => `D${i + 1}`);
    const pcts: Record<string, number> = {};
    premier.forEach((id, i) => (pcts[id] = 0.9 - i * 0.05));
    dleague.forEach((id, i) => (pcts[id] = 0.5 - i * 0.05));
    const m = computeTierMovement(
      { [PREMIER]: premier, [DLEAGUE]: dleague },
      allPlayFrom(pcts)
    );
    expect(m.swing).toBeNull();
    expect(m.autoRelegated.sort()).toEqual(['P7', 'P8']);
    expect(m.autoPromoted.sort()).toEqual(['D1', 'D2']);
    expect(m.next[PREMIER]).toHaveLength(8);
    expect(m.next[PREMIER].sort()).toEqual(
      ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'D1', 'D2'].sort()
    );
  });
});

describe('afl-tier-standings: real 2025 data reproduces the recorded champions', () => {
  it('ranks the 2025 cutoff-week all-play within tiers to Premier 0015 / D-League 0017', () => {
    const cfg = readJson('data/afl-fantasy/afl.config.json');
    const history = readJson('data/afl-fantasy/tier-history.json');
    const weekly = readJson('data/afl-fantasy/mfl-feeds/2025/weekly-results.json');
    const cutoff = cfg.tierCompetition.cutoffWeek;
    const membership = history.seasons['2025'].membership;

    const allPlay = computeAllPlayThroughCutoff(weekly, cutoff);
    const m = computeTierMovement(membership, allPlay, history.movementRules);

    expect(m.champions['premier-league']).toBe('0015'); // The Mariachi Ninjas
    expect(m.champions['dleague-champion']).toBe('0017'); // Titsburgh Feelers
    expect(m.next[PREMIER]).toHaveLength(12);
    expect(m.next[DLEAGUE]).toHaveLength(12);
    expect(new Set([...m.next[PREMIER], ...m.next[DLEAGUE]]).size).toBe(24);
  });
});

describe('afl-tier-standings: rule constant', () => {
  it('encodes the 12-team constitution rule', () => {
    expect(CONSTITUTION_MOVEMENT_RULES.autoPromote).toBe(2);
    expect(CONSTITUTION_MOVEMENT_RULES.autoRelegate).toBe(2);
    expect(CONSTITUTION_MOVEMENT_RULES.swing.premierRanks).toEqual([9, 10]);
    expect(CONSTITUTION_MOVEMENT_RULES.swing.dleagueRanks).toEqual([3, 4]);
  });
});
