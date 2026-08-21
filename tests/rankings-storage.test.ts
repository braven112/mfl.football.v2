import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getAllImports,
  saveImport,
  deleteImport,
  getImportById,
  getLatestImportByType,
  findDuplicateImport,
  migrateFromLegacyKeys,
  getCompositeConfig,
  saveCompositeConfig,
  toggleCompositeImport,
  syncBuiltinImports,
  setBuiltinHidden,
  setCompositeWeight,
  _clearCache,
} from '../src/utils/rankings-storage';
import type { StoredRankingImport } from '../src/types/rankings-import';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockImport(overrides: Partial<StoredRankingImport> = {}): StoredRankingImport {
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    source: 'fantasypros',
    type: 'dynasty',
    importDate: new Date().toISOString(),
    rankings: [
      {
        rank: 1,
        playerId: 'p001',
        playerName: 'Patrick Mahomes',
        position: 'QB',
        team: 'KC',
        matched: true,
        confidence: 1.0,
      },
      {
        rank: 2,
        playerId: 'p002',
        playerName: 'Josh Allen',
        position: 'QB',
        team: 'BUF',
        matched: true,
        confidence: 0.95,
      },
      {
        rank: 3,
        playerId: null,
        playerName: 'Unknown Player',
        position: 'RB',
        team: '',
        matched: false,
        confidence: 0.3,
      },
    ],
    stats: {
      total: 3,
      matched: 2,
      unmatched: 1,
      matchRate: 66.7,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock localStorage
// ---------------------------------------------------------------------------

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    _getStore: () => store,
  };
})();

// Mock window.dispatchEvent and window.addEventListener
const dispatchEventMock = vi.fn();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });
Object.defineProperty(globalThis, 'window', {
  value: {
    dispatchEvent: dispatchEventMock,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
  writable: true,
});

// Also need CustomEvent in node environment
if (typeof CustomEvent === 'undefined') {
  (globalThis as any).CustomEvent = class CustomEvent extends Event {
    detail: any;
    constructor(type: string, eventInitDict?: any) {
      super(type);
      this.detail = eventInitDict?.detail;
    }
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('rankings-storage', () => {
  beforeEach(() => {
    localStorageMock.clear();
    _clearCache();
    vi.clearAllMocks();
  });

  // ---- getAllImports ----

  describe('getAllImports', () => {
    it('returns empty array when no data stored', () => {
      expect(getAllImports()).toEqual([]);
    });

    it('returns parsed imports from localStorage', () => {
      const imp = createMockImport({ id: 'test-1' });
      localStorageMock.setItem('rankings.imports', JSON.stringify([imp]));
      const result = getAllImports();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('test-1');
    });

    it('returns empty array for malformed JSON', () => {
      localStorageMock.setItem('rankings.imports', 'not-json');
      expect(getAllImports()).toEqual([]);
    });
  });

  // ---- saveImport ----

  describe('saveImport', () => {
    it('saves a new import to localStorage', () => {
      const imp = createMockImport({ id: 'save-1' });
      saveImport(imp);
      const stored = JSON.parse(localStorageMock._getStore()['rankings.imports']);
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe('save-1');
    });

    it('appends to existing imports when source/type differ', () => {
      const imp1 = createMockImport({ id: 'a1', source: 'fantasypros', type: 'dynasty' });
      const imp2 = createMockImport({ id: 'a2', source: 'cbs', type: 'redraft' });
      saveImport(imp1);
      saveImport(imp2);
      const stored = JSON.parse(localStorageMock._getStore()['rankings.imports']);
      expect(stored).toHaveLength(2);
    });

    it('replaces existing import with same source and type', () => {
      const imp1 = createMockImport({
        id: 'old-id',
        source: 'keeptradecut',
        type: 'dynasty',
        stats: { total: 50, matched: 45, unmatched: 5, matchRate: 90 },
      });
      saveImport(imp1);

      const imp2 = createMockImport({
        id: 'old-id',
        source: 'keeptradecut',
        type: 'dynasty',
        stats: { total: 100, matched: 95, unmatched: 5, matchRate: 95 },
      });
      saveImport(imp2);

      const stored = JSON.parse(localStorageMock._getStore()['rankings.imports']);
      expect(stored).toHaveLength(1);
      expect(stored[0].stats.total).toBe(100);
    });

    it('dispatches rankingsUpdated event', () => {
      saveImport(createMockImport());
      expect(dispatchEventMock).toHaveBeenCalled();
      const event = dispatchEventMock.mock.calls[0][0];
      expect(event.type).toBe('rankingsUpdated');
    });

    it('writes legacy dynasty key when saving dynasty import', () => {
      const imp = createMockImport({ source: 'dlf', type: 'dynasty' });
      saveImport(imp);
      const legacyRaw = localStorageMock._getStore()['auctionPredictor.dynastyRankings'];
      expect(legacyRaw).toBeDefined();
      const legacyData = JSON.parse(legacyRaw);
      expect(legacyData[0]).toHaveProperty('matchedPlayerId');
    });

    it('writes legacy redraft key when saving redraft import', () => {
      const imp = createMockImport({ source: 'cbs', type: 'redraft' });
      saveImport(imp);
      const legacyRaw = localStorageMock._getStore()['auctionPredictor.redraftRankings'];
      expect(legacyRaw).toBeDefined();
    });
  });

  // ---- deleteImport ----

  describe('deleteImport', () => {
    it('removes import by id', () => {
      const imp1 = createMockImport({ id: 'keep-me', source: 'fantasypros', type: 'dynasty' });
      const imp2 = createMockImport({ id: 'delete-me', source: 'cbs', type: 'redraft' });
      saveImport(imp1);
      saveImport(imp2);

      deleteImport('delete-me');
      const stored = JSON.parse(localStorageMock._getStore()['rankings.imports']);
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe('keep-me');
    });

    it('dispatches rankingsUpdated event', () => {
      saveImport(createMockImport({ id: 'del-test' }));
      vi.clearAllMocks();
      deleteImport('del-test');
      expect(dispatchEventMock).toHaveBeenCalled();
    });

    it('handles deleting non-existent id gracefully', () => {
      saveImport(createMockImport({ id: 'exists' }));
      deleteImport('does-not-exist');
      const stored = JSON.parse(localStorageMock._getStore()['rankings.imports']);
      expect(stored).toHaveLength(1);
    });
  });

  // ---- getImportById ----

  describe('getImportById', () => {
    it('returns import when found', () => {
      const imp = createMockImport({ id: 'find-me' });
      saveImport(imp);
      const result = getImportById('find-me');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('find-me');
    });

    it('returns null when not found', () => {
      expect(getImportById('nonexistent')).toBeNull();
    });
  });

  // ---- getLatestImportByType ----

  describe('getLatestImportByType', () => {
    it('returns most recent import of given type', () => {
      const older = createMockImport({
        id: 'old',
        source: 'fantasypros',
        type: 'dynasty',
        importDate: '2026-01-01T00:00:00Z',
      });
      const newer = createMockImport({
        id: 'new',
        source: 'dlf',
        type: 'dynasty',
        importDate: '2026-02-15T00:00:00Z',
      });
      saveImport(older);
      saveImport(newer);

      const result = getLatestImportByType('dynasty');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('new');
    });

    it('returns null when no imports of that type exist', () => {
      saveImport(createMockImport({ type: 'dynasty' }));
      expect(getLatestImportByType('redraft')).toBeNull();
    });

    it('returns null when no imports exist at all', () => {
      expect(getLatestImportByType('dynasty')).toBeNull();
    });
  });

  // ---- findDuplicateImport ----

  describe('findDuplicateImport', () => {
    it('returns existing import with same source and type', () => {
      const imp = createMockImport({
        id: 'dup-target',
        source: 'keeptradecut',
        type: 'dynasty',
      });
      saveImport(imp);
      const result = findDuplicateImport('keeptradecut', 'dynasty');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('dup-target');
    });

    it('returns null when source matches but type differs', () => {
      saveImport(createMockImport({ source: 'keeptradecut', type: 'dynasty' }));
      expect(findDuplicateImport('keeptradecut', 'redraft')).toBeNull();
    });

    it('returns null when type matches but source differs', () => {
      saveImport(createMockImport({ source: 'keeptradecut', type: 'dynasty' }));
      expect(findDuplicateImport('dlf', 'dynasty')).toBeNull();
    });

    it('returns null when no imports exist', () => {
      expect(findDuplicateImport('fantasypros', 'dynasty')).toBeNull();
    });
  });

  // ---- migrateFromLegacyKeys ----

  describe('migrateFromLegacyKeys', () => {
    it('migrates legacy DLF rankings', () => {
      const legacyData = [
        { rank: 1, playerName: 'Player A', position: 'QB', team: 'KC', matchedPlayerId: 'p001' },
        { rank: 2, playerName: 'Player B', position: 'RB', team: 'ATL', matchedPlayerId: null },
      ];
      localStorageMock.setItem('auctionPredictor.dlfRankings', JSON.stringify(legacyData));

      migrateFromLegacyKeys();

      const imports = getAllImports();
      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('dlf');
      expect(imports[0].type).toBe('dynasty');
      expect(imports[0].rankings).toHaveLength(2);
      expect(imports[0].stats.matched).toBe(1);
      expect(imports[0].stats.unmatched).toBe(1);
    });

    it('skips migration when imports already exist', () => {
      saveImport(createMockImport());
      localStorageMock.setItem(
        'auctionPredictor.dlfRankings',
        JSON.stringify([{ rank: 1, playerName: 'Test', position: 'QB' }]),
      );

      migrateFromLegacyKeys();

      const imports = getAllImports();
      expect(imports).toHaveLength(1); // Only the original, not the legacy
    });

    it('removes legacy keys after successful migration', () => {
      localStorageMock.setItem(
        'auctionPredictor.dlfRankings',
        JSON.stringify([{ rank: 1, playerName: 'Test', position: 'QB', matchedPlayerId: 'p1' }]),
      );

      migrateFromLegacyKeys();

      expect(localStorageMock.getItem('auctionPredictor.dlfRankings')).toBeNull();
    });

    it('handles malformed legacy data gracefully', () => {
      localStorageMock.setItem('auctionPredictor.dlfRankings', 'not-json');
      migrateFromLegacyKeys();
      expect(getAllImports()).toEqual([]);
    });

    it('handles empty legacy arrays', () => {
      localStorageMock.setItem('auctionPredictor.dlfRankings', JSON.stringify([]));
      migrateFromLegacyKeys();
      expect(getAllImports()).toEqual([]);
    });
  });

  // ---- Composite config ----

  describe('composite config', () => {
    it('getCompositeConfig returns null when nothing stored', () => {
      expect(getCompositeConfig()).toBeNull();
    });

    it('getCompositeConfig returns null for malformed JSON', () => {
      localStorageMock.setItem('rankings.compositeConfig', 'not-json');
      expect(getCompositeConfig()).toBeNull();
    });

    it('getCompositeConfig returns null when fewer than 2 valid members', () => {
      const imp = createMockImport({ id: 'imp-1' });
      saveImport(imp);
      localStorageMock.setItem(
        'rankings.compositeConfig',
        JSON.stringify({ members: [{ importId: 'imp-1', weight: 1 }] }),
      );
      expect(getCompositeConfig()).toBeNull();
    });

    it('getCompositeConfig filters out stale import IDs', () => {
      const imp = createMockImport({ id: 'valid-1', source: 'fantasypros', type: 'dynasty' });
      const imp2 = createMockImport({ id: 'valid-2', source: 'sleeper', type: 'dynasty' });
      saveImport(imp);
      saveImport(imp2);
      localStorageMock.setItem(
        'rankings.compositeConfig',
        JSON.stringify({
          members: [
            { importId: 'valid-1', weight: 1 },
            { importId: 'deleted-id', weight: 2 },
            { importId: 'valid-2', weight: 1 },
          ],
        }),
      );
      const config = getCompositeConfig();
      expect(config).not.toBeNull();
      expect(config!.members).toHaveLength(2);
      expect(config!.members.map((m) => m.importId)).toEqual(['valid-1', 'valid-2']);
    });

    it('saveCompositeConfig persists to localStorage and fires event', () => {
      saveCompositeConfig({
        members: [
          { importId: 'a', weight: 1 },
          { importId: 'b', weight: 2 },
        ],
      });
      const stored = JSON.parse(localStorageMock._getStore()['rankings.compositeConfig']);
      expect(stored.members).toHaveLength(2);
      expect(dispatchEventMock).toHaveBeenCalled();
    });

    it('toggleCompositeImport adds a member owning the whole composite', () => {
      // Weights are percentages, so the only member is 100% of My Rank.
      toggleCompositeImport('imp-1', true);
      const stored = JSON.parse(localStorageMock._getStore()['rankings.compositeConfig']);
      expect(stored.members).toHaveLength(1);
      expect(stored.members[0]).toEqual({ importId: 'imp-1', weight: 100 });
    });

    it('toggleCompositeImport removes a member', () => {
      localStorageMock.setItem(
        'rankings.compositeConfig',
        JSON.stringify({
          members: [
            { importId: 'a', weight: 1 },
            { importId: 'b', weight: 2 },
          ],
        }),
      );
      toggleCompositeImport('a', false);
      const stored = JSON.parse(localStorageMock._getStore()['rankings.compositeConfig']);
      expect(stored.members).toHaveLength(1);
      expect(stored.members[0].importId).toBe('b');
    });

    it('toggleCompositeImport does not add duplicates', () => {
      localStorageMock.setItem(
        'rankings.compositeConfig',
        JSON.stringify({ members: [{ importId: 'a', weight: 2 }] }),
      );
      toggleCompositeImport('a', true);
      const stored = JSON.parse(localStorageMock._getStore()['rankings.compositeConfig']);
      expect(stored.members).toHaveLength(1);
    });

    it('setCompositeWeight updates weight for existing member', () => {
      localStorageMock.setItem(
        'rankings.compositeConfig',
        JSON.stringify({
          members: [
            { importId: 'a', weight: 1 },
            { importId: 'b', weight: 1 },
          ],
        }),
      );
      // Pins 'a' at the typed value; 'b' absorbs the rest so the total is 100.
      setCompositeWeight('a', 3);
      const stored = JSON.parse(localStorageMock._getStore()['rankings.compositeConfig']);
      const byId = Object.fromEntries(stored.members.map((m: any) => [m.importId, m.weight]));
      expect(byId.a).toBe(3);
      expect(byId.b).toBe(97);
      expect(byId.a + byId.b).toBe(100);
    });

    it('deleteImport removes deleted ID from composite config', () => {
      const imp1 = createMockImport({ id: 'keep', source: 'fantasypros', type: 'dynasty' });
      const imp2 = createMockImport({ id: 'remove', source: 'sleeper', type: 'dynasty' });
      saveImport(imp1);
      saveImport(imp2);
      localStorageMock.setItem(
        'rankings.compositeConfig',
        JSON.stringify({
          members: [
            { importId: 'keep', weight: 1 },
            { importId: 'remove', weight: 2 },
          ],
        }),
      );

      deleteImport('remove');

      const stored = JSON.parse(localStorageMock._getStore()['rankings.compositeConfig']);
      expect(stored.members).toHaveLength(1);
      expect(stored.members[0].importId).toBe('keep');
    });

    it('saveImport swaps old ID for new ID in composite config on replace', () => {
      const imp1 = createMockImport({ id: 'old-id', source: 'fantasypros', type: 'dynasty' });
      saveImport(imp1);
      localStorageMock.setItem(
        'rankings.compositeConfig',
        JSON.stringify({
          members: [
            { importId: 'old-id', weight: 2 },
            { importId: 'other', weight: 1 },
          ],
        }),
      );

      const imp2 = createMockImport({ id: 'new-id', source: 'fantasypros', type: 'dynasty' });
      saveImport(imp2);

      const stored = JSON.parse(localStorageMock._getStore()['rankings.compositeConfig']);
      expect(stored.members[0]).toEqual({ importId: 'new-id', weight: 2 });
      expect(stored.members[1]).toEqual({ importId: 'other', weight: 1 });
    });
  });

  describe('composite weights normalize to 100', () => {
    // Weights are shown to owners as percentages, so "5" has to MEAN 5% of My
    // Rank. The composite divides by total weight, so without normalizing, 5
    // against three sources at 1 each is really 62.5% — the opposite of what
    // the input implies. This is the contract that makes the number honest.
    const membersFromStore = () =>
      JSON.parse(localStorageMock._getStore()['rankings.compositeConfig']).members as {
        importId: string;
        weight: number;
      }[];
    const total = () => membersFromStore().reduce((s, m) => s + m.weight, 0);

    it('keeps the total at 100 as sources are added', () => {
      for (const id of ['a', 'b', 'c', 'd']) toggleCompositeImport(id, true);
      expect(membersFromStore()).toHaveLength(4);
      expect(total()).toBe(100);
    });

    it('never leaves a newly added source at 0%', () => {
      // A member at 0 is in the composite but ignored — worse than absent,
      // because the UI shows it as contributing.
      for (const id of ['a', 'b', 'c']) toggleCompositeImport(id, true);
      for (const m of membersFromStore()) expect(m.weight).toBeGreaterThan(0);
    });

    it('a small pinned weight stays small', () => {
      for (const id of ['a', 'b', 'c', 'd']) toggleCompositeImport(id, true);
      setCompositeWeight('d', 5);
      const byId = Object.fromEntries(membersFromStore().map((m) => [m.importId, m.weight]));
      expect(byId.d).toBe(5);
      expect(total()).toBe(100);
    });

    it('re-totals to 100 after a built-in is hidden', () => {
      // Hiding drops the source from the composite. Without rebalancing, the
      // survivors keep their old percentages and the table shows numbers that
      // add to 68.3 — which is what shipped to the preview.
      for (const id of ['a', 'b', 'c']) toggleCompositeImport(id, true);
      setBuiltinHidden('b', true);
      const members = membersFromStore();
      expect(members.some((m) => m.importId === 'b')).toBe(false);
      expect(members.reduce((s, m) => s + m.weight, 0)).toBe(100);
    });

    it('re-totals to 100 after a source is removed', () => {
      for (const id of ['a', 'b', 'c']) toggleCompositeImport(id, true);
      toggleCompositeImport('b', false);
      expect(membersFromStore()).toHaveLength(2);
      expect(total()).toBe(100);
    });
  });

  describe('hidden built-ins survive unrelated writes', () => {
    // Every mutation path rebuilds the list from getAllImports(), which HIDES
    // what the owner hid. Writing that back erased the hidden rows from raw
    // storage, so the next reconciliation saw them as new and re-seeded them —
    // saving an unrelated import silently un-hid a source.
    const rawStore = () =>
      JSON.parse(localStorageMock._getStore()['rankings.imports'] || '[]') as {
        id: string;
        provided?: boolean;
      }[];

    const snapshot = {
      generatedAt: '2026-08-21T00:00:00.000Z',
      sources: [
        { id: 'mfl-adp', label: 'MFL ADP', type: 'adp', players: [{ id: 'p1', rank: 1 }] },
        { id: 'sharks', label: 'Sharks', type: 'redraft', players: [{ id: 'p1', rank: 1 }] },
      ],
    };

    it('keeps a hidden source in raw storage when another import is saved', () => {
      syncBuiltinImports(snapshot as never, ['mfl-adp', 'sharks']);
      setBuiltinHidden('builtin:sharks', true);
      expect(getAllImports().some((i) => i.id === 'builtin:sharks')).toBe(false);

      saveImport(createMockImport({ id: 'user-1', source: 'fantasypros', type: 'dynasty' }));

      // Still present in RAW storage, still hidden from the filtered view.
      expect(rawStore().some((i) => i.id === 'builtin:sharks')).toBe(true);
      expect(getAllImports().some((i) => i.id === 'builtin:sharks')).toBe(false);
    });

    it('does not re-tick a hidden source on the next reconciliation', () => {
      syncBuiltinImports(snapshot as never, ['mfl-adp', 'sharks']);
      setBuiltinHidden('builtin:sharks', true);
      saveImport(createMockImport({ id: 'user-1', source: 'fantasypros', type: 'dynasty' }));
      syncBuiltinImports(snapshot as never, ['mfl-adp', 'sharks']);

      const members = JSON.parse(
        localStorageMock._getStore()['rankings.compositeConfig'] || '{"members":[]}',
      ).members as { importId: string }[];
      expect(members.some((m) => m.importId === 'builtin:sharks')).toBe(false);
    });
  });

  describe('deleting an import rebalances the composite', () => {
    it('leaves the remaining weights totalling 100', () => {
      // Same class as the hide bug, in the sibling path.
      const a = createMockImport({ id: 'a', source: 'fantasypros', type: 'dynasty' });
      const b = createMockImport({ id: 'b', source: 'cbs', type: 'redraft' });
      const c = createMockImport({ id: 'c', source: 'yahoo', type: 'adp' });
      [a, b, c].forEach(saveImport);
      ['a', 'b', 'c'].forEach((id) => toggleCompositeImport(id, true));

      deleteImport('b');

      const members = JSON.parse(
        localStorageMock._getStore()['rankings.compositeConfig'],
      ).members as { importId: string; weight: number }[];
      expect(members.some((m) => m.importId === 'b')).toBe(false);
      expect(members.reduce((s, m) => s + m.weight, 0)).toBe(100);
    });
  });
});