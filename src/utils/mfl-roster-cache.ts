/**
 * MFL Roster Cache — Cache-with-TTL via Upstash Redis
 *
 * Serves roster data from Redis cache when fresh (< 2 min old).
 * When stale or missing, fetches live data from MFL API synchronously
 * and updates the cache before returning.
 *
 * NOTE: Fire-and-forget background refreshes don't work on Vercel serverless
 * because the runtime terminates the function after the response is sent.
 * All refreshes are therefore awaited inline.
 *
 * Redis key: mfl:rosters:{leagueId}:{season}
 * TTL: 2 minutes before a synchronous refresh is triggered
 * Fallback: returns null when Redis is unavailable (caller uses static files)
 */

const STALE_TTL_MS = 2 * 60 * 1000; // 2 minutes

type RedisClient = {
  get: <T>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown, opts?: { ex?: number }) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
};

let loggedMissingRedis = false;

async function getRedis(): Promise<RedisClient | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;

  try {
    const { Redis } = await import('@upstash/redis');
    return new Redis({ url, token });
  } catch (error) {
    if (!loggedMissingRedis) {
      loggedMissingRedis = true;
      console.warn('[mfl-roster-cache] @upstash/redis unavailable:', error);
    }
    return null;
  }
}

function cacheKey(leagueId: string, season: string): string {
  return `mfl:rosters:${leagueId}:${season}`;
}

export interface CachedRosterEntry {
  franchiseId: string;
  salary: string;
  contractYear: string;
  contractInfo: string;
  status: string;
}

interface CachedRosterPayload {
  /** Player ID → roster data */
  players: Record<string, CachedRosterEntry>;
  /** When this data was fetched from MFL (epoch ms) */
  fetchedAt: number;
}

/** In-memory flag to prevent duplicate concurrent fetches within the same process */
const refreshing = new Map<string, Promise<Record<string, CachedRosterEntry> | null>>();

/**
 * Get roster data from Redis cache.
 * Returns the player map if cached and fresh, otherwise fetches from MFL
 * synchronously and updates the cache before returning.
 */
export async function getCachedRosters(
  season: string,
  leagueId: string
): Promise<Record<string, CachedRosterEntry> | null> {
  const redis = await getRedis();
  if (!redis) return null;

  try {
    const key = cacheKey(leagueId, season);
    const cached = await redis.get<CachedRosterPayload>(key);

    if (!cached?.players) {
      // Cache miss — fetch synchronously so this request gets live data
      console.log(`[mfl-roster-cache] Cache miss for ${key}, fetching synchronously`);
      return await deduplicatedFetch(season, leagueId);
    }

    // Check staleness
    const age = Date.now() - cached.fetchedAt;
    if (age > STALE_TTL_MS) {
      console.log(`[mfl-roster-cache] Stale data for ${key} (age: ${Math.round(age / 1000)}s), refreshing synchronously`);
      // Fetch fresh data synchronously — awaiting ensures the refresh completes
      // before the serverless function terminates
      const fresh = await deduplicatedFetch(season, leagueId);
      return fresh ?? cached.players; // Fall back to stale data if refresh fails
    }

    return cached.players;
  } catch (error) {
    console.warn('[mfl-roster-cache] Redis read failed:', error);
    return null;
  }
}

/**
 * Deduplicate concurrent fetches within the same process.
 * If a fetch for the same key is already in-flight, piggyback on it.
 */
async function deduplicatedFetch(
  season: string,
  leagueId: string
): Promise<Record<string, CachedRosterEntry> | null> {
  const key = cacheKey(leagueId, season);

  const existing = refreshing.get(key);
  if (existing) return existing;

  const promise = fetchAndCacheRosters(season, leagueId)
    .then((players) => players)
    .catch((err) => {
      console.warn('[mfl-roster-cache] Fetch failed:', err);
      return null;
    })
    .finally(() => refreshing.delete(key));

  refreshing.set(key, promise);
  return promise;
}

/**
 * Invalidate the roster cache and immediately fetch fresh data from MFL.
 * Call this after a contract write to MFL so the roster page reflects changes.
 */
export async function invalidateRosterCache(season: string, leagueId: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  const key = cacheKey(leagueId, season);
  console.log(`[mfl-roster-cache] Invalidating cache: ${key}`);

  // Delete the stale cache, then immediately re-fetch from MFL
  await redis.del(key);

  // Fetch fresh data right now (not in background — we want it ready for the next page load)
  await fetchAndCacheRosters(season, leagueId);
}

async function fetchAndCacheRosters(
  season: string,
  leagueId: string
): Promise<Record<string, CachedRosterEntry>> {
  const url = `https://api.myfantasyleague.com/${season}/export?TYPE=rosters&L=${leagueId}&JSON=1`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'MFLFootball/2.0' },
  });

  if (!response.ok) {
    throw new Error(`MFL rosters API returned ${response.status}`);
  }

  const data = await response.json();
  const franchises = data?.rosters?.franchise;
  if (!Array.isArray(franchises)) {
    throw new Error('Unexpected MFL rosters response shape');
  }

  // Build the same player map structure used by rosters.astro
  const players: Record<string, CachedRosterEntry> = {};
  for (const franchise of franchises) {
    const franchiseId = franchise.id;
    if (!franchiseId) continue;
    const rosterPlayers = Array.isArray(franchise.player)
      ? franchise.player
      : [franchise.player].filter(Boolean);
    for (const player of rosterPlayers) {
      if (player?.id) {
        players[player.id] = {
          franchiseId,
          salary: player.salary,
          contractYear: player.contractYear,
          contractInfo: player.contractInfo ?? '',
          status: player.status,
        };
      }
    }
  }

  const redis = await getRedis();
  if (!redis) return players;

  const payload: CachedRosterPayload = { players, fetchedAt: Date.now() };
  // Store in Redis with a 1-hour hard expiry as a safety net
  await redis.set(cacheKey(leagueId, season), payload, { ex: 3600 });
  console.log(`[mfl-roster-cache] Cached ${Object.keys(players).length} players for ${leagueId}/${season}`);

  return players;
}
