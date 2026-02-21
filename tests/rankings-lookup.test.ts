import { describe, it, expect } from 'vitest';
import {
  formatColumnHeader,
  formatFullName,
  buildRankingLookup,
  getPlayerRank,
  SOURCE_LABELS,
  SOURCE_ABBREVS,
  TYPE_LABELS,
} from '../src/utils/rankings-lookup';
import type {
  StoredRankingImport,
  StoredRankingEntry,
  RankingSourceId,
  RankingType,
} from '../src/types/rankings-import';

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
  it('should format footballguys dynasty to "FBG Dyn"', () => {
    const imp = createMockRankingImport({ source: 'footballguys', type: 'dynasty' });
    expect(formatColumnHeader(imp)).toBe('FBG Dyn');
  });

  it('should format fantasypros redraft to "FPros Rdf"', () => {
    const imp = createMockRankingImport({ source: 'fantasypros', type: 'redraft' });
    expect(formatColumnHeader(imp)).toBe('FPros Rdf');
  });

  it('should format sleeper adp to "Sleep ADP"', () => {
    const imp = createMockRankingImport({ source: 'sleeper', type: 'adp' });
    expect(formatColumnHeader(imp)).toBe('Sleep ADP');
  });

  it('should format keeptradecut overall to "KTC All"', () => {
    const imp = createMockRankingImport({ source: 'keeptradecut', type: 'overall' });
    expect(formatColumnHeader(imp)).toBe('KTC All');
  });

  it('should format custom dynasty to "Cust Dyn"', () => {
    const imp = createMockRankingImport({ source: 'custom', type: 'dynasty' });
    expect(formatColumnHeader(imp)).toBe('Cust Dyn');
  });

  it('should format cbs redraft to "CBS Rdf"', () => {
    const imp = createMockRankingImport({ source: 'cbs', type: 'redraft' });
    expect(formatColumnHeader(imp)).toBe('CBS Rdf');
  });

  it('should format dlf overall to "DLF All"', () => {
    const imp = createMockRankingImport({ source: 'dlf', type: 'overall' });
    expect(formatColumnHeader(imp)).toBe('DLF All');
  });

  it('should format yahoo adp to "Yahoo ADP"', () => {
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

    expect(lookup.byImport.size).toBe(2);
    expect(lookup.byImport.get('import-1')?.size).toBe(2);
    expect(lookup.byImport.get('import-2')?.size).toBe(2);
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
    expect(column.header).toBe('FBG Dyn');
    expect(column.fullName).toBe('FootballGuys Dynasty');
    expect(column.playerCount).toBe(2);
    expect(column.importDate).toBe('2025-02-20T15:30:00Z');
  });

  it('should sort columns by source name alphabetically, then by type', () => {
    const imps = [
      createMockRankingImport({ id: '1', source: 'sleeper', type: 'redraft' }),
      createMockRankingImport({ id: '2', source: 'fantasypros', type: 'dynasty' }),
      createMockRankingImport({ id: '3', source: 'fantasypros', type: 'redraft' }),
      createMockRankingImport({ id: '4', source: 'sleeper', type: 'dynasty' }),
      createMockRankingImport({ id: '5', source: 'cbs', type: 'overall' }),
    ];

    const lookup = buildRankingLookup(imps);

    // Expected order:
    // 1. cbs overall
    // 2. fantasypros dynasty
    // 3. fantasypros redraft
    // 4. sleeper dynasty
    // 5. sleeper redraft
    expect(lookup.columns.map((c) => `${c.source}-${c.type}`)).toEqual([
      'cbs-overall',
      'fantasypros-dynasty',
      'fantasypros-redraft',
      'sleeper-dynasty',
      'sleeper-redraft',
    ]);
  });

  it('should sort types in correct order: dynasty → overall → redraft', () => {
    const imps = [
      createMockRankingImport({ id: '1', source: 'cbs', type: 'redraft' }),
      createMockRankingImport({ id: '2', source: 'cbs', type: 'overall' }),
      createMockRankingImport({ id: '3', source: 'cbs', type: 'dynasty' }),
      createMockRankingImport({ id: '4', source: 'cbs', type: 'adp' }), // Should sort last
    ];

    const lookup = buildRankingLookup(imps);

    expect(lookup.columns.map((c) => c.type)).toEqual(['dynasty', 'overall', 'redraft', 'adp']);
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
