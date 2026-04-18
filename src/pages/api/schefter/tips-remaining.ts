/**
 * GET /api/schefter/tips-remaining
 *
 * Returns the current tip rate-limit counter for the authenticated user.
 * Used by the tip page to render a "N of 3 tips left today" chip and to
 * disable the submit button when the 24h cap is hit.
 *
 * Body shape: { used: number, remaining: number, max: 3, resetsAt: number | null }
 *
 * resetsAt is a Unix epoch ms. When the key hasn't been written (used===0)
 * we return null — there's nothing to reset yet.
 *
 * Never exposes hashedOwnerId or userId. Counter is keyed by the same
 * hashed owner id as the POST /api/schefter/tip endpoint.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { hashTipsterId } from '../../../utils/schefter-tipster-hash';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const RATE_LIMIT_PREFIX = 'schefter:tips:ratelimit:';
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_TTL_SEC = 24 * 60 * 60;

type RedisClient = {
  get: <T>(key: string) => Promise<T | null>;
  ttl: (key: string) => Promise<number>;
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
    console.warn('[tips-remaining] Redis unavailable:', err);
    _redis = null;
    return null;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
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

  const redis = await getRedis();
  if (!redis) {
    // Degraded mode: we can't read the counter, but we shouldn't block the UI
    // from rendering. Return the optimistic max; submit endpoint will still
    // enforce the cap in Redis when it comes back online.
    return json({ used: 0, remaining: RATE_LIMIT_MAX, max: RATE_LIMIT_MAX, resetsAt: null });
  }

  const key = `${RATE_LIMIT_PREFIX}${hashedOwnerId}`;
  let used = 0;
  let resetsAt: number | null = null;
  try {
    const raw = await redis.get<string | number>(key);
    if (raw !== null && raw !== undefined) {
      const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
      if (Number.isFinite(n)) used = Math.max(0, n);
      const ttl = await redis.ttl(key);
      if (typeof ttl === 'number' && ttl > 0) {
        resetsAt = Date.now() + ttl * 1000;
      } else if (typeof ttl === 'number' && ttl === -1) {
        // Key has no expiry — shouldn't happen, but cap it at the TTL window
        // so the UI doesn't show a confusing "no reset" state.
        resetsAt = Date.now() + RATE_LIMIT_TTL_SEC * 1000;
      }
    }
  } catch (err) {
    console.error('[tips-remaining] Read error:', err);
    return json({ error: 'redis_unavailable' }, 503);
  }

  const clamped = Math.min(used, RATE_LIMIT_MAX);
  const remaining = Math.max(0, RATE_LIMIT_MAX - clamped);

  return json({ used: clamped, remaining, max: RATE_LIMIT_MAX, resetsAt });
};
