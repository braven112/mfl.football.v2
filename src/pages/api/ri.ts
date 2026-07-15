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
import { getRedis } from '../../utils/redis-client';
import { unauthorized } from '../../utils/api-response';

function makeKey(franchiseId: string): string {
  return `ri:${franchiseId}`;
}

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
    return unauthorized({ error: 'Unauthorized' });
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
    return unauthorized({ error: 'Unauthorized' });
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
