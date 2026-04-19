/**
 * GET /api/schefter/style-book
 *
 * Public (no auth) read of the Style Book leaderboard — the running tally
 * of GroupMe personal attacks on Schefter, by author. GroupMe authorship
 * is already public (anyone can scroll the chat), so exposing these counts
 * on a public page doesn't widen the de-anonymization surface.
 *
 * Response shape:
 *   {
 *     seasonYear: number,
 *     entries: Array<{
 *       author: string,
 *       seasonCount: number,
 *       lifetimeCount: number,
 *       lastShotAt: number | null
 *     }>,
 *     totals: { seasonShots: number, authors: number }
 *   }
 *
 * The leaderboard ZSET stores each attacker's DISPLAY name directly
 * (not a hash) because the whole point of the bit is named ribbing.
 * Lifetime + last-shot lookups use a normalized lowercase key — mirrors
 * normalizeAuthorKey() in scripts/schefter-groupme-listen.mjs so the
 * two sides stay in sync.
 */

import type { APIRoute } from 'astro';
import { getCurrentLeagueYear } from '../../../utils/league-year';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const LEADERBOARD_LIMIT = 25;
const CACHE_TTL_MS = 30_000;

const STYLE_BOOK_LIFETIME_PREFIX = 'schefter:style_book:';
const STYLE_BOOK_LAST_SHOT_PREFIX = 'schefter:style_book:last_shot_at:';
const STYLE_BOOK_LEADERBOARD_PREFIX = 'schefter:style_book:leaderboard:';

type RedisClient = {
  get: <T>(key: string) => Promise<T | null>;
  zrange: (
    key: string,
    start: number,
    stop: number,
    opts?: { rev?: boolean; withScores?: boolean },
  ) => Promise<unknown>;
  zcard: (key: string) => Promise<number>;
};

type LeaderboardEntry = {
  author: string;
  seasonCount: number;
  lifetimeCount: number;
  lastShotAt: number | null;
};

type StyleBookResponse = {
  seasonYear: number;
  entries: LeaderboardEntry[];
  totals: { seasonShots: number; authors: number };
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
 * Mirrors normalizeAuthorKey() in scripts/schefter-groupme-listen.mjs.
 * Both paths must produce the same key for the same display name, otherwise
 * lifetime + last-shot lookups miss on the leaderboard display name.
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

/** Expose cache reset for tests — not wired in production. */
export function _resetStyleBookCacheForTests(): void {
  _cache = null;
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
      entries: [],
      totals: { seasonShots: 0, authors: 0 },
    };
    _cache = { data: empty, expiresAt: now + CACHE_TTL_MS };
    return json(empty);
  }

  const leaderboardKey = `${STYLE_BOOK_LEADERBOARD_PREFIX}${seasonYear}`;

  let rawLeaderboard: unknown = [];
  let authorCount = 0;
  try {
    [rawLeaderboard, authorCount] = await Promise.all([
      redis.zrange(leaderboardKey, 0, LEADERBOARD_LIMIT - 1, { rev: true, withScores: true }),
      redis.zcard(leaderboardKey).catch(() => 0),
    ]);
  } catch (err) {
    console.error('[style-book] Read error:', err);
    return json({ error: 'redis_unavailable' }, 503);
  }

  const rows = normalizeZrange(rawLeaderboard);
  if (rows.length === 0) {
    const empty: StyleBookResponse = {
      seasonYear,
      entries: [],
      totals: { seasonShots: 0, authors: 0 },
    };
    _cache = { data: empty, expiresAt: now + CACHE_TTL_MS };
    return json(empty);
  }

  // Fetch lifetime count + last-shot timestamp for each leaderboard entry
  // in parallel. A single failed lookup degrades that entry (lifetime=0,
  // lastShotAt=null) without killing the whole response.
  const entries = await Promise.all(
    rows.map(async (row) => {
      const authorKey = normalizeAuthorKey(row.member);
      let lifetimeCount = 0;
      let lastShotAt: number | null = null;
      if (authorKey) {
        try {
          const [lifeRaw, shotRaw] = await Promise.all([
            redis.get<string | number>(`${STYLE_BOOK_LIFETIME_PREFIX}${authorKey}`),
            redis.get<string | number>(`${STYLE_BOOK_LAST_SHOT_PREFIX}${authorKey}`),
          ]);
          lifetimeCount = coerceCount(lifeRaw);
          lastShotAt = coerceTimestamp(shotRaw);
        } catch {
          // Best-effort — leave degraded values.
        }
      }
      return {
        author: row.member,
        seasonCount: row.score,
        lifetimeCount,
        lastShotAt,
      } satisfies LeaderboardEntry;
    }),
  );

  const seasonShots = entries.reduce((sum, e) => sum + e.seasonCount, 0);

  const response: StyleBookResponse = {
    seasonYear,
    entries,
    totals: {
      seasonShots,
      authors: typeof authorCount === 'number' ? authorCount : entries.length,
    },
  };

  _cache = { data: response, expiresAt: now + CACHE_TTL_MS };
  return json(response);
};
