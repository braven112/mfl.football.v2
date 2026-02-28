/**
 * Custom Rankings Storage
 *
 * Client-side wrapper for loading/saving custom rankings.
 * Reads from and writes to the /api/cr endpoint (Vercel KV on server).
 * Also caches in localStorage for instant loads on return visits.
 */

import type { CustomRankingsState } from '../types/custom-rankings';

const LOCAL_CACHE_KEY = 'cr.localCache';

/**
 * Load custom rankings from the server API.
 * Falls back to localStorage cache if the API call fails.
 */
export async function loadCustomRankings(): Promise<CustomRankingsState | null> {
  try {
    const response = await fetch('/api/cr');
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    const { data } = await response.json();
    if (data) {
      // Update local cache
      try {
        localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(data));
      } catch { /* localStorage full or unavailable */ }
    }
    return data ?? null;
  } catch {
    // Fall back to localStorage cache
    return loadFromLocalCache();
  }
}

/**
 * Save custom rankings to the server API.
 * Also updates the localStorage cache.
 */
export async function saveCustomRankings(
  state: CustomRankingsState,
): Promise<boolean> {
  // Update local cache immediately
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(state));
  } catch { /* localStorage full or unavailable */ }

  try {
    const response = await fetch('/api/cr', {
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
function loadFromLocalCache(): CustomRankingsState | null {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CustomRankingsState;
  } catch {
    return null;
  }
}
