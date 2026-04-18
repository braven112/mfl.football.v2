/**
 * GET /api/schefter/tipster-stats
 *
 * Returns the authenticated tipster's personal scorecard + the top-10 season
 * leaderboard. Everything is keyed on the one-way tipster hash server-side;
 * the response only ever exposes codenames and counts, never hashes or ids.
 *
 * Response shape:
 *   {
 *     me: { codename: string | null, rumorsTotal: number, rumorsSeason: number } | null,
 *     leaderboard: Array<{ codename: string, rumorsSeason: number, isMe: boolean }>,
 *     seasonYear: number
 *   }
 *
 * `me.codename === null` means the tipster has submitted tips but none have
 * produced a rumor yet (codenames are only issued when a scan commits a post).
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { hashTipsterId } from '../../../utils/schefter-tipster-hash';
import { getCurrentLeagueYear } from '../../../utils/league-year';
import { getCodename } from '../../../utils/schefter-codenames';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const LEADERBOARD_LIMIT = 10;

type RedisClient = {
  get: <T>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => Promise<unknown>;
  sadd: (key: string, ...members: string[]) => Promise<number>;
  srem: (key: string, ...members: string[]) => Promise<number>;
  smembers: (key: string) => Promise<string[]>;
  zrange: (
    key: string,
    start: number,
    stop: number,
    opts?: { rev?: boolean; withScores?: boolean },
  ) => Promise<unknown>;
};

let _redis: RedisClient | null | undefined;

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
    console.warn('[tipster-stats] Redis unavailable:', err);
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

/**
 * Normalize `redis.zrange` results across Upstash client versions. Some return
 * a flat [member, score, member, score] list; others return [{member, score}].
 */
function normalizeZrange(raw: unknown): Array<{ member: string; score: number }> {
  if (!Array.isArray(raw)) return [];
  if (raw.length === 0) return [];

  const first = raw[0];
  if (first && typeof first === 'object' && 'member' in (first as Record<string, unknown>)) {
    return (raw as Array<{ member: string; score: number | string }>)
      .map((row) => ({
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

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!user.franchiseId) return json({ error: 'no_franchise' }, 403);

  let hashedOwnerId: string;
  try {
    hashedOwnerId = hashTipsterId(user.id);
  } catch {
    return json({ error: 'server_misconfigured' }, 500);
  }

  const seasonYear = getCurrentLeagueYear();
  const redis = await getRedis();
  if (!redis) {
    return json({
      me: { codename: null, rumorsTotal: 0, rumorsSeason: 0 },
      leaderboard: [],
      seasonYear,
    });
  }

  const leaderboardKey = `schefter:tipster:leaderboard:${seasonYear}`;
  const totalKey = `schefter:tipster:rumors_total:${hashedOwnerId}`;
  const seasonKey = `schefter:tipster:rumors_season:${seasonYear}:${hashedOwnerId}`;

  let codename: string | null = null;
  let rumorsTotal = 0;
  let rumorsSeason = 0;
  let rawLeaderboard: unknown = [];
  let badges: string[] = [];

  try {
    const [cn, total, season, zrangeRaw, rawBadges] = await Promise.all([
      getCodename(redis, hashedOwnerId),
      redis.get<string | number>(totalKey),
      redis.get<string | number>(seasonKey),
      redis.zrange(leaderboardKey, 0, LEADERBOARD_LIMIT - 1, { rev: true, withScores: true }),
      redis.smembers(`schefter:tipster:badges:${hashedOwnerId}`).catch(() => []),
    ]);
    codename = cn;
    rumorsTotal = coerceCount(total);
    rumorsSeason = coerceCount(season);
    rawLeaderboard = zrangeRaw;
    badges = Array.isArray(rawBadges) ? rawBadges.map((b) => String(b)).sort().reverse() : [];
  } catch (err) {
    console.error('[tipster-stats] Read error:', err);
    return json({ error: 'redis_unavailable' }, 503);
  }

  const rows = normalizeZrange(rawLeaderboard);

  // Resolve codenames for each leaderboard entry. A tipster's member is their
  // hashedOwnerId, so we look up their codename under the same Redis key used
  // during assignment. Entries without a codename (shouldn't happen — scanner
  // issues one before incrementing the zset) are skipped so the raw hash
  // never leaks to the client.
  const leaderboard: Array<{ codename: string; rumorsSeason: number; isMe: boolean }> = [];
  for (const row of rows) {
    try {
      const name = await getCodename(redis, row.member);
      if (!name) continue;
      leaderboard.push({
        codename: name,
        rumorsSeason: row.score,
        isMe: row.member === hashedOwnerId,
      });
    } catch {
      // If a single lookup fails we still return the rest — do not surface
      // the hash and do not bail the whole request.
    }
  }

  return json({
    me: { codename, rumorsTotal, rumorsSeason, badges },
    leaderboard,
    seasonYear,
  });
};
