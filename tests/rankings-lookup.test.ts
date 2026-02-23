import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatColumnHeader,
  formatFullName,
  buildRankingLookup,
  getPlayerRank,
  SOURCE_LABELS,
  SOURCE_ABBREVS,
  TYPE_LABELS,
  AVERAGE_IMPORT_ID,
  COMPOSITE_IMPORT_ID,
} from '../src/utils/rankings-lookup';
import type {
  StoredRankingImport,
  StoredRankingEntry,
  RankingSourceId,
  RankingType,
  CompositeRankConfig,
} from '../src/types/rankings-import';

// Mock getAveragePosition and getCompositeConfig
const mockGetAveragePosition = vi.fn(() => 0);
const mockGetCompositeConfig = vi.fn<[], CompositeRankConfig | null>(() => null);
vi.mock('../src/utils/rankings-storage', () => ({
  getAllImports: vi.fn(() => []),
  getAveragePosition: () => mockGetAveragePosition(),
  getCompositeConfig: () => mockGetCompositeConfig(),
}));

beforeEach(() => {
  mockGetAveragePosition.mockReturnValue(0);
  mockGetCompositeConfig.mockReturnValue(null);
});

// ---------------------------------------------------------------------------
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
});

// ---------------------------------------------------------------------------
// buildRankingLookup tests
// ---------------------------------------------------------------------------

describe('buildRankingLookup', () => {
  it('should return empty columns and empty byImport for empty array', () => {
    const lookup = buildRankingLookup([]);
    expect(lookup.columns).toHaveLength(0);
    expect(lookup.byImport.size).toBe(0);
  });

  it('should build correct Map entries for single import with matched players', () => {
    const imp = createMockRankingImport({
      id: 'import-1',
      rankings: [
        createMockRankingEntry({ rank: 1, playerId: 'p1', playerName: 'Player 1' }),
        createMockRankingEntry({ rank: 2, playerId: 'p2', playerName: 'Player 2' }),
        createMockRankingEntry({ rank: 3, playerId: 'p3', playerName: 'Player 3' }),
      ],
    });

    const lookup = buildRankingLookup([imp]);

    expect(lookup.byImport.size).toBe(1);
    const playerMap = lookup.byImport.get('import-1');
    expect(playerMap?.size).toBe(3);
    expect(playerMap?.get('p1')).toBe(1);
    expect(playerMap?.get('p2')).toBe(2);
    expect(playerMap?.get('p3')).toBe(3);
  });

  it('should exclude unmatched players (playerId null) from Map', () => {
    const imp = createMockRankingImport({
      id: 'import-1',
      rankings: [
        createMockRankingEntry({ rank: 1, playerId: 'p1', playerName: 'Player 1' }),
        createMockRankingEntry({
          rank: 2,
          playerId: null,
          playerName: 'Unknown',
          matched: false,
        }),
        createMockRankingEntry({ rank: 3, playerId: 'p3', playerName: 'Player 3' }),
      ],
    });

    const lookup = buildRankingLookup([imp]);
    const playerMap = lookup.byImport.get('import-1');

    expect(playerMap?.size).toBe(2);
    expect(playerMap?.has('p1')).toBe(true);
    expect(playerMap?.has('p3')).toBe(true);
    expect(playerMap?.get(null as any)).toBeUndefined();
  });

  it('should handle multiple imports and build separate Maps', () => {
    const imp1 = createMockRankingImport({
      id: 'import-1',
      source: 'fantasypros',
      rankings: [
        createMockRankingEntry({ rank: 1, playerId: 'p1' }),
        createMockRankingEntry({ rank: 2, playerId: 'p2' }),
      ],
    });

    const imp2 = createMockRankingImport({
      id: 'import-2',
      source: 'sleeper',
      rankings: [
        createMockRankingEntry({ rank: 1, playerId: 'p3' }),
        createMockRankingEntry({ rank: 2, playerId: 'p4' }),
      ],
    });

    const lookup = buildRankingLookup([imp1, imp2]);

    expect(lookup.byImport.size).toBe(3); // 2 imports + average
    expect(lookup.byImport.get('import-1')?.size).toBe(2);
    expect(lookup.byImport.get('import-2')?.size).toBe(2);
    expect(lookup.byImport.has(AVERAGE_IMPORT_ID)).toBe(true);
  });

  it('should create column metadata with correct properties', () => {
    const imp = createMockRankingImport({
      id: 'import-fbg-dyn',
      source: 'footballguys',
      type: 'dynasty',
      importDate: '2025-02-20T15:30:00Z',
      rankings: [
        createMockRankingEntry({ rank: 1, playerId: 'p1' }),
        createMockRankingEntry({ rank: 2, playerId: 'p2' }),
      ],
    });

    const lookup = buildRankingLookup([imp]);
    const column = lookup.columns[0];

    expect(column.importId).toBe('import-fbg-dyn');
    expect(column.source).toBe('footballguys');
    expect(column.type).toBe('dynasty');
    expect(column.header).toBe('FBG');
    expect(column.fullName).toBe('FootballGuys Dynasty');
    expect(column.playerCount).toBe(2);
    expect(column.importDate).toBe('2025-02-20T15:30:00Z');
  });

  it('should preserve array order (user-defined via drag-and-drop)', () => {
    const imps = [
      createMockRankingImport({ id: '1', source: 'sleeper', type: 'redraft' }),
      createMockRankingImport({ id: '2', source: 'fantasypros', type: 'dynasty' }),
      createMockRankingImport({ id: '3', source: 'fantasypros', type: 'redraft' }),
      createMockRankingImport({ id: '4', source: 'sleeper', type: 'dynasty' }),
      createMockRankingImport({ id: '5', source: 'cbs', type: 'overall' }),
    ];

    const lookup = buildRankingLookup(imps);

    // First column is the average (2+ imports), rest match input order
    const individual = lookup.columns.filter((c) => !c.isAverage);
    expect(individual.map((c) => `${c.source}-${c.type}`)).toEqual([
      'sleeper-redraft',
      'fantasypros-dynasty',
      'fantasypros-redraft',
      'sleeper-dynasty',
      'cbs-overall',
    ]);
  });

  it('should preserve input order regardless of type', () => {
    const imps = [
      createMockRankingImport({ id: '1', source: 'cbs', type: 'redraft' }),
      createMockRankingImport({ id: '2', source: 'cbs', type: 'overall' }),
      createMockRankingImport({ id: '3', source: 'cbs', type: 'dynasty' }),
      createMockRankingImport({ id: '4', source: 'cbs', type: 'adp' }),
    ];

    const lookup = buildRankingLookup(imps);

    const individual = lookup.columns.filter((c) => !c.isAverage);
    expect(individual.map((c) => c.type)).toEqual(['redraft', 'overall', 'dynasty', 'adp']);
  });
});

// ---------------------------------------------------------------------------
// getPlayerRank tests
// ---------------------------------------------------------------------------

describe('getPlayerRank', () => {
  it('should return rank number for matched player', () => {
    const imp = createMockRankingImport({
      id: 'import-1',
      rankings: [
        createMockRankingEntry({ rank: 5, playerId: 'p-mahomes' }),
        createMockRankingEntry({ rank: 15, playerId: 'p-allen' }),
      ],
    });

    const lookup = buildRankingLookup([imp]);

    expect(getPlayerRank(lookup, 'p-mahomes', 'import-1')).toBe(5);
    expect(getPlayerRank(lookup, 'p-allen', 'import-1')).toBe(15);
  });

  it('should return null for unranked player', () => {
    const imp = createMockRankingImport({
      id: 'import-1',
      rankings: [createMockRankingEntry({ rank: 1, playerId: 'p1' })],
    });

    const lookup = buildRankingLookup([imp]);

    expect(getPlayerRank(lookup, 'p-nonexistent', 'import-1')).toBeNull();
  });

  it('should return null for invalid importId', () => {
    const imp = createMockRankingImport({
      id: 'import-1',
      rankings: [createMockRankingEntry({ rank: 1, playerId: 'p1' })],
    });

    const lookup = buildRankingLookup([imp]);

    expect(getPlayerRank(lookup, 'p1', 'invalid-import')).toBeNull();
  });

  it('should handle multiple imports independently', () => {
    const imp1 = createMockRankingImport({
      id: 'import-1',
      source: 'fantasypros',
      rankings: [
        createMockRankingEntry({ rank: 10, playerId: 'p1' }),
        createMockRankingEntry({ rank: 20, playerId: 'p2' }),
      ],
    });

    const imp2 = createMockRankingImport({
      id: 'import-2',
      source: 'sleeper',
      rankings: [
        createMockRankingEntry({ rank: 5, playerId: 'p1' }),
        createMockRankingEntry({ rank: 25, playerId: 'p3' }),
      ],
    });

    const lookup = buildRankingLookup([imp1, imp2]);

    expect(getPlayerRank(lookup, 'p1', 'import-1')).toBe(10);
    expect(getPlayerRank(lookup, 'p1', 'import-2')).toBe(5);
    expect(getPlayerRank(lookup, 'p2', 'import-2')).toBeNull();
    expect(getPlayerRank(lookup, 'p3', 'import-1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SOURCE_LABELS tests
// ---------------------------------------------------------------------------

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

  it('should not have nfl or espn entries', () => {
    expect(SOURCE_LABELS['nfl' as any]).toBeUndefined();
    expect(SOURCE_LABELS['espn' as any]).toBeUndefined();
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

  it('should not have nfl or espn entries', () => {
    expect(SOURCE_ABBREVS['nfl' as any]).toBeUndefined();
    expect(SOURCE_ABBREVS['espn' as any]).toBeUndefined();
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

describe('average rank column', () => {
  it('should NOT add average column when only 1 import exists', () => {
    const imp = createMockRankingImport({ id: 'import-1' });
    const lookup = buildRankingLookup([imp]);

    expect(lookup.columns).toHaveLength(1);
    expect(lookup.columns[0].isAverage).toBeUndefined();
    expect(lookup.byImport.has(AVERAGE_IMPORT_ID)).toBe(false);
  });

  it('should add average column as FIRST column when 2+ imports exist', () => {
    const imp1 = createMockRankingImport({ id: 'import-1', source: 'fantasypros' });
    const imp2 = createMockRankingImport({ id: 'import-2', source: 'sleeper' });
    const lookup = buildRankingLookup([imp1, imp2]);

    expect(lookup.columns).toHaveLength(3); // avg + 2 individual
    expect(lookup.columns[0].isAverage).toBe(true);
    expect(lookup.columns[0].importId).toBe(AVERAGE_IMPORT_ID);
    expect(lookup.columns[0].header).toBe('Avg');
    expect(lookup.columns[0].fullName).toBe('Average Rank');
  });

  it('should compute correct average for player ranked in all imports', () => {
    const imp1 = createMockRankingImport({
      id: 'import-1',
      source: 'fantasypros',
      rankings: [createMockRankingEntry({ rank: 10, playerId: 'p1' })],
    });
    const imp2 = createMockRankingImport({
      id: 'import-2',
      source: 'sleeper',
      rankings: [createMockRankingEntry({ rank: 20, playerId: 'p1' })],
    });

    const lookup = buildRankingLookup([imp1, imp2]);
    const avgMap = lookup.byImport.get(AVERAGE_IMPORT_ID);
    expect(avgMap?.get('p1')).toBe(15); // (10 + 20) / 2
  });

  it('should compute average for player ranked in only 1 of 2 imports', () => {
    const imp1 = createMockRankingImport({
      id: 'import-1',
      source: 'fantasypros',
      rankings: [createMockRankingEntry({ rank: 7, playerId: 'p1' })],
    });
    const imp2 = createMockRankingImport({
      id: 'import-2',
      source: 'sleeper',
      rankings: [createMockRankingEntry({ rank: 3, playerId: 'p2' })],
    });

    const lookup = buildRankingLookup([imp1, imp2]);
    const avgMap = lookup.byImport.get(AVERAGE_IMPORT_ID);
    expect(avgMap?.get('p1')).toBe(7);
    expect(avgMap?.get('p2')).toBe(3);
  });

  it('should round average to nearest integer', () => {
    const imp1 = createMockRankingImport({
      id: 'import-1',
      source: 'fantasypros',
      rankings: [createMockRankingEntry({ rank: 3, playerId: 'p1' })],
    });
    const imp2 = createMockRankingImport({
      id: 'import-2',
      source: 'sleeper',
      rankings: [createMockRankingEntry({ rank: 8, playerId: 'p1' })],
    });

    const lookup = buildRankingLookup([imp1, imp2]);
    const avgMap = lookup.byImport.get(AVERAGE_IMPORT_ID);
    expect(avgMap?.get('p1')).toBe(6); // (3 + 8) / 2 = 5.5 → 6
  });

  it('should compute average across 3 imports correctly', () => {
    const imp1 = createMockRankingImport({
      id: 'import-1',
      source: 'fantasypros',
      rankings: [createMockRankingEntry({ rank: 5, playerId: 'p1' })],
    });
    const imp2 = createMockRankingImport({
      id: 'import-2',
      source: 'sleeper',
      rankings: [createMockRankingEntry({ rank: 10, playerId: 'p1' })],
    });
    const imp3 = createMockRankingImport({
      id: 'import-3',
      source: 'keeptradecut',
      rankings: [createMockRankingEntry({ rank: 15, playerId: 'p1' })],
    });

    const lookup = buildRankingLookup([imp1, imp2, imp3]);
    const avgMap = lookup.byImport.get(AVERAGE_IMPORT_ID);
    expect(avgMap?.get('p1')).toBe(10); // (5 + 10 + 15) / 3
  });

  it('should NOT include unmatched players in average', () => {
    const imp1 = createMockRankingImport({
      id: 'import-1',
      source: 'fantasypros',
      rankings: [createMockRankingEntry({ rank: 1, playerId: null, matched: false })],
    });
    const imp2 = createMockRankingImport({
      id: 'import-2',
      source: 'sleeper',
      rankings: [createMockRankingEntry({ rank: 1, playerId: null, matched: false })],
    });

    const lookup = buildRankingLookup([imp1, imp2]);
    const avgMap = lookup.byImport.get(AVERAGE_IMPORT_ID);
    expect(avgMap?.size).toBe(0);
  });

  it('should preserve individual column order after average column', () => {
    const imp1 = createMockRankingImport({ id: '1', source: 'sleeper' });
    const imp2 = createMockRankingImport({ id: '2', source: 'fantasypros' });
    const imp3 = createMockRankingImport({ id: '3', source: 'keeptradecut' });

    const lookup = buildRankingLookup([imp1, imp2, imp3]);

    expect(lookup.columns[0].isAverage).toBe(true);
    expect(lookup.columns[1].importId).toBe('1');
    expect(lookup.columns[2].importId).toBe('2');
    expect(lookup.columns[3].importId).toBe('3');
  });

  it('should report correct playerCount for average column', () => {
    const imp1 = createMockRankingImport({
      id: 'import-1',
      source: 'fantasypros',
      rankings: [
        createMockRankingEntry({ rank: 1, playerId: 'p1' }),
        createMockRankingEntry({ rank: 2, playerId: 'p2' }),
      ],
    });
    const imp2 = createMockRankingImport({
      id: 'import-2',
      source: 'sleeper',
      rankings: [
        createMockRankingEntry({ rank: 1, playerId: 'p2' }),
        createMockRankingEntry({ rank: 2, playerId: 'p3' }),
      ],
    });

    const lookup = buildRankingLookup([imp1, imp2]);
    const avgCol = lookup.columns[0];
    expect(avgCol.playerCount).toBe(3); // p1, p2, p3
  });

  it('should work with getPlayerRank using AVERAGE_IMPORT_ID', () => {
    const imp1 = createMockRankingImport({
      id: 'import-1',
      source: 'fantasypros',
      rankings: [createMockRankingEntry({ rank: 10, playerId: 'p1' })],
    });
    const imp2 = createMockRankingImport({
      id: 'import-2',
      source: 'sleeper',
      rankings: [createMockRankingEntry({ rank: 20, playerId: 'p1' })],
    });

    const lookup = buildRankingLookup([imp1, imp2]);
    expect(getPlayerRank(lookup, 'p1', AVERAGE_IMPORT_ID)).toBe(15);
    expect(getPlayerRank(lookup, 'p-unknown', AVERAGE_IMPORT_ID)).toBeNull();
  });

  it('should place average column at stored position when set to middle', () => {
    mockGetAveragePosition.mockReturnValue(1);

    const imp1 = createMockRankingImport({ id: '1', source: 'fantasypros' });
    const imp2 = createMockRankingImport({ id: '2', source: 'sleeper' });
    const imp3 = createMockRankingImport({ id: '3', source: 'keeptradecut' });

    const lookup = buildRankingLookup([imp1, imp2, imp3]);

    expect(lookup.columns[0].importId).toBe('1');
    expect(lookup.columns[1].isAverage).toBe(true);
    expect(lookup.columns[2].importId).toBe('2');
    expect(lookup.columns[3].importId).toBe('3');
  });

  it('should place average column at end when position equals import count', () => {
    mockGetAveragePosition.mockReturnValue(3);

    const imp1 = createMockRankingImport({ id: '1', source: 'fantasypros' });
    const imp2 = createMockRankingImport({ id: '2', source: 'sleeper' });
    const imp3 = createMockRankingImport({ id: '3', source: 'keeptradecut' });

    const lookup = buildRankingLookup([imp1, imp2, imp3]);

    expect(lookup.columns[0].importId).toBe('1');
    expect(lookup.columns[1].importId).toBe('2');
    expect(lookup.columns[2].importId).toBe('3');
    expect(lookup.columns[3].isAverage).toBe(true);
  });

  it('should clamp average position to valid range when out of bounds', () => {
    mockGetAveragePosition.mockReturnValue(100);

    const imp1 = createMockRankingImport({ id: '1', source: 'fantasypros' });
    const imp2 = createMockRankingImport({ id: '2', source: 'sleeper' });

    const lookup = buildRankingLookup([imp1, imp2]);

    // Should clamp to last position
    expect(lookup.columns[2].isAverage).toBe(true);
    expect(lookup.columns[0].importId).toBe('1');
    expect(lookup.columns[1].importId).toBe('2');
  });

  it('should clamp negative average position to 0', () => {
    mockGetAveragePosition.mockReturnValue(-5);

    const imp1 = createMockRankingImport({ id: '1', source: 'fantasypros' });
    const imp2 = createMockRankingImport({ id: '2', source: 'sleeper' });

    const lookup = buildRankingLookup([imp1, imp2]);

    expect(lookup.columns[0].isAverage).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Composite rank column tests
// ---------------------------------------------------------------------------

describe('composite rank column', () => {
  it('should NOT add composite column when config is null', () => {
    mockGetCompositeConfig.mockReturnValue(null);

    const imp1 = createMockRankingImport({ id: '1', source: 'fantasypros' });
    const imp2 = createMockRankingImport({ id: '2', source: 'sleeper' });
    const lookup = buildRankingLookup([imp1, imp2]);

    expect(lookup.columns.find((c) => c.isComposite)).toBeUndefined();
    expect(lookup.byImport.has(COMPOSITE_IMPORT_ID)).toBe(false);
  });

  it('should NOT add composite column when fewer than 2 members', () => {
    mockGetCompositeConfig.mockReturnValue({
      members: [{ importId: '1', weight: 1 }],
    });

    const imp1 = createMockRankingImport({ id: '1', source: 'fantasypros' });
    const imp2 = createMockRankingImport({ id: '2', source: 'sleeper' });
    const lookup = buildRankingLookup([imp1, imp2]);

    expect(lookup.columns.find((c) => c.isComposite)).toBeUndefined();
  });

  it('should add composite column as FIRST column when 2+ members', () => {
    mockGetCompositeConfig.mockReturnValue({
      members: [
        { importId: '1', weight: 1 },
        { importId: '2', weight: 1 },
      ],
    });

    const imp1 = createMockRankingImport({ id: '1', source: 'fantasypros' });
    const imp2 = createMockRankingImport({ id: '2', source: 'sleeper' });
    const lookup = buildRankingLookup([imp1, imp2]);

    expect(lookup.columns[0].isComposite).toBe(true);
    expect(lookup.columns[0].importId).toBe(COMPOSITE_IMPORT_ID);
    expect(lookup.columns[0].header).toBe('My Rank');
  });

  it('should compute correct equal-weight composite (same as average)', () => {
    mockGetCompositeConfig.mockReturnValue({
      members: [
        { importId: '1', weight: 1 },
        { importId: '2', weight: 1 },
      ],
    });

    const imp1 = createMockRankingImport({
      id: '1',
      source: 'fantasypros',
      rankings: [createMockRankingEntry({ rank: 10, playerId: 'p1' })],
    });
    const imp2 = createMockRankingImport({
      id: '2',
      source: 'sleeper',
      rankings: [createMockRankingEntry({ rank: 20, playerId: 'p1' })],
    });

    const lookup = buildRankingLookup([imp1, imp2]);
    const compositeMap = lookup.byImport.get(COMPOSITE_IMPORT_ID);
    expect(compositeMap?.get('p1')).toBe(15); // (10*1 + 20*1) / 2
  });

  it('should compute correct weighted composite', () => {
    mockGetCompositeConfig.mockReturnValue({
      members: [
        { importId: '1', weight: 2 },
        { importId: '2', weight: 1 },
      ],
    });

    const imp1 = createMockRankingImport({
      id: '1',
      source: 'fantasypros',
      rankings: [createMockRankingEntry({ rank: 10, playerId: 'p1' })],
    });
    const imp2 = createMockRankingImport({
      id: '2',
      source: 'sleeper',
      rankings: [createMockRankingEntry({ rank: 20, playerId: 'p1' })],
    });

    const lookup = buildRankingLookup([imp1, imp2]);
    const compositeMap = lookup.byImport.get(COMPOSITE_IMPORT_ID);
    expect(compositeMap?.get('p1')).toBe(13); // Math.round((10*2 + 20*1) / 3) = 13.33 → 13
  });

  it('should order columns: composite, members, then others', () => {
    mockGetCompositeConfig.mockReturnValue({
      members: [
        { importId: '1', weight: 1 },
        { importId: '3', weight: 1 },
      ],
    });

    const imp1 = createMockRankingImport({ id: '1', source: 'fantasypros' });
    const imp2 = createMockRankingImport({ id: '2', source: 'sleeper' });
    const imp3 = createMockRankingImport({ id: '3', source: 'keeptradecut' });

    const lookup = buildRankingLookup([imp1, imp2, imp3]);

    // Composite first, then members (1, 3), then others (2), then average
    const nonAvg = lookup.columns.filter((c) => !c.isAverage);
    expect(nonAvg[0].isComposite).toBe(true);
    expect(nonAvg[1].importId).toBe('1');
    expect(nonAvg[1].isCompositeMember).toBe(true);
    expect(nonAvg[2].importId).toBe('3');
    expect(nonAvg[2].isCompositeMember).toBe(true);
    expect(nonAvg[3].importId).toBe('2');
    expect(nonAvg[3].isCompositeMember).toBeUndefined();
  });

  it('should mark last composite member with isLastCompositeMember', () => {
    mockGetCompositeConfig.mockReturnValue({
      members: [
        { importId: '1', weight: 1 },
        { importId: '2', weight: 1 },
      ],
    });

    const imp1 = createMockRankingImport({ id: '1', source: 'fantasypros' });
    const imp2 = createMockRankingImport({ id: '2', source: 'sleeper' });
    const imp3 = createMockRankingImport({ id: '3', source: 'keeptradecut' });

    const lookup = buildRankingLookup([imp1, imp2, imp3]);

    const members = lookup.columns.filter((c) => c.isCompositeMember);
    expect(members).toHaveLength(2);
    expect(members[0].isLastCompositeMember).toBeUndefined();
    expect(members[1].isLastCompositeMember).toBe(true);
  });

  it('should handle player only in 1 of 2 composite members', () => {
    mockGetCompositeConfig.mockReturnValue({
      members: [
        { importId: '1', weight: 1 },
        { importId: '2', weight: 1 },
      ],
    });

    const imp1 = createMockRankingImport({
      id: '1',
      source: 'fantasypros',
      rankings: [createMockRankingEntry({ rank: 7, playerId: 'p1' })],
    });
    const imp2 = createMockRankingImport({
      id: '2',
      source: 'sleeper',
      rankings: [createMockRankingEntry({ rank: 3, playerId: 'p2' })],
    });

    const lookup = buildRankingLookup([imp1, imp2]);
    const compositeMap = lookup.byImport.get(COMPOSITE_IMPORT_ID);
    expect(compositeMap?.get('p1')).toBe(7); // only in imp1
    expect(compositeMap?.get('p2')).toBe(3); // only in imp2
  });

  it('should coexist with average column', () => {
    mockGetCompositeConfig.mockReturnValue({
      members: [
        { importId: '1', weight: 1 },
        { importId: '2', weight: 1 },
      ],
    });

    const imp1 = createMockRankingImport({ id: '1', source: 'fantasypros' });
    const imp2 = createMockRankingImport({ id: '2', source: 'sleeper' });

    const lookup = buildRankingLookup([imp1, imp2]);

    const compositeCol = lookup.columns.find((c) => c.isComposite);
    const avgCol = lookup.columns.find((c) => c.isAverage);
    expect(compositeCol).toBeDefined();
    expect(avgCol).toBeDefined();
    expect(compositeCol?.importId).not.toBe(avgCol?.importId);
  });

  it('should round weighted average to nearest integer', () => {
    mockGetCompositeConfig.mockReturnValue({
      members: [
        { importId: '1', weight: 1 },
        { importId: '2', weight: 2 },
      ],
    });

    const imp1 = createMockRankingImport({
      id: '1',
      source: 'fantasypros',
      rankings: [createMockRankingEntry({ rank: 3, playerId: 'p1' })],
    });
    const imp2 = createMockRankingImport({
      id: '2',
      source: 'sleeper',
      rankings: [createMockRankingEntry({ rank: 8, playerId: 'p1' })],
    });

    const lookup = buildRankingLookup([imp1, imp2]);
    const compositeMap = lookup.byImport.get(COMPOSITE_IMPORT_ID);
    // (3*1 + 8*2) / 3 = 19/3 = 6.333... → 6
    expect(compositeMap?.get('p1')).toBe(6);
  });

  it('should work with getPlayerRank using COMPOSITE_IMPORT_ID', () => {
    mockGetCompositeConfig.mockReturnValue({
      members: [
        { importId: '1', weight: 1 },
        { importId: '2', weight: 1 },
      ],
    });

    const imp1 = createMockRankingImport({
      id: '1',
      source: 'fantasypros',
      rankings: [createMockRankingEntry({ rank: 10, playerId: 'p1' })],
    });
    const imp2 = createMockRankingImport({
      id: '2',
      source: 'sleeper',
      rankings: [createMockRankingEntry({ rank: 20, playerId: 'p1' })],
    });

    const lookup = buildRankingLookup([imp1, imp2]);
    expect(getPlayerRank(lookup, 'p1', COMPOSITE_IMPORT_ID)).toBe(15);
    expect(getPlayerRank(lookup, 'p-unknown', COMPOSITE_IMPORT_ID)).toBeNull();
  });

  it('should report correct playerCount for composite column', () => {
    mockGetCompositeConfig.mockReturnValue({
      members: [
        { importId: '1', weight: 1 },
        { importId: '2', weight: 1 },
      ],
    });

    const imp1 = createMockRankingImport({
      id: '1',
      source: 'fantasypros',
      rankings: [
        createMockRankingEntry({ rank: 1, playerId: 'p1' }),
        createMockRankingEntry({ rank: 2, playerId: 'p2' }),
      ],
    });
    const imp2 = createMockRankingImport({
      id: '2',
      source: 'sleeper',
      rankings: [
        createMockRankingEntry({ rank: 1, playerId: 'p2' }),
        createMockRankingEntry({ rank: 2, playerId: 'p3' }),
      ],
    });

    const lookup = buildRankingLookup([imp1, imp2]);
    const compositeCol = lookup.columns.find((c) => c.isComposite);
    expect(compositeCol?.playerCount).toBe(3); // p1, p2, p3
  });
});
