/**
 * MFL Roster Cache — Stale-While-Revalidate via Upstash Redis
 *
 * Serves roster data from Redis cache instantly, then refreshes from
 * MFL API in the background so the next request gets fresh data.
 *
 * Redis key: mfl:rosters:{leagueId}:{season}
 * TTL: 2 minutes before background refresh is triggered
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
const refreshing = new Set<string>();

/**
 * Get roster data from Redis cache.
 * Returns the player map if cached, or null on miss / Redis unavailable.
 * Triggers a background refresh if the data is stale.
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
      // Cache miss — trigger a fetch so the next request has data
      triggerBackgroundRefresh(season, leagueId);
      return null;
    }

    // Check staleness and refresh in background if needed
    const age = Date.now() - cached.fetchedAt;
    if (age > STALE_TTL_MS) {
      triggerBackgroundRefresh(season, leagueId);
    }

    return cached.players;
  } catch (error) {
    console.warn('[mfl-roster-cache] Redis read failed:', error);
    return null;
  }
}

/**
 * Fire-and-forget: fetch fresh roster data from MFL and write to Redis.
 */
function triggerBackgroundRefresh(season: string, leagueId: string): void {
  const key = cacheKey(leagueId, season);
  if (refreshing.has(key)) return;
  refreshing.add(key);

  console.log(`[mfl-roster-cache] Background refresh: ${key}`);

  fetchAndCacheRosters(season, leagueId)
    .catch((err) => console.warn('[mfl-roster-cache] Background refresh failed:', err))
    .finally(() => refreshing.delete(key));
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

async function fetchAndCacheRosters(season: string, leagueId: string): Promise<void> {
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
  if (!redis) return;

  const payload: CachedRosterPayload = { players, fetchedAt: Date.now() };
  // Store in Redis with a 1-hour hard expiry as a safety net
  await redis.set(cacheKey(leagueId, season), payload, { ex: 3600 });
  console.log(`[mfl-roster-cache] Cached ${Object.keys(players).length} players for ${leagueId}/${season}`);
}
