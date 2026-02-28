import { describe, it, expect } from 'vitest';
import {
  detectTierBreaks,
  extractImportedTiers,
  mergeTierBreaks,
} from '../src/utils/tier-detection';
import type { TierBreak } from '../src/types/custom-rankings';

// ---------------------------------------------------------------------------
// detectTierBreaks
// ---------------------------------------------------------------------------

describe('detectTierBreaks', () => {
  it('returns empty array for fewer than 3 players', () => {
    const ranks = new Map([['a', 1], ['b', 5]]);
    expect(detectTierBreaks(['a', 'b'], ranks)).toEqual([]);
  });

  it('returns empty array when all ranks are equal (median gap 0)', () => {
    const ranks = new Map([['a', 1], ['b', 1], ['c', 1], ['d', 1]]);
    expect(detectTierBreaks(['a', 'b', 'c', 'd'], ranks)).toEqual([]);
  });

  it('detects a tier break at a large gap', () => {
    // Gaps: 1, 1, 1, 10 → median gap = 1 → threshold 2.5 → need gap > 2.5
    const ranks = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
      ['e', 14],
    ]);
    const result = detectTierBreaks(['a', 'b', 'c', 'd', 'e'], ranks);
    expect(result).toHaveLength(1);
    expect(result[0].afterPlayerId).toBe('d');
    expect(result[0].source).toBe('auto');
  });

  it('detects multiple tier breaks', () => {
    // Gaps: 1, 1, 8, 1, 1, 8 → sorted: 1,1,1,1,8,8 → median=1
    const ranks = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 11],
      ['e', 12],
      ['f', 13],
      ['g', 21],
    ]);
    const result = detectTierBreaks(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      ranks,
    );
    expect(result).toHaveLength(2);
    expect(result[0].afterPlayerId).toBe('c');
    expect(result[1].afterPlayerId).toBe('f');
  });

  it('respects minGap parameter', () => {
    // Gap of 3 with median 1, threshold=2.5 → 3 > 2.5 but minGap=5 blocks it
    const ranks = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 6],
    ]);
    const result = detectTierBreaks(['a', 'b', 'c', 'd'], ranks, 2.5, 5);
    expect(result).toEqual([]);
  });

  it('respects custom threshold', () => {
    // Gaps: 1, 1, 4 → median=1 → with threshold 5: need > 5. 4 < 5 → no breaks
    const ranks = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 7],
    ]);
    const result = detectTierBreaks(['a', 'b', 'c', 'd'], ranks, 5);
    expect(result).toEqual([]);
  });

  it('handles missing players in composite map gracefully', () => {
    // Unknown players default to rank 0
    const ranks = new Map([['a', 1], ['c', 10]]);
    const result = detectTierBreaks(['a', 'b', 'c'], ranks);
    // Gaps: (0-1)=-1, (10-0)=10 → sorted: -1, 10 → median=10
    // Only gap 10 > 10*2.5=25? No. So no tier breaks.
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractImportedTiers
// ---------------------------------------------------------------------------

describe('extractImportedTiers', () => {
  it('returns empty array for fewer than 2 players', () => {
    const tiers = new Map([['a', 1]]);
    expect(extractImportedTiers(['a'], tiers)).toEqual([]);
  });

  it('detects tier transitions', () => {
    const tiers = new Map([
      ['a', 1],
      ['b', 1],
      ['c', 2],
      ['d', 2],
      ['e', 3],
    ]);
    const result = extractImportedTiers(['a', 'b', 'c', 'd', 'e'], tiers);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      afterPlayerId: 'b',
      label: 'Tier 2',
      source: 'imported',
    });
    expect(result[1]).toEqual({
      afterPlayerId: 'd',
      label: 'Tier 3',
      source: 'imported',
    });
  });

  it('skips players without tier data', () => {
    const tiers = new Map([
      ['a', 1],
      // 'b' has no tier
      ['c', 2],
    ]);
    const result = extractImportedTiers(['a', 'b', 'c'], tiers);
    // a→b: b has no tier, skip. b→c: b has no tier, skip.
    expect(result).toEqual([]);
  });

  it('returns empty when all players are same tier', () => {
    const tiers = new Map([
      ['a', 1],
      ['b', 1],
      ['c', 1],
    ]);
    expect(extractImportedTiers(['a', 'b', 'c'], tiers)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mergeTierBreaks
// ---------------------------------------------------------------------------

describe('mergeTierBreaks', () => {
  it('returns auto tiers when no overrides', () => {
    const auto: TierBreak[] = [
      { afterPlayerId: 'a', source: 'auto' },
      { afterPlayerId: 'c', source: 'auto' },
    ];
    const result = mergeTierBreaks(auto, []);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.afterPlayerId)).toEqual(['a', 'c']);
  });

  it('imported tiers override auto at same position', () => {
    const auto: TierBreak[] = [
      { afterPlayerId: 'a', source: 'auto' },
    ];
    const imported: TierBreak[] = [
      { afterPlayerId: 'a', label: 'Tier 2', source: 'imported' },
    ];
    const result = mergeTierBreaks(auto, imported);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('imported');
    expect(result[0].label).toBe('Tier 2');
  });

  it('manual tiers override both auto and imported', () => {
    const auto: TierBreak[] = [
      { afterPlayerId: 'a', source: 'auto' },
    ];
    const imported: TierBreak[] = [
      { afterPlayerId: 'a', label: 'Tier 2', source: 'imported' },
    ];
    const manual: TierBreak[] = [
      { afterPlayerId: 'a', label: 'Elite', source: 'manual' },
    ];
    const result = mergeTierBreaks(auto, imported, manual);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('manual');
    expect(result[0].label).toBe('Elite');
  });

  it('merges tiers at different positions', () => {
    const auto: TierBreak[] = [
      { afterPlayerId: 'a', source: 'auto' },
    ];
    const imported: TierBreak[] = [
      { afterPlayerId: 'b', label: 'Tier 3', source: 'imported' },
    ];
    const manual: TierBreak[] = [
      { afterPlayerId: 'c', label: 'Bust', source: 'manual' },
    ];
    const result = mergeTierBreaks(auto, imported, manual);
    expect(result).toHaveLength(3);
    const sources = result.map((t) => t.source);
    expect(sources).toContain('auto');
    expect(sources).toContain('imported');
    expect(sources).toContain('manual');
  });

  it('returns empty array when no tiers from any source', () => {
    expect(mergeTierBreaks([], [], [])).toEqual([]);
  });
});
