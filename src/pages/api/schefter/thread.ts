/**
 * GET /api/schefter/thread?id={threadId}
 *
 * Returns the ordered list of rumor posts that make up a thread. Used by the
 * thread permalink page and by the rumor card inline thread preview.
 *
 * Safe to call unauthenticated — the data is a subset of the public feed.
 * Response:
 *   { threadId: string, posts: Array<{ id, timestamp, headline, body, threadId }> }
 */

import type { APIRoute } from 'astro';
import feedData from '../../../data/theleague/schefter-feed.json';
import type { SchefterFeed, SchefterPost } from '../../../types/schefter';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

type RedisClient = {
  zrange: (key: string, start: number, stop: number) => Promise<unknown>;
  expire: (key: string, seconds: number) => Promise<unknown>;
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
    console.warn('[thread] Redis unavailable:', err);
    _redis = null;
    return null;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function pickPublicFields(p: SchefterPost) {
  return {
    id: p.id,
    timestamp: p.timestamp,
    headline: p.headline,
    body: p.body,
    threadId: p.threadId ?? null,
  };
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const threadId = url.searchParams.get('id');
  if (!threadId) return json({ error: 'id required' }, 400);

  // Fast path: if the feed JSON already has `threadId` stamped on posts we
  // can serve without touching Redis. Keeps the API usable even if the
  // Redis thread registry ever drifts.
  const feed = feedData as SchefterFeed;
  const feedMatches = feed.posts
    .filter((p) => p.threadId === threadId && p.transactionSubType === 'rumor_mill')
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (feedMatches.length > 0) {
    return json({
      threadId,
      posts: feedMatches.map(pickPublicFields),
    });
  }

  // Slow path: consult the Redis registry. Used when a scanner commit raced
  // ahead of a feed write, or when the feed has been cleaned up.
  const redis = await getRedis();
  if (!redis) return json({ threadId, posts: [] });

  try {
    const raw = await redis.zrange(`schefter:thread:${threadId}`, 0, -1);
    const ids = Array.isArray(raw) ? raw.map((m) => String(m)) : [];
    if (ids.length === 0) return json({ threadId, posts: [] });

    const byId = new Map(feed.posts.map((p) => [p.id, p]));
    const posts = ids
      .map((id) => byId.get(id))
      .filter((p): p is SchefterPost => !!p && p.transactionSubType === 'rumor_mill')
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map(pickPublicFields);

    return json({ threadId, posts });
  } catch (err) {
    console.error('[thread] Read error:', err);
    return json({ threadId, posts: [] });
  }
};
