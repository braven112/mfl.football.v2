/**
 * Custom Rankings API Endpoint
 *
 * GET  /api/cr — Load custom rankings from Vercel KV
 * POST /api/cr — Save custom rankings to Vercel KV
 *
 * Auth: Admin franchise only (franchise 0001).
 * Storage: Upstash Redis via @upstash/redis, keyed by cr:{franchiseId}.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { isAdminFranchise } from '../../config/nav-config';
import type { CustomRankingsState } from '../../types/custom-rankings';

type RedisClient = {
  get: <T>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown) => Promise<unknown>;
};

let loggedMissingRedisModule = false;

async function getRedis(): Promise<RedisClient | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;

  try {
    const { Redis } = await import('@upstash/redis');
    return new Redis({ url, token });
  } catch (error) {
    // Local/dev fallback: do not crash route if Redis package is unavailable.
    if (!loggedMissingRedisModule) {
      loggedMissingRedisModule = true;
      console.warn('Custom rankings KV unavailable: @upstash/redis is not installed.', error);
    }
    return null;
  }
}

function makeKey(franchiseId: string): string {
  return `cr:${franchiseId}`;
}

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user || !isAdminFranchise(user.franchiseId)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const redis = await getRedis();
  if (!redis) {
    return new Response(
      JSON.stringify({ data: null, error: 'Storage not configured' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    const data = await redis.get<CustomRankingsState>(makeKey(user.franchiseId));
    return new Response(JSON.stringify({ data: data ?? null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Failed to load custom rankings from KV:', err);
    return new Response(JSON.stringify({ data: null, error: 'Read failed' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user || !isAdminFranchise(user.franchiseId)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const redis = await getRedis();
  if (!redis) {
    return new Response(
      JSON.stringify({ success: false, error: 'Storage not configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    const body = (await request.json()) as CustomRankingsState;
    await redis.set(makeKey(user.franchiseId), body);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Failed to save custom rankings to KV:', err);
    return new Response(
      JSON.stringify({ success: false, error: 'Write failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
