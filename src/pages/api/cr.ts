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
import { getAuthUser, isCommissionerOrAdmin } from '../../utils/auth';
import type { CustomRankingsState } from '../../types/custom-rankings';
import { getRedis } from '../../utils/redis-client';
import { unauthorized } from '../../utils/api-response';

function makeKey(franchiseId: string): string {
  return `cr:${franchiseId}`;
}

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user || !isCommissionerOrAdmin(user)) {
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
  if (!user || !isCommissionerOrAdmin(user)) {
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
