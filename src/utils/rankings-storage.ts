/**
 * Rankings Storage
 *
 * localStorage CRUD for imported rankings with Redis sync for cross-device
 * access. localStorage is the instant layer; Redis (via /api/ri) is the
 * durable layer that lets rankings follow you across devices.
 *
 * Also handles migration from the legacy auctionPredictor.* localStorage keys.
 */

import type { StoredRankingImport, CompositeRankConfig, SyncedRankingsPayload } from '../types/rankings-import';
import { loadFromServer, saveToServer } from './rankings-sync';

const STORAGE_KEY = 'rankings.imports';
const AVG_POSITION_KEY = 'rankings.averagePosition';
const COMPOSITE_CONFIG_KEY = 'rankings.compositeConfig';

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
  syncToServer();
}

/** Exported for tests — clears the in-memory cache. */
export function _clearCache(): void {
  _cache = null;
}

// Invalidate cache when another tab writes to localStorage
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) _cache = null;
    if (e.key === COMPOSITE_CONFIG_KEY) {
      window.dispatchEvent(new CustomEvent('rankingsUpdated'));
    }
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
    const oldId = imports[existingIdx].id;
    const newId = importData.id;

    // Update composite config to reference the new import ID
    if (oldId !== newId) {
      try {
        const raw = localStorage.getItem(COMPOSITE_CONFIG_KEY);
        if (raw) {
          const config = JSON.parse(raw) as CompositeRankConfig;
          let changed = false;
          for (const member of config.members) {
            if (member.importId === oldId) {
              member.importId = newId;
              changed = true;
            }
          }
          if (changed) {
            localStorage.setItem(COMPOSITE_CONFIG_KEY, JSON.stringify(config));
          }
        }
      } catch { /* ignore malformed config */ }
    }

    imports[existingIdx] = importData;
  } else {
    imports.push(importData);
  }

  writeToStorage(imports);
}

export function deleteImport(id: string): void {
  const imports = getAllImports().filter((i) => i.id !== id);
  writeToStorage(imports);

  // Remove from composite config if present
  try {
    const raw = localStorage.getItem(COMPOSITE_CONFIG_KEY);
    if (raw) {
      const config = JSON.parse(raw) as CompositeRankConfig;
      const filtered = config.members.filter((m) => m.importId !== id);
      if (filtered.length !== config.members.length) {
        localStorage.setItem(COMPOSITE_CONFIG_KEY, JSON.stringify({ members: filtered }));
      }
    }
  } catch { /* ignore malformed config */ }
}

export function getImportById(id: string): StoredRankingImport | null {
  return getAllImports().find((i) => i.id === id) ?? null;
}

/**
 * Reorder imports to match the provided ID sequence.
 * IDs not found in storage are skipped.
 *
 * The special '__average__' ID may appear in the list to indicate
 * where the average rank column should be positioned. Its index
 * is stored separately in localStorage.
 */
export function reorderImports(importIds: string[]): void {
  const AVERAGE_ID = '__average__';
  const averageIndex = importIds.indexOf(AVERAGE_ID);

  // Filter out the synthetic average ID before matching real imports
  const realIds = importIds.filter((id) => id !== AVERAGE_ID);

  const currentImports = getAllImports();
  const byId = new Map(currentImports.map((imp) => [imp.id, imp]));

  const reordered: StoredRankingImport[] = [];
  for (const id of realIds) {
    const imp = byId.get(id);
    if (imp) reordered.push(imp);
  }

  writeToStorage(reordered);

  // Persist average column position (only meaningful when 2+ imports)
  if (averageIndex !== -1) {
    localStorage.setItem(AVG_POSITION_KEY, String(averageIndex));
  }
}

/**
 * Get the stored position index for the average rank column.
 * Returns 0 (first) if no position has been explicitly set.
 */
export function getAveragePosition(): number {
  try {
    const raw = localStorage.getItem(AVG_POSITION_KEY);
    return raw != null ? parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Composite rank config
// ---------------------------------------------------------------------------

/**
 * Get the composite rank configuration.
 * Validates member IDs against current imports and returns null if fewer
 * than 2 valid members remain.
 */
export function getCompositeConfig(): CompositeRankConfig | null {
  try {
    const raw = localStorage.getItem(COMPOSITE_CONFIG_KEY);
    if (!raw) return null;
    const config = JSON.parse(raw) as CompositeRankConfig;
    if (!config.members || !Array.isArray(config.members)) return null;

    // Filter out members that reference deleted imports
    const validIds = new Set(getAllImports().map((i) => i.id));
    const valid = config.members.filter((m) => validIds.has(m.importId));
    return valid.length >= 2 ? { members: valid } : null;
  } catch {
    return null;
  }
}

/**
 * Save composite rank configuration.
 * Fires 'rankingsUpdated' event so all consumers react.
 */
export function saveCompositeConfig(config: CompositeRankConfig): void {
  localStorage.setItem(COMPOSITE_CONFIG_KEY, JSON.stringify(config));
  window.dispatchEvent(new CustomEvent('rankingsUpdated'));
  syncToServer();
}

/**
 * Toggle a specific import's inclusion in the composite.
 * When including, uses default weight of 1.
 */
export function toggleCompositeImport(importId: string, included: boolean): void {
  const raw = localStorage.getItem(COMPOSITE_CONFIG_KEY);
  const current: CompositeRankConfig = raw ? JSON.parse(raw) : { members: [] };

  if (included) {
    if (!current.members.find((m) => m.importId === importId)) {
      current.members.push({ importId, weight: 1 });
    }
  } else {
    current.members = current.members.filter((m) => m.importId !== importId);
  }

  saveCompositeConfig(current);
}

/**
 * Update the weight for a composite member.
 */
export function setCompositeWeight(importId: string, weight: 1 | 2 | 3): void {
  const raw = localStorage.getItem(COMPOSITE_CONFIG_KEY);
  const current: CompositeRankConfig = raw ? JSON.parse(raw) : { members: [] };
  const member = current.members.find((m) => m.importId === importId);
  if (member) {
    member.weight = weight;
    saveCompositeConfig(current);
  }
}

// ---------------------------------------------------------------------------
// Latest import lookup
// ---------------------------------------------------------------------------

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
// Server sync (Redis via /api/ri)
// ---------------------------------------------------------------------------

/** Build the current state into a payload and push to server. Fire-and-forget. */
function syncToServer(): void {
  const imports = getAllImports();
  const compositeConfig = getCompositeConfig();
  const averagePosition = getAveragePosition();

  const payload: SyncedRankingsPayload = {
    imports,
    compositeConfig,
    averagePosition,
    lastModified: new Date().toISOString(),
  };

  saveToServer(payload);
}

/**
 * Initialize from server on page load. Merges server data with local data:
 * - Server has data, local empty → adopt server data
 * - Both have data → merge by source+type, prefer newer importDate
 * - Server empty, local has data → push local to server (first-device bootstrap)
 *
 * Returns true if local data was updated from server.
 */
export async function initFromServer(): Promise<boolean> {
  const serverData = await loadFromServer();
  const localImports = getAllImports();

  // Server unavailable or user not authenticated
  if (!serverData) {
    // Bootstrap: push local data to server if we have any
    if (localImports.length > 0) {
      syncToServer();
    }
    return false;
  }

  const serverImports = serverData.imports ?? [];

  // Server has data, local is empty → adopt server data
  if (localImports.length === 0 && serverImports.length > 0) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serverImports));
    _cache = serverImports;
    writeLegacyKeys(serverImports);

    if (serverData.compositeConfig) {
      localStorage.setItem(COMPOSITE_CONFIG_KEY, JSON.stringify(serverData.compositeConfig));
    }
    if (serverData.averagePosition != null) {
      localStorage.setItem(AVG_POSITION_KEY, String(serverData.averagePosition));
    }

    window.dispatchEvent(new CustomEvent('rankingsUpdated'));
    return true;
  }

  // Both have data → merge by source+type, prefer newer importDate
  if (localImports.length > 0 && serverImports.length > 0) {
    const merged = mergeImports(localImports, serverImports);
    const changed = merged.length !== localImports.length ||
      merged.some((m, i) => m.id !== localImports[i]?.id);

    if (changed) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      _cache = merged;
      writeLegacyKeys(merged);

      // Use server composite config if local doesn't have one
      if (!getCompositeConfig() && serverData.compositeConfig) {
        localStorage.setItem(COMPOSITE_CONFIG_KEY, JSON.stringify(serverData.compositeConfig));
      }

      window.dispatchEvent(new CustomEvent('rankingsUpdated'));
      syncToServer(); // Push merged result back
      return true;
    }
  }

  // Local has data but server is empty → bootstrap server
  if (localImports.length > 0 && serverImports.length === 0) {
    syncToServer();
  }

  return false;
}

/**
 * Merge two import arrays by source+type. When both have the same
 * source+type, the one with the newer importDate wins.
 */
function mergeImports(
  localImports: StoredRankingImport[],
  serverImports: StoredRankingImport[],
): StoredRankingImport[] {
  const byKey = new Map<string, StoredRankingImport>();

  // Start with local imports
  for (const imp of localImports) {
    byKey.set(`${imp.source}:${imp.type}`, imp);
  }

  // Overlay server imports — newer wins
  for (const imp of serverImports) {
    const key = `${imp.source}:${imp.type}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, imp);
    } else {
      const existingDate = new Date(existing.importDate).getTime();
      const serverDate = new Date(imp.importDate).getTime();
      if (serverDate > existingDate) {
        byKey.set(key, imp);
      }
    }
  }

  return Array.from(byKey.values());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
