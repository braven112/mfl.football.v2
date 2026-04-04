/**
 * Draft Queue Storage
 *
 * localStorage CRUD for the personal pre-draft pick queue.
 * Follows the same pattern as rankings-storage.ts:
 * - In-memory cache for fast repeated reads
 * - Cross-tab sync via storage event + custom event
 * - Fire-and-forget server sync via /api/draft/queue
 */

import type { DraftQueueItem } from '../types/draft-room';

function storageKey(leagueId: string, year: number): string {
  return `draft.queue.${leagueId}.${year}`;
}

// In-memory cache per league+year — avoids repeated localStorage.getItem + JSON.parse
const _cache = new Map<string, DraftQueueItem[]>();

function readFromStorage(key: string): DraftQueueItem[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeToStorage(key: string, items: DraftQueueItem[]): void {
  localStorage.setItem(key, JSON.stringify(items));
  _cache.set(key, items);
  window.dispatchEvent(new CustomEvent('draftQueueUpdated', { detail: { key } }));
}

// Invalidate cache when another tab writes
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key?.startsWith('draft.queue.')) {
      _cache.delete(e.key);
    }
  });
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function getQueue(leagueId: string, year: number): DraftQueueItem[] {
  const key = storageKey(leagueId, year);
  if (_cache.has(key)) return _cache.get(key)!;
  const items = readFromStorage(key);
  _cache.set(key, items);
  return items;
}

export function saveQueue(leagueId: string, year: number, items: DraftQueueItem[]): void {
  const key = storageKey(leagueId, year);
  writeToStorage(key, items);
}

export function addToQueue(leagueId: string, year: number, playerId: string): DraftQueueItem[] {
  const items = [...getQueue(leagueId, year)];
  // Prevent duplicates
  if (items.some((i) => i.playerId === playerId)) return items;
  const newItem: DraftQueueItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    playerId,
    addedAt: Date.now(),
  };
  const updated = [...items, newItem];
  saveQueue(leagueId, year, updated);
  return updated;
}

export function removeFromQueue(leagueId: string, year: number, id: string): DraftQueueItem[] {
  const updated = getQueue(leagueId, year).filter((i) => i.id !== id);
  saveQueue(leagueId, year, updated);
  return updated;
}

export function reorderQueue(
  leagueId: string,
  year: number,
  oldIndex: number,
  newIndex: number
): DraftQueueItem[] {
  const items = [...getQueue(leagueId, year)];
  if (oldIndex < 0 || newIndex < 0 || oldIndex >= items.length || newIndex >= items.length) {
    return items;
  }
  const [moved] = items.splice(oldIndex, 1);
  items.splice(newIndex, 0, moved);
  saveQueue(leagueId, year, items);
  return items;
}

/** Remove all queue items whose playerId appears in the set of drafted IDs. */
export function purgeDraftedPlayers(
  leagueId: string,
  year: number,
  draftedPlayerIds: Set<string>
): DraftQueueItem[] {
  const filtered = getQueue(leagueId, year).filter((i) => !draftedPlayerIds.has(i.playerId));
  const current = getQueue(leagueId, year);
  if (filtered.length !== current.length) {
    saveQueue(leagueId, year, filtered);
  }
  return filtered;
}
