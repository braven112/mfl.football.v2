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

import { getRedis, type RedisClient } from './redis-client';
import { buildMflExportUrl } from './mfl-url';

const STALE_TTL_MS = 2 * 60 * 1000; // 2 minutes

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

    // Check staleness. Written as !(fresh) so a missing/corrupt fetchedAt
    // (age = NaN) triggers a refresh instead of being served as fresh until
    // the 1-hour hard expiry.
    const age = Date.now() - cached.fetchedAt;
    if (!(age <= STALE_TTL_MS)) {
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

  // Delete the stale caches (both shapes, so no consumer serves pre-write
  // data as fresh), then immediately re-fetch the player map. The bust
  // epoch stops any in-flight pre-write fetch from re-caching stale data;
  // our own re-fetch below starts after the stamp, so it caches normally.
  await redis.del(key);
  await redis.del(franchiseCacheKey(leagueId, season));
  await redis.set(bustEpochKey(leagueId, season), Date.now(), { ex: 600 });

  // Fetch fresh data right now (not in background — we want it ready for the next page load)
  await fetchAndCacheRosters(season, leagueId);
}

// ── Franchise-shaped variant ────────────────────────────────────────────────
//
// The player-keyed map above collapses each player to a single franchiseId,
// which is wrong for duplicate-player leagues (AFL's 24-franchise two-
// conference format rosters the same player on two teams at once — one copy
// would silently overwrite the other). These functions cache the raw
// franchise → players[] array in the same shape as the rosters.json feed, so
// pages that render per-franchise rosters can swap the feed for live data.
//
// Redis key: mfl:rosters-franchise:{leagueId}:{season}. Same freshness model
// as above: data older than 2 min triggers a BLOCKING inline re-fetch (not
// true stale-while-revalidate — Vercel kills background work post-response),
// with a 1-hour hard expiry as the safety net.

export interface CachedFranchiseRoster {
  id: string;
  player: Array<{ id: string; status: string; salary?: string; contractYear?: string }>;
}

interface CachedFranchisePayload {
  franchises: CachedFranchiseRoster[];
  fetchedAt: number;
}

function franchiseCacheKey(leagueId: string, season: string): string {
  return `mfl:rosters-franchise:${leagueId}:${season}`;
}

const refreshingFranchise = new Map<string, Promise<CachedFranchiseRoster[] | null>>();

/**
 * Get the franchise-shaped roster list from Redis cache (fresh < 2 min),
 * refreshing synchronously from MFL when stale or missing.
 * Returns null when Redis is unavailable (caller falls back to static feed).
 */
export async function getCachedRosterFranchises(
  season: string,
  leagueId: string
): Promise<CachedFranchiseRoster[] | null> {
  const redis = await getRedis();
  if (!redis) return null;

  try {
    const key = franchiseCacheKey(leagueId, season);
    const cached = await redis.get<CachedFranchisePayload>(key);

    if (!cached?.franchises) {
      console.log(`[mfl-roster-cache] Cache miss for ${key}, fetching synchronously`);
      return await deduplicatedFranchiseFetch(season, leagueId);
    }

    // !(fresh) so a missing/corrupt fetchedAt (NaN age) refreshes too.
    const age = Date.now() - cached.fetchedAt;
    if (!(age <= STALE_TTL_MS)) {
      console.log(`[mfl-roster-cache] Stale data for ${key} (age: ${Math.round(age / 1000)}s), refreshing synchronously`);
      const fresh = await deduplicatedFranchiseFetch(season, leagueId);
      return fresh ?? cached.franchises;
    }

    return cached.franchises;
  } catch (error) {
    console.warn('[mfl-roster-cache] Redis read failed:', error);
    return null;
  }
}

async function deduplicatedFranchiseFetch(
  season: string,
  leagueId: string
): Promise<CachedFranchiseRoster[] | null> {
  const key = franchiseCacheKey(leagueId, season);

  const existing = refreshingFranchise.get(key);
  if (existing) return existing;

  const promise = fetchAndCacheFranchiseRosters(season, leagueId)
    .then((franchises) => franchises)
    .catch((err) => {
      console.warn('[mfl-roster-cache] Franchise fetch failed:', err);
      return null;
    })
    .finally(() => refreshingFranchise.delete(key));

  refreshingFranchise.set(key, promise);
  return promise;
}

/**
 * Epoch key recording when the roster caches were last busted by a write.
 * Cache fills started BEFORE this moment are discarded rather than written —
 * otherwise a page load that began fetching pre-write rosters could land its
 * Redis set after the bust and re-poison the cache with pre-write data
 * stamped as fresh.
 */
function bustEpochKey(leagueId: string, season: string): string {
  return `mfl:rosters-busted:${leagueId}:${season}`;
}

// Known residual races: the GET here and the caller's subsequent SET are not
// atomic, and the two timestamps come from different instances' wall clocks.
// Both windows are ~one RTT and any bad write self-heals within STALE_TTL_MS
// (2 min) — accepted rather than paying for a Lua/INCR epoch scheme.
async function wasBustedSince(redis: RedisClient, leagueId: string, season: string, fetchStartedAt: number): Promise<boolean> {
  try {
    const bustedAt = await redis.get<number>(bustEpochKey(leagueId, season));
    return typeof bustedAt === 'number' && bustedAt > fetchStartedAt;
  } catch {
    return false;
  }
}

/**
 * Delete both roster cache keys WITHOUT re-fetching. Cheap enough to call
 * once per write in a burst (e.g. keeper finalize fires 10 sequential cuts);
 * the next page load repopulates via the cache-miss path. Use
 * invalidateRosterCache when you want the player-map pre-warmed instead.
 */
export async function bustRosterCaches(season: string, leagueId: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  await Promise.allSettled([
    redis.del(cacheKey(leagueId, season)),
    redis.del(franchiseCacheKey(leagueId, season)),
    redis.set(bustEpochKey(leagueId, season), Date.now(), { ex: 600 }),
  ]);
}

async function fetchAndCacheFranchiseRosters(
  season: string,
  leagueId: string
): Promise<CachedFranchiseRoster[]> {
  const fetchStartedAt = Date.now();
  const url = `https://api.myfantasyleague.com/${season}/export?TYPE=rosters&L=${leagueId}&JSON=1`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'MFLFootball/2.0' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`MFL rosters API returned ${response.status}`);
  }

  const data = await response.json();
  const rawFranchises = data?.rosters?.franchise;
  if (!Array.isArray(rawFranchises)) {
    throw new Error('Unexpected MFL rosters response shape');
  }

  const franchises: CachedFranchiseRoster[] = [];
  for (const franchise of rawFranchises) {
    if (!franchise?.id) continue;
    const rosterPlayers = Array.isArray(franchise.player)
      ? franchise.player
      : [franchise.player].filter(Boolean);
    franchises.push({
      id: franchise.id,
      player: rosterPlayers
        .filter((p: any) => p?.id)
        .map((p: any) => ({
          id: p.id,
          status: p.status,
          salary: p.salary,
          contractYear: p.contractYear,
        })),
    });
  }

  const redis = await getRedis();
  if (!redis) return franchises;

  // A write busted the caches while this fetch was in flight — the data we
  // hold predates the write. Serve it to this request but don't cache it.
  if (await wasBustedSince(redis, leagueId, season, fetchStartedAt)) {
    console.log(`[mfl-roster-cache] Skipping cache write for ${leagueId}/${season} — busted mid-fetch`);
    return franchises;
  }

  const payload: CachedFranchisePayload = { franchises, fetchedAt: Date.now() };
  await redis.set(franchiseCacheKey(leagueId, season), payload, { ex: 3600 });
  console.log(`[mfl-roster-cache] Cached ${franchises.length} franchises for ${leagueId}/${season}`);

  return franchises;
}

async function fetchAndCacheRosters(
  season: string,
  leagueId: string
): Promise<Record<string, CachedRosterEntry>> {
  const fetchStartedAt = Date.now();
  const url = buildMflExportUrl({ type: 'rosters', leagueId, year: season });
  const response = await fetch(url, {
    headers: { 'User-Agent': 'MFLFootball/2.0' },
    signal: AbortSignal.timeout(10_000),
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

  // Don't cache data fetched before a mid-flight bust (see bustEpochKey).
  if (await wasBustedSince(redis, leagueId, season, fetchStartedAt)) {
    console.log(`[mfl-roster-cache] Skipping cache write for ${leagueId}/${season} — busted mid-fetch`);
    return players;
  }

  const payload: CachedRosterPayload = { players, fetchedAt: Date.now() };
  // Store in Redis with a 1-hour hard expiry as a safety net
  await redis.set(cacheKey(leagueId, season), payload, { ex: 3600 });
  console.log(`[mfl-roster-cache] Cached ${Object.keys(players).length} players for ${leagueId}/${season}`);

  return players;
}
