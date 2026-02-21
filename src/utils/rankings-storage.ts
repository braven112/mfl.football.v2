/**
 * Rankings Storage
 *
 * localStorage CRUD for imported rankings. All data is private per user —
 * never sent to the server, never visible to other league members.
 *
 * Also handles migration from the legacy auctionPredictor.* localStorage keys.
 */

import type { StoredRankingImport } from '../types/rankings-import';

const STORAGE_KEY = 'rankings.imports';

// Legacy keys from the old auction predictor rankings import
const LEGACY_KEYS = [
  'auctionPredictor.dlfRankings',
  'auctionPredictor.footballguysRankings',
  'auctionPredictor.dynastyRankings',
  'auctionPredictor.redraftRankings',
];

// ---------------------------------------------------------------------------
// In-memory cache — avoids repeated localStorage.getItem + JSON.parse.
// Invalidated on every write (saveImport, deleteImport, migrateFromLegacyKeys).
// ---------------------------------------------------------------------------

let _cache: StoredRankingImport[] | null = null;

function readFromStorage(): StoredRankingImport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeToStorage(imports: StoredRankingImport[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(imports));
  _cache = imports;
  writeLegacyKeys(imports);
  window.dispatchEvent(new CustomEvent('rankingsUpdated'));
}

/** Exported for tests — clears the in-memory cache. */
export function _clearCache(): void {
  _cache = null;
}

// Invalidate cache when another tab writes to localStorage
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) _cache = null;
  });
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function getAllImports(): StoredRankingImport[] {
  if (_cache !== null) return _cache;
  _cache = readFromStorage();
  return _cache;
}

/**
 * Find an existing import with the same source and type.
 * Returns the import if found, null otherwise.
 */
export function findDuplicateImport(
  source: StoredRankingImport['source'],
  type: StoredRankingImport['type'],
): StoredRankingImport | null {
  return getAllImports().find((i) => i.source === source && i.type === type) ?? null;
}

/**
 * Save a new import. If an import with the same source and type already
 * exists, it is automatically replaced (merged by replacement) to prevent
 * duplicate columns on the Free Agents page.
 */
export function saveImport(importData: StoredRankingImport): void {
  const imports = [...getAllImports()];

  // Replace existing import with same source+type (prevents duplicate columns)
  const existingIdx = imports.findIndex(
    (i) => i.source === importData.source && i.type === importData.type,
  );
  if (existingIdx !== -1) {
    imports[existingIdx] = importData;
  } else {
    imports.push(importData);
  }

  writeToStorage(imports);
}

export function deleteImport(id: string): void {
  const imports = getAllImports().filter((i) => i.id !== id);
  writeToStorage(imports);
}

export function getImportById(id: string): StoredRankingImport | null {
  return getAllImports().find((i) => i.id === id) ?? null;
}

export function getLatestImportByType(
  type: 'dynasty' | 'redraft' | 'adp' | 'overall',
): StoredRankingImport | null {
  const imports = getAllImports().filter((i) => i.type === type);
  if (imports.length === 0) return null;
  // Most recent by importDate
  return imports.sort(
    (a, b) => new Date(b.importDate).getTime() - new Date(a.importDate).getTime(),
  )[0];
}

// ---------------------------------------------------------------------------
// Migration from legacy auctionPredictor.* keys
// ---------------------------------------------------------------------------

export function migrateFromLegacyKeys(): void {
  const existing = getAllImports();
  if (existing.length > 0) return; // Already migrated or has new data

  let migrated = false;

  for (const key of LEGACY_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      const legacyRankings = JSON.parse(raw);
      if (!Array.isArray(legacyRankings) || legacyRankings.length === 0) continue;

      // Determine source and type from key name
      const source = key.includes('dlf')
        ? 'dlf'
        : key.includes('footballguys')
          ? 'footballguys'
          : 'custom';
      const type = key.includes('redraft') ? 'redraft' : 'dynasty';

      const converted: StoredRankingImport = {
        id: generateId(),
        source: source as StoredRankingImport['source'],
        type: type as StoredRankingImport['type'],
        importDate: new Date().toISOString(),
        rankings: legacyRankings.map((r: any, idx: number) => ({
          rank: r.rank ?? idx + 1,
          playerId: r.matchedPlayerId ?? null,
          playerName: r.playerName ?? r.name ?? '',
          position: r.position ?? '',
          team: r.team ?? '',
          matched: !!r.matchedPlayerId,
          confidence: r.matchedPlayerId ? 1 : 0,
          tier: r.tier,
        })),
        stats: {
          total: legacyRankings.length,
          matched: legacyRankings.filter((r: any) => r.matchedPlayerId).length,
          unmatched: legacyRankings.filter((r: any) => !r.matchedPlayerId).length,
          matchRate: legacyRankings.length > 0
            ? (legacyRankings.filter((r: any) => r.matchedPlayerId).length / legacyRankings.length) * 100
            : 0,
        },
      };

      existing.push(converted);
      migrated = true;
    } catch {
      // Skip malformed legacy data
    }
  }

  if (migrated) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    _cache = existing;
    // Remove legacy keys
    for (const key of LEGACY_KEYS) {
      localStorage.removeItem(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Backward compatibility bridge for auction predictor
// ---------------------------------------------------------------------------

function writeLegacyKeys(imports: StoredRankingImport[]): void {
  // Write dynasty rankings to legacy key
  const dynasty = imports.find((i) => i.type === 'dynasty');
  if (dynasty) {
    const legacyFormat = dynasty.rankings.map((r) => ({
      rank: r.rank,
      playerName: r.playerName,
      position: r.position,
      team: r.team,
      matchedPlayerId: r.playerId,
    }));
    localStorage.setItem('auctionPredictor.dynastyRankings', JSON.stringify(legacyFormat));
  }

  // Write redraft rankings to legacy key
  const redraft = imports.find((i) => i.type === 'redraft');
  if (redraft) {
    const legacyFormat = redraft.rankings.map((r) => ({
      rank: r.rank,
      playerName: r.playerName,
      position: r.position,
      team: r.team,
      matchedPlayerId: r.playerId,
    }));
    localStorage.setItem('auctionPredictor.redraftRankings', JSON.stringify(legacyFormat));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
