/**
 * In-memory MFL data cache with TTL
 *
 * With ≤16 concurrent users, a 2-minute cache means MFL gets hit
 * at most once per 2 minutes per feed type — well under any rate limit.
 * Every request within that window gets instant cached data.
 */

interface CacheEntry<T = unknown> {
  data: T;
  fetchedAt: number;
  /** In-flight promise to deduplicate concurrent requests */
  pending?: Promise<T>;
}

const DEFAULT_TTL_MS = 2 * 60 * 1000; // 2 minutes

// Persist across hot reloads in dev via globalThis
const CACHE_KEY = '__mflDataCache';

function getCache(): Map<string, CacheEntry> {
  if (!(globalThis as any)[CACHE_KEY]) {
    (globalThis as any)[CACHE_KEY] = new Map<string, CacheEntry>();
  }
  return (globalThis as any)[CACHE_KEY];
}

/**
 * Fetch data with in-memory caching and request deduplication.
 *
 * If multiple requests hit the same key within the TTL window,
 * only one MFL fetch is made — the rest share the same promise.
 *
 * @param key   Unique cache key (e.g., "theleague/13522/2026/rosters")
 * @param fetcher  Async function that fetches the data from MFL
 * @param ttlMs    Cache TTL in milliseconds (default: 2 minutes)
 */
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const cache = getCache();
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  const now = Date.now();

  // Return cached data if fresh
  if (entry && now - entry.fetchedAt < ttlMs) {
    return entry.data;
  }

  // If there's already an in-flight request, piggyback on it
  if (entry?.pending) {
    return entry.pending;
  }

  // Create a new fetch promise
  const pending = fetcher()
    .then((data) => {
      cache.set(key, { data, fetchedAt: Date.now() });
      return data;
    })
    .catch((err) => {
      // On error, if we have stale data, return it instead of throwing
      const stale = cache.get(key) as CacheEntry<T> | undefined;
      if (stale?.data) {
        console.warn(`[mfl-cache] Fetch failed for "${key}", returning stale data:`, err.message);
        return stale.data;
      }
      // Remove the failed pending entry
      cache.delete(key);
      throw err;
    });

  // Store the pending promise (keep old data around for stale fallback)
  if (entry) {
    entry.pending = pending;
  } else {
    cache.set(key, { data: undefined as T, fetchedAt: 0, pending });
  }

  return pending;
}

/**
 * Invalidate a specific cache entry
 */
export function invalidateCache(key: string): void {
  getCache().delete(key);
}

/**
 * Invalidate all cache entries matching a prefix
 */
export function invalidateCacheByPrefix(prefix: string): void {
  const cache = getCache();
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Get cache stats (for debugging)
 */
export function getCacheStats(): { size: number; keys: string[] } {
  const cache = getCache();
  return { size: cache.size, keys: [...cache.keys()] };
}
