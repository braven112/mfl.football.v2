/**
 * Import Rankings API Endpoint
 *
 * GET  /api/ri — Load synced import rankings from Vercel KV
 * POST /api/ri — Save import rankings to Vercel KV
 *
 * Auth: Any authenticated franchise owner.
 * Storage: Upstash Redis via @upstash/redis, keyed by ri:{franchiseId}.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import type { SyncedRankingsPayload } from '../../types/rankings-import';

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
    if (!loggedMissingRedisModule) {
      loggedMissingRedisModule = true;
      console.warn('Import rankings KV unavailable: @upstash/redis is not installed.', error);
    }
    return null;
  }
}

function makeKey(franchiseId: string): string {
  return `ri:${franchiseId}`;
}

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
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
    const data = await redis.get<SyncedRankingsPayload>(makeKey(user.franchiseId));
    return new Response(JSON.stringify({ data: data ?? null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Failed to load import rankings from KV:', err);
    return new Response(JSON.stringify({ data: null, error: 'Read failed' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
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
    const body = (await request.json()) as SyncedRankingsPayload;
    await redis.set(makeKey(user.franchiseId), body);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Failed to save import rankings to KV:', err);
    return new Response(
      JSON.stringify({ success: false, error: 'Write failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
