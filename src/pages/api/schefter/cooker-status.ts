/**
 * GET /api/schefter/cooker-status
 *
 * Public (no auth) read of the rumor-mill cook state — used by the tip page
 * to render a "Schefter is marinating 2 tips. Next rumor drops around 8:42pm."
 * countdown card (Phase 8).
 *
 * Body:
 *   {
 *     queueDepth: number,
 *     marinateStartedAt: number | null,
 *     nextEarliestPostAt: number | null,
 *     postsToday: number,
 *     dailyCap: number,
 *     dailyCapHit: boolean,
 *     marinateWindowMs: number
 *   }
 *
 * No identity signal — returns counts only. Queue contents are NEVER returned.
 */

import type { APIRoute } from 'astro';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const TIPS_QUEUE_KEY = 'schefter:tips:queue';
const FIRST_TIP_TS_KEY = 'schefter:tips:first_tip_ts';
const RUMOR_POSTS_TODAY_KEY = 'schefter:rumor:posts_today';

const MARINATE_WINDOW_MS = 60 * 60 * 1000;
const DAILY_CAP = 3;

type RedisClient = {
  llen: (key: string) => Promise<number>;
  get: <T>(key: string) => Promise<T | null>;
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
    console.warn('[cooker-status] Redis unavailable:', err);
    _redis = null;
    return null;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function coerce(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}

export const GET: APIRoute = async () => {
  const redis = await getRedis();
  if (!redis) {
    return json({
      queueDepth: 0,
      marinateStartedAt: null,
      nextEarliestPostAt: null,
      postsToday: 0,
      dailyCap: DAILY_CAP,
      dailyCapHit: false,
      marinateWindowMs: MARINATE_WINDOW_MS,
    });
  }

  let queueDepth = 0;
  let marinateStartedAt: number | null = null;
  let postsToday = 0;

  try {
    const [len, first, today] = await Promise.all([
      redis.llen(TIPS_QUEUE_KEY),
      redis.get<string | number>(FIRST_TIP_TS_KEY),
      redis.get<string | number>(RUMOR_POSTS_TODAY_KEY),
    ]);
    queueDepth = Math.max(0, Number.isFinite(len) ? (len as number) : 0);
    marinateStartedAt = coerce(first);
    postsToday = Math.max(0, coerce(today) ?? 0);
  } catch (err) {
    console.error('[cooker-status] Read error:', err);
    return json({ error: 'redis_unavailable' }, 503);
  }

  const dailyCapHit = postsToday >= DAILY_CAP;
  const nextEarliestPostAt =
    marinateStartedAt !== null ? marinateStartedAt + MARINATE_WINDOW_MS : null;

  return json({
    queueDepth,
    marinateStartedAt,
    nextEarliestPostAt,
    postsToday,
    dailyCap: DAILY_CAP,
    dailyCapHit,
    marinateWindowMs: MARINATE_WINDOW_MS,
  });
};
