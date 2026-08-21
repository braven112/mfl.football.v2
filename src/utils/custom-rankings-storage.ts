/**
 * Custom Rankings Storage
 *
 * Client-side wrapper for loading/saving custom rankings.
 * Reads from and writes to the /api/cr endpoint (Vercel KV on server).
 * Also caches in localStorage for instant loads on return visits.
 */

import type { CustomRankingsState } from '../types/custom-rankings';
import { activeRankingsScope, scopedLocalKey } from './rankings-scope';

const LOCAL_CACHE_BASE_KEY = 'cr.localCache';

const localCacheKey = (scope = activeRankingsScope()) =>
  scopedLocalKey(LOCAL_CACHE_BASE_KEY, scope);

/** See rankings-sync.ts#apiUrl — the scope travels so the server can reject a
 *  cross-league session rather than writing one league's board into another. */
const apiUrl = (scope = activeRankingsScope()) =>
  `/api/cr?league=${encodeURIComponent(scope)}`;

/**
 * Load custom rankings from the server API.
 * Falls back to localStorage cache if the API call fails.
 */
export async function loadCustomRankings(): Promise<CustomRankingsState | null> {
  // One scope for the request, the cache write and the fallback — re-reading
  // it after the await lets a mid-flight ClientRouter navigation cache one
  // league's board under the other league's key. See rankings-sync.ts.
  const scope = activeRankingsScope();
  try {
    const response = await fetch(apiUrl(scope));
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    const { data } = await response.json();
    if (data) {
      // Update local cache
      try {
        localStorage.setItem(localCacheKey(scope), JSON.stringify(data));
      } catch { /* localStorage full or unavailable */ }
    }
    return data ?? null;
  } catch {
    // Fall back to localStorage cache
    return loadFromLocalCache(scope);
  }
}

/**
 * Save custom rankings to the server API.
 * Also updates the localStorage cache.
 */
export async function saveCustomRankings(
  state: CustomRankingsState,
): Promise<boolean> {
  const scope = activeRankingsScope();
  // Update local cache immediately
  try {
    localStorage.setItem(localCacheKey(scope), JSON.stringify(state));
  } catch { /* localStorage full or unavailable */ }

  try {
    const response = await fetch(apiUrl(scope), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Load from localStorage cache (fast fallback).
 */
function loadFromLocalCache(scope = activeRankingsScope()): CustomRankingsState | null {
  try {
    const raw = localStorage.getItem(localCacheKey(scope));
    if (!raw) return null;
    return JSON.parse(raw) as CustomRankingsState;
  } catch {
    return null;
  }
}
