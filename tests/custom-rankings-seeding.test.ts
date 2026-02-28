import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeCompositeHash,
  buildCompositePlayerList,
  mergeWithOverrides,
} from '../src/utils/custom-rankings-seeding';
import type { CustomRankingsState } from '../src/types/custom-rankings';
import type { CompositeRankConfig } from '../src/types/rankings-import';

// Mock dependencies
const mockGetCompositeConfig = vi.fn<[], CompositeRankConfig | null>(() => null);
const mockBuildRankingLookup = vi.fn(() => ({
  byImport: new Map(),
  columns: [],
}));

vi.mock('../src/utils/rankings-storage', () => ({
  getAllImports: vi.fn(() => []),
  getAveragePosition: vi.fn(() => 0),
  getCompositeConfig: () => mockGetCompositeConfig(),
}));

vi.mock('../src/utils/rankings-lookup', () => ({
  buildRankingLookup: () => mockBuildRankingLookup(),
  COMPOSITE_IMPORT_ID: '__composite__',
  AVERAGE_IMPORT_ID: '__average__',
}));

beforeEach(() => {
  mockGetCompositeConfig.mockReturnValue(null);
  mockBuildRankingLookup.mockReturnValue({
    byImport: new Map(),
    columns: [],
  });
});

// ---------------------------------------------------------------------------
// computeCompositeHash
// ---------------------------------------------------------------------------

describe('computeCompositeHash', () => {
  it('returns "no-composite" when no composite config exists', () => {
    mockGetCompositeConfig.mockReturnValue(null);
    expect(computeCompositeHash(0)).toBe('no-composite');
  });

  it('returns a deterministic hash from config members + player count', () => {
    mockGetCompositeConfig.mockReturnValue({
      members: [
        { importId: 'import-b', weight: 2 },
        { importId: 'import-a', weight: 1 },
      ],
    });
    const hash1 = computeCompositeHash(100);
    const hash2 = computeCompositeHash(100);
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different member configurations', () => {
    mockGetCompositeConfig.mockReturnValue({
      members: [
        { importId: 'import-a', weight: 1 },
        { importId: 'import-b', weight: 2 },
      ],
    });
    const hash1 = computeCompositeHash(100);

    mockGetCompositeConfig.mockReturnValue({
      members: [
        { importId: 'import-a', weight: 1 },
        { importId: 'import-b', weight: 3 },
      ],
    });
    const hash2 = computeCompositeHash(100);

    expect(hash1).not.toBe(hash2);
  });

  it('produces different hashes for different player counts', () => {
    mockGetCompositeConfig.mockReturnValue({
      members: [
        { importId: 'import-a', weight: 1 },
        { importId: 'import-b', weight: 2 },
      ],
    });
    const hash1 = computeCompositeHash(100);
    const hash2 = computeCompositeHash(200);

    expect(hash1).not.toBe(hash2);
  });

  it('sorts members deterministically (order-independent)', () => {
    mockGetCompositeConfig.mockReturnValue({
      members: [
        { importId: 'import-b', weight: 2 },
        { importId: 'import-a', weight: 1 },
      ],
    });
    const hash1 = computeCompositeHash(50);

    mockGetCompositeConfig.mockReturnValue({
      members: [
        { importId: 'import-a', weight: 1 },
        { importId: 'import-b', weight: 2 },
      ],
    });
    const hash2 = computeCompositeHash(50);

    expect(hash1).toBe(hash2);
  });
});

// ---------------------------------------------------------------------------
// buildCompositePlayerList
// ---------------------------------------------------------------------------

describe('buildCompositePlayerList', () => {
  it('returns null when no composite column exists', () => {
    mockBuildRankingLookup.mockReturnValue({
      byImport: new Map(),
      columns: [],
    });
    expect(buildCompositePlayerList()).toBeNull();
  });

  it('returns null when composite map is empty', () => {
    mockBuildRankingLookup.mockReturnValue({
      byImport: new Map([['__composite__', new Map()]]),
      columns: [],
    });
    expect(buildCompositePlayerList()).toBeNull();
  });

  it('returns sorted player IDs by composite rank', () => {
    const compositeMap = new Map([
      ['player-c', 3],
      ['player-a', 1],
      ['player-b', 2],
    ]);
    mockBuildRankingLookup.mockReturnValue({
      byImport: new Map([['__composite__', compositeMap]]),
      columns: [],
    });
    mockGetCompositeConfig.mockReturnValue({
      members: [
        { importId: 'import-a', weight: 1 },
        { importId: 'import-b', weight: 1 },
      ],
    });

    const result = buildCompositePlayerList();
    expect(result).not.toBeNull();
    expect(result!.playerIds).toEqual(['player-a', 'player-b', 'player-c']);
    expect(result!.compositeMap).toBe(compositeMap);
    expect(result!.hash).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// mergeWithOverrides
// ---------------------------------------------------------------------------

describe('mergeWithOverrides', () => {
  it('returns the new composite order when no overrides exist', () => {
    const newIds = ['a', 'b', 'c', 'd'];
    const savedState: CustomRankingsState = {
      version: 1,
      lastModified: '2026-01-01',
      sourceCompositeHash: 'old',
      rankings: ['a', 'b', 'c', 'd'],
      overrides: [],
      tiers: [],
    };

    const result = mergeWithOverrides(newIds, savedState);
    expect(result.rankings).toEqual(['a', 'b', 'c', 'd']);
    expect(result.overrides).toEqual([]);
  });

  it('preserves the relative position of overridden players', () => {
    // User moved 'd' to position 2 (between a and b)
    const savedState: CustomRankingsState = {
      version: 1,
      lastModified: '2026-01-01',
      sourceCompositeHash: 'old',
      rankings: ['a', 'd', 'b', 'c'],
      overrides: ['d'],
      tiers: [],
    };

    // New composite order (d was originally last)
    const newIds = ['a', 'b', 'c', 'd'];

    const result = mergeWithOverrides(newIds, savedState);
    // d should be re-inserted after 'a' (where it was in saved order)
    expect(result.rankings).toEqual(['a', 'd', 'b', 'c']);
    expect(result.overrides).toEqual(['d']);
  });

  it('handles removed players in overrides gracefully', () => {
    const savedState: CustomRankingsState = {
      version: 1,
      lastModified: '2026-01-01',
      sourceCompositeHash: 'old',
      rankings: ['a', 'x', 'b', 'c'],
      overrides: ['x'],
      tiers: [],
    };

    // x is no longer in the new composite
    const newIds = ['a', 'b', 'c'];

    const result = mergeWithOverrides(newIds, savedState);
    expect(result.rankings).toEqual(['a', 'b', 'c']);
    expect(result.overrides).toEqual([]);
  });

  it('handles new players added to composite', () => {
    const savedState: CustomRankingsState = {
      version: 1,
      lastModified: '2026-01-01',
      sourceCompositeHash: 'old',
      rankings: ['a', 'b', 'c'],
      overrides: ['b'],
      tiers: [],
    };

    // New player 'd' added
    const newIds = ['a', 'd', 'b', 'c'];

    const result = mergeWithOverrides(newIds, savedState);
    // b was overridden, should maintain position after 'a'
    expect(result.rankings).toContain('d');
    expect(result.rankings).toContain('b');
    expect(result.overrides).toEqual(['b']);
  });

  it('handles all players being overrides', () => {
    const savedState: CustomRankingsState = {
      version: 1,
      lastModified: '2026-01-01',
      sourceCompositeHash: 'old',
      rankings: ['c', 'a', 'b'],
      overrides: ['a', 'b', 'c'],
      tiers: [],
    };

    const newIds = ['a', 'b', 'c'];

    const result = mergeWithOverrides(newIds, savedState);
    // All are overrides — should preserve saved order
    expect(result.rankings).toEqual(['c', 'a', 'b']);
    expect(result.overrides).toEqual(['a', 'b', 'c']);
  });

  it('handles single player list', () => {
    const savedState: CustomRankingsState = {
      version: 1,
      lastModified: '2026-01-01',
      sourceCompositeHash: 'old',
      rankings: ['a'],
      overrides: [],
      tiers: [],
    };

    const newIds = ['a'];
    const result = mergeWithOverrides(newIds, savedState);
    expect(result.rankings).toEqual(['a']);
  });
});
