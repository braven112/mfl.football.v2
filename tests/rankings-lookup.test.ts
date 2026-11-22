import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatColumnHeader,
  formatFullName,
  buildRankingLookup,
  getPlayerRank,
  SOURCE_LABELS,
  SOURCE_ABBREVS,
  TYPE_LABELS,
  COMPOSITE_IMPORT_ID,
} from '../src/utils/rankings-lookup';
import type {
  StoredRankingImport,
  StoredRankingEntry,
  RankingSourceId,
  RankingType,
} from '../src/types/rankings-import';
import type { MyRankList } from '../src/utils/my-ranks';

// The one list this viewer sees (my-ranks-client.ts): FantasySharks for every
// owner, the site owner's own list by kind for him.
const mockMyRankList = vi.fn<[string], MyRankList | 'loading' | null>(() => null);
vi.mock('../src/utils/my-ranks-client', () => ({
  myRankList: (kind: string) => mockMyRankList(kind),
}));

beforeEach(() => {
  mockMyRankList.mockReset();
  mockMyRankList.mockReturnValue(null);
});

// Test Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock StoredRankingEntry for testing.
 * Defaults to matched player with high confidence.
 */
function createMockRankingEntry(overrides?: Partial<StoredRankingEntry>): StoredRankingEntry {
  return {
    rank: 1,
    playerId: 'mfl-12345',
    playerName: 'Patrick Mahomes',
    position: 'QB',
    team: 'KC',
    matched: true,
    confidence: 0.95,
    ...overrides,
  };
}

/**
 * Create a mock StoredRankingImport for testing.
 * Default: FantasyPros Dynasty with 3 matched players and 1 unmatched.
 */
function createMockRankingImport(overrides?: {
  id?: string;
  source?: RankingSourceId;
  type?: RankingType;
  importDate?: string;
  rankings?: StoredRankingEntry[];
}): StoredRankingImport {
  const source = overrides?.source ?? 'fantasypros';
  const type = overrides?.type ?? 'dynasty';

  const rankings = overrides?.rankings ?? [
    createMockRankingEntry({
      rank: 1,
      playerId: 'mfl-1001',
      playerName: 'Patrick Mahomes',
    }),
    createMockRankingEntry({
      rank: 2,
      playerId: 'mfl-1002',
      playerName: 'Josh Allen',
    }),
    createMockRankingEntry({
      rank: 3,
      playerId: 'mfl-1003',
      playerName: 'Lamar Jackson',
    }),
    createMockRankingEntry({
      rank: 4,
      playerId: null, // Unmatched
      playerName: 'Unknown Player',
      matched: false,
    }),
  ];

  return {
    id: overrides?.id ?? 'import-123',
    source,
    type,
    importDate: overrides?.importDate ?? '2025-02-20T10:00:00Z',
    rankings,
    stats: {
      total: rankings.length,
      matched: rankings.filter((r) => r.matched).length,
      unmatched: rankings.filter((r) => !r.matched).length,
      matchRate: (rankings.filter((r) => r.matched).length / rankings.length) * 100,
    },
  };
}

// ---------------------------------------------------------------------------
// formatColumnHeader tests
// ---------------------------------------------------------------------------
describe('formatColumnHeader', () => {
  it('should format dynasty as just the source abbreviation', () => {
    const imp = createMockRankingImport({ source: 'footballguys', type: 'dynasty' });
    expect(formatColumnHeader(imp)).toBe('FBG');
  });

  it('should format redraft with ® symbol', () => {
    const imp = createMockRankingImport({ source: 'fantasypros', type: 'redraft' });
    expect(formatColumnHeader(imp)).toBe('FPros ®');
  });

  it('should format adp with type label', () => {
    const imp = createMockRankingImport({ source: 'sleeper', type: 'adp' });
    expect(formatColumnHeader(imp)).toBe('Sleep ADP');
  });

  it('should format overall with type label', () => {
    const imp = createMockRankingImport({ source: 'keeptradecut', type: 'overall' });
    expect(formatColumnHeader(imp)).toBe('KTC All');
  });

  it('should format custom dynasty as just abbreviation', () => {
    const imp = createMockRankingImport({ source: 'custom', type: 'dynasty' });
    expect(formatColumnHeader(imp)).toBe('Cust');
  });

  it('should format cbs redraft with ®', () => {
    const imp = createMockRankingImport({ source: 'cbs', type: 'redraft' });
    expect(formatColumnHeader(imp)).toBe('CBS ®');
  });

  it('should format dlf overall with type label', () => {
    const imp = createMockRankingImport({ source: 'dlf', type: 'overall' });
    expect(formatColumnHeader(imp)).toBe('DLF All');
  });

  it('should format yahoo adp with type label', () => {
    const imp = createMockRankingImport({ source: 'yahoo', type: 'adp' });
    expect(formatColumnHeader(imp)).toBe('Yahoo ADP');
  });
});

// ---------------------------------------------------------------------------
// formatFullName tests
// ---------------------------------------------------------------------------

describe('formatFullName', () => {
  it('should format footballguys dynasty to "FootballGuys Dynasty"', () => {
    const imp = createMockRankingImport({ source: 'footballguys', type: 'dynasty' });
    expect(formatFullName(imp)).toBe('FootballGuys Dynasty');
  });

  it('should format cbs redraft to "CBS Sports Redraft"', () => {
    const imp = createMockRankingImport({ source: 'cbs', type: 'redraft' });
    expect(formatFullName(imp)).toBe('CBS Sports Redraft');
  });

  it('should format sleeper adp to "Sleeper ADP"', () => {
    const imp = createMockRankingImport({ source: 'sleeper', type: 'adp' });
    expect(formatFullName(imp)).toBe('Sleeper ADP');
  });

  it('should format custom overall to "Custom Overall"', () => {
    const imp = createMockRankingImport({ source: 'custom', type: 'overall' });
    expect(formatFullName(imp)).toBe('Custom Overall');
  });

  it('should format fantasypros dynasty to "FantasyPros Dynasty"', () => {
    const imp = createMockRankingImport({ source: 'fantasypros', type: 'dynasty' });
    expect(formatFullName(imp)).toBe('FantasyPros Dynasty');
  });

  it('should format keeptradecut redraft to "KeepTradeCut Redraft"', () => {
    const imp = createMockRankingImport({ source: 'keeptradecut', type: 'redraft' });
    expect(formatFullName(imp)).toBe('KeepTradeCut Redraft');
  });

  it('should format dlf overall to "DLF Overall"', () => {
    const imp = createMockRankingImport({ source: 'dlf', type: 'overall' });
    expect(formatFullName(imp)).toBe('DLF Overall');
  });

  it('should format yahoo adp to "Yahoo ADP"', () => {
    const imp = createMockRankingImport({ source: 'yahoo', type: 'adp' });
    expect(formatFullName(imp)).toBe('Yahoo ADP');
  });

  // The 'MFL ADP' label already ends in the type, so appending it again read
  // as "MFL ADP ADP" in the My Rank editor.
  it('should not repeat a type the source label already carries', () => {
    const imp = createMockRankingImport({ source: 'mfl-adp', type: 'adp' });
    expect(formatFullName(imp)).toBe('MFL ADP');
  });

  it('should still append a type the source label does not carry', () => {
    const imp = createMockRankingImport({ source: 'espn-superflex', type: 'redraft' });
    expect(formatFullName(imp)).toBe('ESPN Superflex Redraft');
  });

  it('should keep the built-in Sleeper ADP name intact', () => {
    const imp = createMockRankingImport({ source: 'sleeper-adp', type: 'adp' });
    expect(formatFullName(imp)).toBe('Sleeper ADP');
  });
});

// ---------------------------------------------------------------------------
// buildRankingLookup tests
// ---------------------------------------------------------------------------


describe('buildRankingLookup', () => {
  it('is empty while the list loads, and off the league pages', () => {
    mockMyRankList.mockReturnValue('loading');
    expect(buildRankingLookup().columns).toEqual([]);
    mockMyRankList.mockReturnValue(null);
    expect(buildRankingLookup().columns).toEqual([]);
  });

  it('shows ONE "My Rank" column keyed as the composite', () => {
    mockMyRankList.mockReturnValue({ label: 'FantasySharks', ranks: { p1: 1, p2: 2 } });
    const lookup = buildRankingLookup();
    expect(lookup.columns).toHaveLength(1);
    const [col] = lookup.columns;
    expect(col.importId).toBe(COMPOSITE_IMPORT_ID);
    expect(col.header).toBe('My Rank');
    expect(col.fullName).toBe('My Rank · FantasySharks');
    expect(col.isComposite).toBe(true);
    expect(getPlayerRank(lookup, 'p2', COMPOSITE_IMPORT_ID)).toBe(2);
    expect(getPlayerRank(lookup, 'nobody', COMPOSITE_IMPORT_ID)).toBeNull();
  });

  it('asks for the page kind, defaulting to season', () => {
    buildRankingLookup();
    expect(mockMyRankList).toHaveBeenLastCalledWith('season');
    buildRankingLookup({ kind: 'week' });
    expect(mockMyRankList).toHaveBeenLastCalledWith('week');
  });

  it('shows no column for an empty list rather than an empty header', () => {
    mockMyRankList.mockReturnValue({ label: 'FantasySharks', ranks: {} });
    expect(buildRankingLookup().columns).toEqual([]);
  });
});

describe('SOURCE_LABELS', () => {
  it('should have entries for all RankingSourceId values', () => {
    const sourceIds: RankingSourceId[] = [
      'fantasypros',
      'cbs',
      'sleeper',
      'keeptradecut',
      'dlf',
      'yahoo',
      'footballguys',
      'custom',
    ];

    for (const sourceId of sourceIds) {
      expect(SOURCE_LABELS[sourceId]).toBeDefined();
      expect(SOURCE_LABELS[sourceId].length).toBeGreaterThan(0);
    }
  });

  it('should not have nfl entry', () => {
    expect(SOURCE_LABELS['nfl' as any]).toBeUndefined();
  });

  it('should have correct full names', () => {
    expect(SOURCE_LABELS.fantasypros).toBe('FantasyPros');
    expect(SOURCE_LABELS.cbs).toBe('CBS Sports');
    expect(SOURCE_LABELS.sleeper).toBe('Sleeper');
    expect(SOURCE_LABELS.keeptradecut).toBe('KeepTradeCut');
    expect(SOURCE_LABELS.dlf).toBe('DLF');
    expect(SOURCE_LABELS.yahoo).toBe('Yahoo');
    expect(SOURCE_LABELS.footballguys).toBe('FootballGuys');
    expect(SOURCE_LABELS.custom).toBe('Custom');
  });
});

// ---------------------------------------------------------------------------
// SOURCE_ABBREVS tests
// ---------------------------------------------------------------------------

describe('SOURCE_ABBREVS', () => {
  it('should have entries for all RankingSourceId values', () => {
    const sourceIds: RankingSourceId[] = [
      'fantasypros',
      'cbs',
      'sleeper',
      'keeptradecut',
      'dlf',
      'yahoo',
      'footballguys',
      'custom',
    ];

    for (const sourceId of sourceIds) {
      expect(SOURCE_ABBREVS[sourceId]).toBeDefined();
      expect(SOURCE_ABBREVS[sourceId].length).toBeGreaterThan(0);
    }
  });

  it('should not have nfl entry', () => {
    expect(SOURCE_ABBREVS['nfl' as any]).toBeUndefined();
  });

  it('should have abbreviations of 5 characters or less', () => {
    for (const abbrev of Object.values(SOURCE_ABBREVS)) {
      expect(abbrev.length).toBeLessThanOrEqual(5);
    }
  });

  it('should have correct abbreviations', () => {
    expect(SOURCE_ABBREVS.fantasypros).toBe('FPros');
    expect(SOURCE_ABBREVS.cbs).toBe('CBS');
    expect(SOURCE_ABBREVS.sleeper).toBe('Sleep');
    expect(SOURCE_ABBREVS.keeptradecut).toBe('KTC');
    expect(SOURCE_ABBREVS.dlf).toBe('DLF');
    expect(SOURCE_ABBREVS.yahoo).toBe('Yahoo');
    expect(SOURCE_ABBREVS.footballguys).toBe('FBG');
    expect(SOURCE_ABBREVS.custom).toBe('Cust');
  });
});

// ---------------------------------------------------------------------------
// TYPE_LABELS tests
// ---------------------------------------------------------------------------

describe('TYPE_LABELS', () => {
  it('should have entries for all RankingType values', () => {
    const typeIds: RankingType[] = ['dynasty', 'redraft', 'adp', 'overall'];

    for (const typeId of typeIds) {
      expect(TYPE_LABELS[typeId]).toBeDefined();
      expect(TYPE_LABELS[typeId].length).toBeGreaterThan(0);
    }
  });

  it('should have correct type labels', () => {
    expect(TYPE_LABELS.dynasty).toBe('Dyn');
    expect(TYPE_LABELS.redraft).toBe('Rdf');
    expect(TYPE_LABELS.adp).toBe('ADP');
    expect(TYPE_LABELS.overall).toBe('All');
  });

  it('should only have exactly 4 entries', () => {
    expect(Object.keys(TYPE_LABELS)).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Average rank column tests
// ---------------------------------------------------------------------------

