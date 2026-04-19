/**
 * GET /api/schefter/style-book
 *
 * Public (no auth) read of the Style Book leaderboards — running tallies of
 * personal attacks on Schefter. Two separate pools:
 *
 *   - `named` — GroupMe-chat attackers, keyed on the public display name.
 *     Public authorship already makes these identifiable.
 *   - `anonymous` — web-tip attackers, keyed internally on the tipster hash
 *     but displayed ONLY as a codename ("Burner Phone", "The Ghost" …). The
 *     raw hash never appears in the response.
 *
 * The two leaderboards are returned side by side so web tipsters compete
 * against each other (by codename) and GroupMe attackers compete against each
 * other (by name) — never mixed.
 *
 * Response shape:
 *   {
 *     seasonYear: number,
 *     named: {
 *       entries: Array<{ author, seasonCount, lifetimeCount, lastShotAt }>,
 *       totals: { seasonShots, authors }
 *     },
 *     anonymous: {
 *       entries: Array<{ codename, seasonCount, lifetimeCount, lastShotAt }>,
 *       totals: { seasonShots, authors }
 *     }
 *   }
 */

import type { APIRoute } from 'astro';
import { getCurrentLeagueYear } from '../../../utils/league-year';
import { getCodename } from '../../../utils/schefter-codenames';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const LEADERBOARD_LIMIT = 25;
const CACHE_TTL_MS = 30_000;

// Named (GroupMe) Style Book
const NAMED_LIFETIME_PREFIX = 'schefter:style_book:';
const NAMED_LAST_SHOT_PREFIX = 'schefter:style_book:last_shot_at:';
const NAMED_LEADERBOARD_PREFIX = 'schefter:style_book:leaderboard:';

// Anonymous (web-tip) Style Book
const ANON_LIFETIME_PREFIX = 'schefter:style_book:anon:';
const ANON_LAST_SHOT_PREFIX = 'schefter:style_book:anon:last_shot_at:';
const ANON_LEADERBOARD_PREFIX = 'schefter:style_book:anon_leaderboard:';

type RedisClient = {
  get: <T>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => Promise<unknown>;
  sadd: (key: string, ...members: string[]) => Promise<number>;
  srem: (key: string, ...members: string[]) => Promise<number>;
  zrange: (
    key: string,
    start: number,
    stop: number,
    opts?: { rev?: boolean; withScores?: boolean },
  ) => Promise<unknown>;
  zcard: (key: string) => Promise<number>;
};

type NamedEntry = {
  author: string;
  seasonCount: number;
  lifetimeCount: number;
  lastShotAt: number | null;
};

type AnonEntry = {
  codename: string;
  seasonCount: number;
  lifetimeCount: number;
  lastShotAt: number | null;
};

type StyleBookResponse = {
  seasonYear: number;
  named: {
    entries: NamedEntry[];
    totals: { seasonShots: number; authors: number };
  };
  anonymous: {
    entries: AnonEntry[];
    totals: { seasonShots: number; authors: number };
  };
};

let _redis: RedisClient | null | undefined;
let _cache: { data: StyleBookResponse; expiresAt: number } | null = null;

async function getRedis(): Promise<RedisClient | null> {
  if (_redis !== undefined) return _redis;
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.STORAGE_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.STORAGE_REST_API_TOKEN;
  if (!url || !token) {
    _redis = null;
    return null;
  }
  try {
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({ url, token }) as unknown as RedisClient;
    return _redis;
  } catch (err) {
    console.warn('[style-book] Redis unavailable:', err);
    _redis = null;
    return null;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function coerceCount(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
  if (typeof raw === 'string') {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  return 0;
}

function coerceTimestamp(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Mirrors normalizeAuthorKey() in scripts/schefter-groupme-listen.mjs for the
 * NAMED leaderboard. Both paths must produce the same key for the same display
 * name or lifetime/last-shot lookups will miss.
 */
export function normalizeAuthorKey(name: string): string {
  if (!name || typeof name !== 'string') return '';
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Normalize `zrange` results across Upstash client versions. */
function normalizeZrange(raw: unknown): Array<{ member: string; score: number }> {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const first = raw[0];
  if (first && typeof first === 'object' && 'member' in (first as Record<string, unknown>)) {
    return (raw as Array<{ member: string; score: number | string }>).map((row) => ({
      member: String(row.member),
      score: coerceCount(row.score),
    }));
  }
  const out: Array<{ member: string; score: number }> = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    out.push({ member: String(raw[i]), score: coerceCount(raw[i + 1]) });
  }
  return out;
}

export function _resetStyleBookCacheForTests(): void {
  _cache = null;
}

async function fetchNamedEntries(
  redis: RedisClient,
  seasonYear: number,
): Promise<{ entries: NamedEntry[]; authorCount: number }> {
  const leaderboardKey = `${NAMED_LEADERBOARD_PREFIX}${seasonYear}`;
  const [rawLeaderboard, rawCount] = await Promise.all([
    redis.zrange(leaderboardKey, 0, LEADERBOARD_LIMIT - 1, { rev: true, withScores: true }),
    redis.zcard(leaderboardKey).catch(() => 0),
  ]);
  const rows = normalizeZrange(rawLeaderboard);
  const authorCount = typeof rawCount === 'number' ? rawCount : rows.length;
  if (rows.length === 0) return { entries: [], authorCount };

  const entries = await Promise.all(
    rows.map(async (row) => {
      const authorKey = normalizeAuthorKey(row.member);
      let lifetimeCount = 0;
      let lastShotAt: number | null = null;
      if (authorKey) {
        try {
          const [lifeRaw, shotRaw] = await Promise.all([
            redis.get<string | number>(`${NAMED_LIFETIME_PREFIX}${authorKey}`),
            redis.get<string | number>(`${NAMED_LAST_SHOT_PREFIX}${authorKey}`),
          ]);
          lifetimeCount = coerceCount(lifeRaw);
          lastShotAt = coerceTimestamp(shotRaw);
        } catch {
          /* degrade */
        }
      }
      return {
        author: row.member,
        seasonCount: row.score,
        lifetimeCount,
        lastShotAt,
      } satisfies NamedEntry;
    }),
  );
  return { entries, authorCount };
}

/**
 * Anon entries — ZSET members are tipster HASHES. The hash is NEVER returned
 * to the client; we resolve each to its codename via getCodename and drop
 * entries whose codename we can't resolve (shouldn't happen — tip.ts calls
 * assignCodename on every attack — but a belt-and-suspenders guard).
 */
async function fetchAnonEntries(
  redis: RedisClient,
  seasonYear: number,
): Promise<{ entries: AnonEntry[]; authorCount: number }> {
  const leaderboardKey = `${ANON_LEADERBOARD_PREFIX}${seasonYear}`;
  const [rawLeaderboard, rawCount] = await Promise.all([
    redis.zrange(leaderboardKey, 0, LEADERBOARD_LIMIT - 1, { rev: true, withScores: true }),
    redis.zcard(leaderboardKey).catch(() => 0),
  ]);
  const rows = normalizeZrange(rawLeaderboard);
  const authorCount = typeof rawCount === 'number' ? rawCount : rows.length;
  if (rows.length === 0) return { entries: [], authorCount };

  const entries: AnonEntry[] = [];
  for (const row of rows) {
    const hashedOwnerId = row.member;
    let codename: string | null = null;
    try {
      codename = await getCodename(redis, hashedOwnerId);
    } catch {
      codename = null;
    }
    if (!codename) continue; // never leak a raw hash into the response

    let lifetimeCount = 0;
    let lastShotAt: number | null = null;
    try {
      const [lifeRaw, shotRaw] = await Promise.all([
        redis.get<string | number>(`${ANON_LIFETIME_PREFIX}${hashedOwnerId}`),
        redis.get<string | number>(`${ANON_LAST_SHOT_PREFIX}${hashedOwnerId}`),
      ]);
      lifetimeCount = coerceCount(lifeRaw);
      lastShotAt = coerceTimestamp(shotRaw);
    } catch {
      /* degrade */
    }
    entries.push({
      codename,
      seasonCount: row.score,
      lifetimeCount,
      lastShotAt,
    });
  }
  return { entries, authorCount };
}

export const GET: APIRoute = async () => {
  const now = Date.now();
  if (_cache && _cache.expiresAt > now) {
    return json(_cache.data);
  }

  const seasonYear = getCurrentLeagueYear();
  const redis = await getRedis();

  if (!redis) {
    const empty: StyleBookResponse = {
      seasonYear,
      named: { entries: [], totals: { seasonShots: 0, authors: 0 } },
      anonymous: { entries: [], totals: { seasonShots: 0, authors: 0 } },
    };
    _cache = { data: empty, expiresAt: now + CACHE_TTL_MS };
    return json(empty);
  }

  let named: { entries: NamedEntry[]; authorCount: number };
  let anonymous: { entries: AnonEntry[]; authorCount: number };
  try {
    [named, anonymous] = await Promise.all([
      fetchNamedEntries(redis, seasonYear),
      fetchAnonEntries(redis, seasonYear),
    ]);
  } catch (err) {
    console.error('[style-book] Read error:', err);
    return json({ error: 'redis_unavailable' }, 503);
  }

  const namedTotal = named.entries.reduce((sum, e) => sum + e.seasonCount, 0);
  const anonTotal = anonymous.entries.reduce((sum, e) => sum + e.seasonCount, 0);

  const response: StyleBookResponse = {
    seasonYear,
    named: {
      entries: named.entries,
      totals: { seasonShots: namedTotal, authors: named.authorCount },
    },
    anonymous: {
      entries: anonymous.entries,
      totals: { seasonShots: anonTotal, authors: anonymous.authorCount },
    },
  };

  _cache = { data: response, expiresAt: now + CACHE_TTL_MS };
  return json(response);
};
