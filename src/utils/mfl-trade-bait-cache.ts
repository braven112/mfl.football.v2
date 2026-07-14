/**
 * MFL Trade Bait Cache — cache-with-TTL via Upstash Redis
 *
 * Serves trade bait (trade block) data from Redis cache when fresh
 * (< 2 min old). When stale or missing, fetches live data from the public
 * MFL tradeBait export synchronously and updates the cache before
 * returning. Mirrors src/utils/mfl-roster-cache.ts — see that module for
 * the reasoning behind the inline (awaited) refresh and the bust-epoch
 * race guard.
 *
 * Why this exists: pages read trade bait from committed feed JSON bundled
 * at build time, and /api/trade-bait's write-through file cache can't
 * modify the deployed filesystem on Vercel. Without a live source, a
 * player flagged on MFL doesn't appear on the site until the next feed
 * sync commit + redeploy.
 *
 * Redis key: mfl:trade-bait:{leagueId}:{season}
 * TTL: 2 minutes before a synchronous refresh; 1-hour hard expiry
 * Fallback: returns null when Redis is unavailable (caller uses the
 * committed feed files)
 */

import { mflFetch } from './mfl-fetch';

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
      console.warn('[mfl-trade-bait-cache] @upstash/redis unavailable:', error);
    }
    return null;
  }
}

export interface TradeBaitFranchiseEntry {
  playerIds: string[];
  willGiveUpComment: string;
  willTakeComment: string;
}

/** franchiseId → trade bait entry (same shape as tradeBait-by-franchise.json's `franchises`) */
export type TradeBaitFranchiseMap = Record<string, TradeBaitFranchiseEntry>;

interface CachedTradeBaitPayload {
  franchises: TradeBaitFranchiseMap;
  fetchedAt: number;
}

function cacheKey(leagueId: string, season: string): string {
  return `mfl:trade-bait:${leagueId}:${season}`;
}

/**
 * Epoch key recording when the cache was last overwritten by a trade-block
 * write. Cache fills started BEFORE this moment are discarded rather than
 * written — otherwise a page load that began fetching pre-write data could
 * land its Redis set after the write and re-poison the cache. Same model
 * as mfl-roster-cache's bustEpochKey (and the same accepted ~one-RTT
 * residual races, which self-heal within STALE_TTL_MS).
 */
function overwriteEpochKey(leagueId: string, season: string): string {
  return `mfl:trade-bait-busted:${leagueId}:${season}`;
}

async function wasOverwrittenSince(
  redis: RedisClient,
  leagueId: string,
  season: string,
  fetchStartedAt: number
): Promise<boolean> {
  try {
    const at = await redis.get<number>(overwriteEpochKey(leagueId, season));
    return typeof at === 'number' && at > fetchStartedAt;
  } catch {
    return false;
  }
}

/** In-memory flag to prevent duplicate concurrent fetches within the same process */
const refreshing = new Map<string, Promise<TradeBaitFranchiseMap | null>>();

/**
 * Get the per-franchise trade bait map from Redis cache (fresh < 2 min),
 * refreshing synchronously from MFL when stale or missing.
 * Returns null when Redis is unavailable (caller falls back to committed feeds).
 */
export async function getCachedTradeBait(
  season: string,
  leagueId: string
): Promise<TradeBaitFranchiseMap | null> {
  const redis = await getRedis();
  if (!redis) return null;

  try {
    const key = cacheKey(leagueId, season);
    const cached = await redis.get<CachedTradeBaitPayload>(key);

    if (!cached?.franchises) {
      console.log(`[mfl-trade-bait-cache] Cache miss for ${key}, fetching synchronously`);
      return await deduplicatedFetch(season, leagueId);
    }

    // !(fresh) so a missing/corrupt fetchedAt (NaN age) refreshes too.
    const age = Date.now() - cached.fetchedAt;
    if (!(age <= STALE_TTL_MS)) {
      console.log(`[mfl-trade-bait-cache] Stale data for ${key} (age: ${Math.round(age / 1000)}s), refreshing synchronously`);
      const fresh = await deduplicatedFetch(season, leagueId);
      return fresh ?? cached.franchises; // Fall back to stale data if refresh fails
    }

    return cached.franchises;
  } catch (error) {
    console.warn('[mfl-trade-bait-cache] Redis read failed:', error);
    return null;
  }
}

async function deduplicatedFetch(
  season: string,
  leagueId: string
): Promise<TradeBaitFranchiseMap | null> {
  const key = cacheKey(leagueId, season);

  const existing = refreshing.get(key);
  if (existing) return existing;

  const promise = fetchAndCacheTradeBait(season, leagueId)
    .then((franchises) => franchises)
    .catch((err) => {
      console.warn('[mfl-trade-bait-cache] Fetch failed:', err);
      return null;
    })
    .finally(() => refreshing.delete(key));

  refreshing.set(key, promise);
  return promise;
}

/**
 * Overwrite the cache with the post-write state /api/trade-bait already
 * holds (read-merge-write means it has the complete fresh map — no
 * re-fetch needed). Also stamps the overwrite epoch so any in-flight
 * pre-write cache fill discards itself instead of clobbering this.
 */
export async function overwriteTradeBaitCache(
  season: string,
  leagueId: string,
  franchises: TradeBaitFranchiseMap
): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  const key = cacheKey(leagueId, season);
  console.log(`[mfl-trade-bait-cache] Overwriting cache after trade-block write: ${key}`);
  const payload: CachedTradeBaitPayload = { franchises, fetchedAt: Date.now() };
  await Promise.allSettled([
    redis.set(key, payload, { ex: 3600 }),
    redis.set(overwriteEpochKey(leagueId, season), Date.now(), { ex: 600 }),
  ]);
}

async function fetchAndCacheTradeBait(
  season: string,
  leagueId: string
): Promise<TradeBaitFranchiseMap> {
  const fetchStartedAt = Date.now();

  // Unlike the rosters export, MFL's tradeBait export is owner-gated for
  // private leagues (AFL): an unauthenticated request returns 200 with an
  // EMPTY payload, not an error. Authenticate with whatever the server has —
  // the league APIKEY travels as a URL param (survives redirects), and the
  // server MFL_USER_ID cookie goes through mflFetch, which re-attaches the
  // Cookie header across MFL's api→www## redirect (plain fetch drops it).
  const apiKey = process.env.MFL_APIKEY || process.env.MFL_API_KEY;
  let url = `https://api.myfantasyleague.com/${season}/export?TYPE=tradeBait&L=${leagueId}&JSON=1`;
  if (apiKey) url += `&APIKEY=${encodeURIComponent(apiKey)}`;

  const serverCookie = process.env.MFL_USER_ID;
  const response = serverCookie
    ? await mflFetch({ url, method: 'GET', mflUserCookie: serverCookie })
    : await fetch(url, {
        headers: { 'User-Agent': 'MFLFootball/2.0' },
        signal: AbortSignal.timeout(10_000),
      });

  if (!response.ok) {
    throw new Error(`MFL tradeBait API returned ${response.status}`);
  }

  const data = await response.json();
  const franchises = parseRawExport(data);
  if (Object.keys(franchises).length === 0) {
    // Keep the raw payload visible in logs — "empty" can mean nobody has
    // flagged anyone, but it can also mean MFL answered the unauthenticated
    // shape. The snippet makes the two distinguishable after the fact.
    console.log(
      `[mfl-trade-bait-cache] Export returned no franchises (${leagueId}/${season}, auth: ${serverCookie ? 'cookie' : apiKey ? 'apikey' : 'none'}) — raw: ${JSON.stringify(data).slice(0, 300)}`
    );
  }

  const redis = await getRedis();
  if (!redis) return franchises;

  // A write overwrote the cache while this fetch was in flight — the data
  // we hold predates the write. Serve it to this request but don't cache it.
  if (await wasOverwrittenSince(redis, leagueId, season, fetchStartedAt)) {
    console.log(`[mfl-trade-bait-cache] Skipping cache write for ${leagueId}/${season} — overwritten mid-fetch`);
    return franchises;
  }

  const payload: CachedTradeBaitPayload = { franchises, fetchedAt: Date.now() };
  await redis.set(cacheKey(leagueId, season), payload, { ex: 3600 });
  console.log(`[mfl-trade-bait-cache] Cached trade bait for ${Object.keys(franchises).length} franchises (${leagueId}/${season})`);

  return franchises;
}

/**
 * Raw MFL export → per-franchise map. Same parse as
 * scripts/fetch-trade-bait.mjs / fetch-mfl-feeds.mjs (which can't share
 * TS code); keep the three in sync if MFL's shape changes.
 */
function parseRawExport(data: unknown): TradeBaitFranchiseMap {
  const franchises: TradeBaitFranchiseMap = {};
  let entries = (data as any)?.tradeBaits?.tradeBait;
  if (entries && !Array.isArray(entries)) entries = [entries];
  if (!Array.isArray(entries)) return franchises;

  for (const item of entries) {
    const franchiseId = String(
      item?.franchise_id ?? item?.franchiseId ?? item?.franchise ?? ''
    ).trim();
    if (!franchiseId) continue;

    const rawIds: string[] = typeof item?.willGiveUp === 'string'
      ? item.willGiveUp.split(',').map((id: string) => id.trim())
      : item?.willGiveUp != null ? [String(item.willGiveUp)] : [];

    franchises[franchiseId] = {
      playerIds: rawIds.filter((id) => /^\d{4,}$/.test(id)),
      willGiveUpComment: typeof item?.willGiveUpComments === 'string' ? item.willGiveUpComments.trim() : '',
      willTakeComment: typeof item?.willTakeComments === 'string' ? item.willTakeComments.trim() : '',
    };
  }
  return franchises;
}
