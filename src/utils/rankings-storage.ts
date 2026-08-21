/**
 * Rankings Storage
 *
 * localStorage CRUD for imported rankings with Redis sync for cross-device
 * access. localStorage is the instant layer; Redis (via /api/ri) is the
 * durable layer that lets rankings follow you across devices.
 *
 * Also handles migration from the legacy auctionPredictor.* localStorage keys.
 */

import type {
  StoredRankingImport,
  CompositeRankConfig,
  SyncedRankingsPayload,
  BuiltinRankingSource,
  CompositeImportConfig,
} from '../types/rankings-import';
import { loadFromServer, saveToServer } from './rankings-sync';
import {
  DEFAULT_RANKINGS_SCOPE,
  activeRankingsScope,
  scopedLocalKey,
  type RankingsScope,
} from './rankings-scope';

// ---------------------------------------------------------------------------
// Keys are per-league (see rankings-scope.ts) and therefore functions, not
// constants: a single module instance outlives a ClientRouter navigation from
// one league's page to another's, so the scope has to be re-read per call.
// TheLeague's scope returns these base strings unchanged.
// ---------------------------------------------------------------------------

const STORAGE_BASE_KEY = 'rankings.imports';
const AVG_POSITION_BASE_KEY = 'rankings.averagePosition';
const COMPOSITE_CONFIG_BASE_KEY = 'rankings.compositeConfig';
const HIDDEN_BUILTINS_BASE_KEY = 'rankings.hiddenBuiltins';

const storageKey = (scope = activeRankingsScope()) => scopedLocalKey(STORAGE_BASE_KEY, scope);
const avgPositionKey = (scope = activeRankingsScope()) => scopedLocalKey(AVG_POSITION_BASE_KEY, scope);
const compositeConfigKey = (scope = activeRankingsScope()) => scopedLocalKey(COMPOSITE_CONFIG_BASE_KEY, scope);
const hiddenBuiltinsKey = (scope = activeRankingsScope()) => scopedLocalKey(HIDDEN_BUILTINS_BASE_KEY, scope);

// Legacy keys from the old auction predictor rankings import.
// TheLeague-only: they predate multi-league by years and only TheLeague's
// auction predictor ever read them, so they are NOT scoped.
const LEGACY_KEYS = [
  'auctionPredictor.dlfRankings',
  'auctionPredictor.footballguysRankings',
  'auctionPredictor.dynastyRankings',
  'auctionPredictor.redraftRankings',
];

// ---------------------------------------------------------------------------
// In-memory cache — avoids repeated localStorage.getItem + JSON.parse.
// Keyed BY SCOPE: one map entry per league, so crossing leagues in a single
// page session can't serve TheLeague's imports on an AFL page.
// Invalidated on every write (saveImport, deleteImport, migrateFromLegacyKeys).
// ---------------------------------------------------------------------------

const _cache = new Map<RankingsScope, StoredRankingImport[]>();

function readFromStorage(scope: RankingsScope): StoredRankingImport[] {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeToStorage(imports: StoredRankingImport[]): void {
  const scope = activeRankingsScope();
  localStorage.setItem(storageKey(scope), JSON.stringify(imports));
  _cache.set(scope, imports);
  writeLegacyKeys(imports);
  window.dispatchEvent(new CustomEvent('rankingsUpdated'));
  syncToServer();
}

/** Exported for tests — clears the in-memory cache. */
export function _clearCache(): void {
  _cache.clear();
}

// Invalidate cache when another tab writes to localStorage. The tab could be
// on a different league, so match any scope's key rather than just this one's.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e: StorageEvent) => {
    if (!e.key) return;
    if (e.key === STORAGE_BASE_KEY || e.key.startsWith(`${STORAGE_BASE_KEY}.`)) {
      _cache.clear();
    }
    if (
      e.key === COMPOSITE_CONFIG_BASE_KEY ||
      e.key.startsWith(`${COMPOSITE_CONFIG_BASE_KEY}.`)
    ) {
      window.dispatchEvent(new CustomEvent('rankingsUpdated'));
    }
  });
}

// ---------------------------------------------------------------------------
// Built-in sources
// ---------------------------------------------------------------------------
/**
 * Built-in sources the owner has hidden.
 *
 * A provided source can't be deleted — the next snapshot would just bring it
 * back — but "I built my own board out of FBG and DLF and don't want the
 * defaults in my way" is a real need, so hiding is the durable opt-out.
 * Hiding also drops the source from the composite; showing it again does NOT
 * silently re-add it, because by then the owner has a weighting they chose.
 */
export function getHiddenBuiltins(): string[] {
  try {
    const raw = localStorage.getItem(hiddenBuiltinsKey());
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function setBuiltinHidden(importId: string, hidden: boolean): void {
  const current = new Set(getHiddenBuiltins());
  if (hidden) current.add(importId);
  else current.delete(importId);
  localStorage.setItem(hiddenBuiltinsKey(), JSON.stringify([...current]));

  // Hiding removes it from the composite too — leaving a hidden source
  // silently weighting "My Rank" is exactly the confusion this avoids.
  if (hidden) {
    try {
      const raw = localStorage.getItem(compositeConfigKey());
      if (raw) {
        const config = JSON.parse(raw) as CompositeRankConfig;
        const filtered = config.members.filter((m) => m.importId !== importId);
        if (filtered.length !== config.members.length) {
          localStorage.setItem(compositeConfigKey(), JSON.stringify({ members: filtered }));
        }
      }
    } catch { /* ignore malformed config */ }
  }

  _cache.clear();
  window.dispatchEvent(new CustomEvent('rankingsUpdated'));
}


/**
 * Reconcile the build-time ranking snapshot into this league's store.
 *
 * The built-in sources live in the SAME array as a user's own imports, so
 * every existing consumer — the composite, the Free Agents columns, the draft
 * queue, the Custom Rankings seed — reads one list and needed no changes.
 * They are marked `provided` so the UI can refuse to delete them.
 *
 * Three rules that matter:
 *
 * - **Refresh in place.** A provided import is replaced when the snapshot's
 *   `generatedAt` moves, keyed on source+type, so the daily cron's new numbers
 *   land without duplicating a row or disturbing the user's own imports.
 * - **On by default, once.** A newly-seeded source is added to the composite
 *   config the first time it appears. After that the user's tick state is
 *   authoritative — re-adding it on every refresh would silently undo an
 *   owner who deliberately unticked it.
 * - **No write when nothing changed.** This runs on every page load; an
 *   unconditional write would fire `rankingsUpdated` and push to the server
 *   on every visit.
 */
export function syncBuiltinImports(
  snapshot: { generatedAt?: string; sources?: BuiltinRankingSource[] } | null,
  /**
   * Source ids ticked into "My Rank" on first sight, from the league registry
   * (`defaultRankingSources`). EVERY source is stored and selectable; this only
   * decides the opening composite, because dynasty trade values are the wrong
   * default for a league that re-drafts and redraft ADP is the wrong default
   * for a contract dynasty league. Omitted → nothing auto-ticks.
   */
  defaultSourceIds: string[] = [],
): boolean {
  if (!snapshot?.sources?.length) return false;

  const generatedAt = snapshot.generatedAt ?? '';
  // Read the RAW store, not getAllImports() — that view hides the built-ins
  // the owner hid, and reconciling against it would treat every hidden source
  // as missing: re-seeded on every load, and re-added to the composite because
  // `seenBefore` wouldn't contain it. Hiding is a read-time filter precisely
  // so this stays a pure function of the snapshot.
  const scope = activeRankingsScope();
  const existing = readFromStorage(scope);
  const userImports = existing.filter((i) => !i.provided);
  const priorProvided = existing.filter((i) => i.provided);

  // Nothing to do if we already hold this exact snapshot.
  const upToDate =
    priorProvided.length === snapshot.sources.length &&
    priorProvided.every((i) => i.generatedAt === generatedAt);
  if (upToDate) return false;

  const seenBefore = new Set(priorProvided.map((i) => `${i.source}:${i.type}`));

  const provided: StoredRankingImport[] = snapshot.sources.map((src) => ({
    // Stable id per source+type so composite membership survives a refresh.
    id: `builtin:${src.id}`,
    source: src.id as StoredRankingImport['source'],
    type: src.type as StoredRankingImport['type'],
    importDate: generatedAt || new Date().toISOString(),
    generatedAt,
    provided: true,
    rankings: src.players.map((p) => ({
      rank: p.rank,
      playerId: p.id,
      playerName: '',
      position: '',
      team: '',
      // Every built-in source is resolved to an MFL id at build time — by id
      // for the MFL feeds and FantasyCalc, by name once for Sleeper and ESPN.
      matched: true,
      confidence: 1,
    })),
    stats: {
      total: src.players.length,
      matched: src.players.length,
      unmatched: 0,
      matchRate: 100,
    },
  }));

  // Provided sources sort ahead of the user's own imports.
  const next = [...provided, ...userImports];
  localStorage.setItem(storageKey(scope), JSON.stringify(next));
  // Invalidate rather than set: the cached value must go back through
  // getAllImports()'s hidden-source filter.
  _cache.delete(scope);

  // Newly-seeded sources join the composite IF this league defaults them on;
  // previously-seen ones keep whatever the owner set.
  const defaults = new Set(defaultSourceIds);
  const fresh = provided.filter(
    (i) => !seenBefore.has(`${i.source}:${i.type}`) && defaults.has(i.source),
  );
  if (fresh.length > 0) {
    const raw = localStorage.getItem(compositeConfigKey());
    const config: CompositeRankConfig = raw ? JSON.parse(raw) : { members: [] };
    for (const imp of fresh) {
      if (!config.members.find((m) => m.importId === imp.id)) {
        config.members.push({ importId: imp.id, weight: 0 });
      }
    }
    // Seeded defaults start as an even split summing to 100, so the very first
    // board an owner sees already reads as percentages.
    localStorage.setItem(
      compositeConfigKey(),
      JSON.stringify({ members: rebalanceToHundred(config.members) }),
    );
  }

  window.dispatchEvent(new CustomEvent('rankingsUpdated'));
  return true;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function getAllImports(): StoredRankingImport[] {
  const scope = activeRankingsScope();
  const cached = _cache.get(scope);
  if (cached !== undefined) return cached;
  // Hidden built-ins are filtered on READ rather than dropped on write, so
  // un-hiding is instant and the snapshot reconciliation stays a pure
  // function of the build data.
  const hidden = new Set(getHiddenBuiltins());
  const fresh = readFromStorage(scope).filter(
    (i) => !(i.provided && hidden.has(i.id)),
  );
  _cache.set(scope, fresh);
  return fresh;
}

/** Built-in sources present in the snapshot but hidden by the owner. */
export function getHiddenBuiltinImports(): StoredRankingImport[] {
  const hidden = new Set(getHiddenBuiltins());
  if (hidden.size === 0) return [];
  return readFromStorage(activeRankingsScope()).filter(
    (i) => i.provided && hidden.has(i.id),
  );
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
        const raw = localStorage.getItem(compositeConfigKey());
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
            localStorage.setItem(compositeConfigKey(), JSON.stringify(config));
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
  // A provided source is refreshed from the build snapshot, so deleting it
  // would just resurrect it on the next load. Unticking "My Rank" is the
  // opt-out. Guarded here as well as in the UI so a stray call can't put the
  // store into a state that fights the next sync.
  const target = getAllImports().find((i) => i.id === id);
  if (target?.provided) return;

  const imports = getAllImports().filter((i) => i.id !== id);
  writeToStorage(imports);

  // Remove from composite config if present
  try {
    const raw = localStorage.getItem(compositeConfigKey());
    if (raw) {
      const config = JSON.parse(raw) as CompositeRankConfig;
      const filtered = config.members.filter((m) => m.importId !== id);
      if (filtered.length !== config.members.length) {
        localStorage.setItem(compositeConfigKey(), JSON.stringify({ members: filtered }));
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
    localStorage.setItem(avgPositionKey(), String(averageIndex));
  }
}

/**
 * Get the stored position index for the average rank column.
 * Returns 0 (first) if no position has been explicitly set.
 */
export function getAveragePosition(): number {
  try {
    const raw = localStorage.getItem(avgPositionKey());
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
    const raw = localStorage.getItem(compositeConfigKey());
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
  localStorage.setItem(compositeConfigKey(), JSON.stringify(config));
  window.dispatchEvent(new CustomEvent('rankingsUpdated'));
  syncToServer();
}

/**
 * Rebalance member weights so they sum to 100.
 *
 * Weights are PERCENTAGES to the owner, so the number typed has to be the
 * share the source actually gets. The composite normalizes by total weight, so
 * without this "5" against three sources at 1 each is really 62.5% — the exact
 * opposite of the "5% superflex" the input implies.
 *
 * `pinned` keeps one member at the value just typed and distributes the
 * remainder across the others in proportion to what they already had, so
 * adjusting one source doesn't silently flatten the balance between the rest.
 */
function rebalanceToHundred(
  members: CompositeImportConfig[],
  pinnedId?: string,
): CompositeImportConfig[] {
  if (members.length === 0) return members;
  if (members.length === 1) return [{ ...members[0], weight: 100 }];

  const pinned = pinnedId ? members.find((m) => m.importId === pinnedId) : undefined;
  const others = members.filter((m) => m !== pinned);

  const pinnedWeight = pinned ? Math.min(100, Math.max(0, pinned.weight)) : 0;
  const remaining = 100 - pinnedWeight;
  const othersTotal = others.reduce((sum, m) => sum + (m.weight > 0 ? m.weight : 0), 0);

  const scaled = others.map((m) => ({
    ...m,
    // No prior signal (all zero) → split the remainder evenly.
    weight: othersTotal > 0 ? (m.weight / othersTotal) * remaining : remaining / others.length,
  }));

  const out = members.map((m) =>
    m === pinned ? { ...m, weight: pinnedWeight } : scaled.find((s) => s.importId === m.importId)!,
  );

  // Round to one decimal, then put any rounding drift on the largest
  // non-pinned member so the displayed numbers still add to exactly 100.
  const rounded = out.map((m) => ({ ...m, weight: Math.round(m.weight * 10) / 10 }));
  const drift = Math.round((100 - rounded.reduce((s, m) => s + m.weight, 0)) * 10) / 10;
  if (drift !== 0) {
    const target = rounded
      .filter((m) => m.importId !== pinnedId)
      .sort((a, b) => b.weight - a.weight)[0];
    if (target) target.weight = Math.round((target.weight + drift) * 10) / 10;
  }
  return rounded;
}

/**
 * Toggle a specific import's inclusion in the composite.
 *
 * Adding or removing a source rebalances every member back to a total of 100,
 * so the percentages stay meaningful without the owner having to fix them up.
 */
export function toggleCompositeImport(importId: string, included: boolean): void {
  const raw = localStorage.getItem(compositeConfigKey());
  const current: CompositeRankConfig = raw ? JSON.parse(raw) : { members: [] };

  if (included) {
    if (!current.members.find((m) => m.importId === importId)) {
      current.members.push({ importId, weight: 0 });
    }
  } else {
    current.members = current.members.filter((m) => m.importId !== importId);
  }

  // A source just ticked ON gets an even share (100/n) and the others absorb
  // the remainder proportionally. Rebalancing it as a plain zero-weight member
  // would leave it at 0% — nominally in the composite, actually ignored.
  const members = included
    ? rebalanceToHundred(
        current.members.map((m) =>
          m.importId === importId ? { ...m, weight: 100 / current.members.length } : m,
        ),
        importId,
      )
    : rebalanceToHundred(current.members);

  saveCompositeConfig({ members });
}

/**
 * Update the weight for a composite member.
 */
export const MIN_COMPOSITE_WEIGHT = 0;
export const MAX_COMPOSITE_WEIGHT = 100;

/**
 * Set a source's share of the composite. See CompositeRankMember.weight —
 * the value is a percentage by convention, normalized by the composite math.
 *
 * A non-finite or negative weight is rejected rather than stored: it would
 * poison `weightedSum / totalWeight` for every player at once, and a NaN there
 * silently empties the whole board.
 */
export function setCompositeWeight(importId: string, weight: number): void {
  if (!Number.isFinite(weight) || weight < MIN_COMPOSITE_WEIGHT) return;
  const clamped = Math.min(MAX_COMPOSITE_WEIGHT, weight);
  const raw = localStorage.getItem(compositeConfigKey());
  const current: CompositeRankConfig = raw ? JSON.parse(raw) : { members: [] };
  const member = current.members.find((m) => m.importId === importId);
  if (!member) return;

  member.weight = clamped;
  // Pin what was just typed and absorb the difference into the other sources,
  // so the typed number IS the share this source gets.
  saveCompositeConfig({ members: rebalanceToHundred(current.members, importId) });
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
  // The auctionPredictor.* keys are TheLeague's alone (see LEGACY_KEYS) —
  // migrating them into another league's bucket would import one league's
  // opinions as if they were the other's, and then DELETE the originals.
  if (activeRankingsScope() !== DEFAULT_RANKINGS_SCOPE) return;

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
    localStorage.setItem(storageKey(), JSON.stringify(existing));
    _cache.set(activeRankingsScope(), existing);
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
  // TheLeague only — these keys are unscoped, so writing them from another
  // league's page would overwrite TheLeague's auction-predictor rankings with
  // a different league's board.
  if (activeRankingsScope() !== DEFAULT_RANKINGS_SCOPE) return;

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
  // Provided sources are NOT synced: they are regenerated from the build
  // snapshot on every device, so pushing them would store ~150 KB of
  // identical, immediately-stale data per owner and let an old device's copy
  // overwrite a fresh one on merge. Only the user's own imports are durable.
  const imports = getAllImports().filter((i) => !i.provided);
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
  // Compare against the user's OWN imports — provided sources never round-trip
  // through the server, so counting them here would make a first-time owner
  // look like they already had data and skip the server adopt path.
  const localImports = getAllImports().filter((i) => !i.provided);

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
    const withProvided = [...getAllImports().filter((i) => i.provided), ...serverImports];
    localStorage.setItem(storageKey(), JSON.stringify(withProvided));
    _cache.set(activeRankingsScope(), withProvided);
    writeLegacyKeys(serverImports);

    if (serverData.compositeConfig) {
      localStorage.setItem(compositeConfigKey(), JSON.stringify(serverData.compositeConfig));
    }
    if (serverData.averagePosition != null) {
      localStorage.setItem(avgPositionKey(), String(serverData.averagePosition));
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
      const mergedWithProvided = [
        ...getAllImports().filter((i) => i.provided),
        ...merged,
      ];
      localStorage.setItem(storageKey(), JSON.stringify(mergedWithProvided));
      _cache.set(activeRankingsScope(), mergedWithProvided);
      writeLegacyKeys(merged);

      // Use server composite config if local doesn't have one
      if (!getCompositeConfig() && serverData.compositeConfig) {
        localStorage.setItem(compositeConfigKey(), JSON.stringify(serverData.compositeConfig));
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
