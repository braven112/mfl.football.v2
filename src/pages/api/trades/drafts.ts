/**
 * Draft Trades API Endpoint
 *
 * GET    /api/trades/drafts           — Load all saved draft trades
 * POST   /api/trades/drafts           — Save a new draft trade
 * PATCH  /api/trades/drafts           — Rename a draft trade  { id, name }
 * DELETE /api/trades/drafts?id={id}   — Delete a draft trade
 *
 * Auth: Any authenticated franchise owner.
 * Storage: Upstash Redis hash, keyed by dt:{franchiseId}.
 * Each franchise can store up to 20 drafts.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import type { DraftTrade } from '../../../types/trade-builder';

type RedisClient = {
  get: <T>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
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
      console.warn('Draft trades KV unavailable: @upstash/redis is not installed.', error);
    }
    return null;
  }
}

const MAX_DRAFTS = 20;

function makeKey(franchiseId: string): string {
  return `dt:${franchiseId}`;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const redis = await getRedis();
  if (!redis) return jsonResponse({ drafts: [] });

  try {
    const drafts = await redis.get<DraftTrade[]>(makeKey(user.franchiseId));
    return jsonResponse({ drafts: drafts ?? [] });
  } catch (err) {
    console.error('Failed to load draft trades from KV:', err);
    return jsonResponse({ drafts: [], error: 'Read failed' });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const redis = await getRedis();
  if (!redis) return jsonResponse({ success: false, error: 'Storage not configured' }, 503);

  try {
    const draft = (await request.json()) as DraftTrade;
    if (!draft.id || !draft.name) {
      return jsonResponse({ success: false, error: 'Missing id or name' }, 400);
    }

    const key = makeKey(user.franchiseId);
    const existing = (await redis.get<DraftTrade[]>(key)) ?? [];
    const updated = [draft, ...existing].slice(0, MAX_DRAFTS);
    await redis.set(key, updated);
    return jsonResponse({ success: true, drafts: updated });
  } catch (err) {
    console.error('Failed to save draft trade to KV:', err);
    return jsonResponse({ success: false, error: 'Write failed' }, 500);
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const redis = await getRedis();
  if (!redis) return jsonResponse({ success: false, error: 'Storage not configured' }, 503);

  try {
    const { id, name } = (await request.json()) as { id: string; name: string };
    if (!id || !name?.trim()) {
      return jsonResponse({ success: false, error: 'Missing id or name' }, 400);
    }

    const key = makeKey(user.franchiseId);
    const existing = (await redis.get<DraftTrade[]>(key)) ?? [];
    const updated = existing.map(d =>
      d.id === id ? { ...d, name: name.trim(), updatedAt: Date.now() } : d
    );
    await redis.set(key, updated);
    return jsonResponse({ success: true, drafts: updated });
  } catch (err) {
    console.error('Failed to rename draft trade in KV:', err);
    return jsonResponse({ success: false, error: 'Write failed' }, 500);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const redis = await getRedis();
  if (!redis) return jsonResponse({ success: false, error: 'Storage not configured' }, 503);

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) {
      return jsonResponse({ success: false, error: 'Missing draft id' }, 400);
    }

    const key = makeKey(user.franchiseId);
    const existing = (await redis.get<DraftTrade[]>(key)) ?? [];
    const updated = existing.filter(d => d.id !== id);
    await redis.set(key, updated);
    return jsonResponse({ success: true, drafts: updated });
  } catch (err) {
    console.error('Failed to delete draft trade from KV:', err);
    return jsonResponse({ success: false, error: 'Delete failed' }, 500);
  }
};
