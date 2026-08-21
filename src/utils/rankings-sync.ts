/**
 * Rankings Sync
 *
 * Client-side wrapper for syncing import rankings to/from the server.
 * Reads from and writes to the /api/ri endpoint (Vercel KV on server).
 * Also caches in localStorage for instant loads on return visits.
 */

import type { SyncedRankingsPayload } from '../types/rankings-import';
import { activeRankingsScope, scopedLocalKey } from './rankings-scope';

const LOCAL_CACHE_BASE_KEY = 'ri.localCache';

const localCacheKey = (scope = activeRankingsScope()) =>
  scopedLocalKey(LOCAL_CACHE_BASE_KEY, scope);

/**
 * The API URL for the league whose page we're on.
 *
 * The scope travels as a query param rather than being inferred server-side
 * from the session alone, because the two can legitimately disagree: an owner
 * logged into TheLeague can browse the AFL's rankings pages, where
 * localStorage is writing the AFL bucket. Without this the server would sync
 * that AFL board into their TheLeague KV key. The server rejects a mismatch,
 * and both helpers below already degrade to local-only on a failed request —
 * which is the correct outcome for a cross-league session.
 */
const apiUrl = (scope = activeRankingsScope()) =>
  `/api/ri?league=${encodeURIComponent(scope)}`;

/**
 * Load synced rankings from the server API.
 * Falls back to localStorage cache if the API call fails.
 * Returns null if user is unauthenticated or no data exists.
 */
export async function loadFromServer(): Promise<SyncedRankingsPayload | null> {
  // Capture the scope ONCE and use it for the request, the cache write and the
  // fallback read. Re-reading it after the await is a real hazard: with the
  // ClientRouter a navigation to another league can land mid-flight, and this
  // would then cache one league's board under the other league's key.
  const scope = activeRankingsScope();
  try {
    const response = await fetch(apiUrl(scope));
    if (response.status === 401) return null; // Not logged in, or wrong league
    if (!response.ok) throw new Error(`API returned ${response.status}`);

    const { data } = await response.json();
    if (data) {
      try {
        localStorage.setItem(localCacheKey(scope), JSON.stringify(data));
      } catch { /* localStorage full or unavailable */ }
    }
    return data ?? null;
  } catch {
    return getLocalCache(scope);
  }
}

/**
 * Save rankings state to the server API.
 * Updates localStorage cache immediately (optimistic), then POSTs to server.
 * Fire-and-forget — returns immediately after localStorage write.
 */
export function saveToServer(payload: SyncedRankingsPayload): void {
  const scope = activeRankingsScope();
  // Update local cache immediately
  try {
    localStorage.setItem(localCacheKey(scope), JSON.stringify(payload));
  } catch { /* localStorage full or unavailable */ }

  // POST to server in background — don't block the UI
  fetch(apiUrl(scope), {
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
export function getLocalCache(scope = activeRankingsScope()): SyncedRankingsPayload | null {
  try {
    const raw = localStorage.getItem(localCacheKey(scope));
    if (!raw) return null;
    return JSON.parse(raw) as SyncedRankingsPayload;
  } catch {
    return null;
  }
}
