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
import type { SchefterPost } from '../../../types/schefter';
import { resolveSchefterLeague, getSchefterFeed } from '../../../utils/schefter-league';
import { getRedis } from '../../../utils/redis-client';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../../utils/api-response';
import { globalSchefterKey } from '../../../../scripts/lib/schefter-keys.mjs';

export const prerender = false;

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

  // Public route — league from ?league= (slug or navSlug), TheLeague default.
  const league = resolveSchefterLeague({ url });
  if (!league) return json({ error: 'bad_league' }, 400);

  // Fast path: if the feed JSON already has `threadId` stamped on posts we
  // can serve without touching Redis. Keeps the API usable even if the
  // Redis thread registry ever drifts.
  const feed = getSchefterFeed(league);
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
    const raw = await redis.zrange(globalSchefterKey('thread', threadId), 0, -1);
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
