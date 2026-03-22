/**
 * Rankings Sync
 *
 * Client-side wrapper for syncing import rankings to/from the server.
 * Reads from and writes to the /api/ri endpoint (Vercel KV on server).
 * Also caches in localStorage for instant loads on return visits.
 */

import type { SyncedRankingsPayload } from '../types/rankings-import';

const LOCAL_CACHE_KEY = 'ri.localCache';

/**
 * Load synced rankings from the server API.
 * Falls back to localStorage cache if the API call fails.
 * Returns null if user is unauthenticated or no data exists.
 */
export async function loadFromServer(): Promise<SyncedRankingsPayload | null> {
  try {
    const response = await fetch('/api/ri');
    if (response.status === 401) return null; // Not logged in
    if (!response.ok) throw new Error(`API returned ${response.status}`);

    const { data } = await response.json();
    if (data) {
      try {
        localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(data));
      } catch { /* localStorage full or unavailable */ }
    }
    return data ?? null;
  } catch {
    return getLocalCache();
  }
}

/**
 * Save rankings state to the server API.
 * Updates localStorage cache immediately (optimistic), then POSTs to server.
 * Fire-and-forget — returns immediately after localStorage write.
 */
export function saveToServer(payload: SyncedRankingsPayload): void {
  // Update local cache immediately
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(payload));
  } catch { /* localStorage full or unavailable */ }

  // POST to server in background — don't block the UI
  fetch('/api/ri', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {
    // Silent failure — data is safe in localStorage, will sync next time
  });
}

/**
 * Load from localStorage cache (fast fallback for offline/unauthenticated).
 */
export function getLocalCache(): SyncedRankingsPayload | null {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SyncedRankingsPayload;
  } catch {
    return null;
  }
}
