/**
 * POST /api/schefter/rumor-impression
 *
 * Records a "this rumor was seen" event (Phase 10 — Tip of the Week). The
 * weekly award script reads these counters to pick the most-read rumor of
 * the previous week and awards badges to the tipsters that seeded it.
 *
 * Body:  { postId: string }
 * State: schefter:rumor:impressions:{postId} INCR + 30d TTL
 *
 * No auth required (impression data is non-sensitive). Rejects unknown
 * post ids to prevent the key space from getting flooded.
 *
 * Clients should dedupe per-session (e.g. via sessionStorage + IntersectionObserver)
 * so a user scrolling past the same card twice doesn't inflate the counter.
 */

import type { APIRoute } from 'astro';
import { resolveSchefterLeague, getSchefterFeed } from '../../../utils/schefter-league';
import type { LeagueDefinition } from '../../../config/leagues';
import { getRedis } from '../../../utils/redis-client';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../../utils/api-response';
import { globalSchefterKey } from '../../../../scripts/lib/schefter-keys.mjs';

export const prerender = false;

// postId-keyed and shared across leagues by design — see schefter-keys.mjs.
const IMPRESSION_KEY_PREFIX = globalSchefterKey('rumorImpressions');
const IMPRESSION_TTL_SEC = 30 * 24 * 60 * 60;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function isRumorPostId(postId: string, league: LeagueDefinition): boolean {
  const feed = getSchefterFeed(league);
  return feed.posts.some(
    (p) => p.id === postId && p.transactionSubType === 'rumor_mill',
  );
}

export const POST: APIRoute = async ({ request }) => {
  // Public route — league from ?league= (slug or navSlug), TheLeague default.
  const league = resolveSchefterLeague({ url: new URL(request.url) });
  if (!league) return json({ error: 'bad_league' }, 400);

  let body: { postId?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  const postId = body.postId;
  if (typeof postId !== 'string' || postId.length === 0) {
    return json({ error: 'postId required' }, 400);
  }

  // Shape check — only allow ids that match the rumor-post id scheme. Prevents
  // callers from flooding Redis with arbitrary keys.
  if (!/^sf_rumor_\d+_[a-z0-9]+$/i.test(postId)) {
    return json({ error: 'bad_post_id' }, 400);
  }

  if (!isRumorPostId(postId, league)) {
    // Unknown id — don't write. The feed is the authoritative registry of
    // live rumor posts.
    return json({ ok: true, recorded: false });
  }

  const redis = await getRedis();
  if (!redis) return json({ ok: true, recorded: false });

  try {
    const key = `${IMPRESSION_KEY_PREFIX}${postId}`;
    const next = await redis.incr(key);
    if (next === 1) await redis.expire(key, IMPRESSION_TTL_SEC);
  } catch (err) {
    console.error('[rumor-impression] Write error:', err);
    return json({ ok: true, recorded: false });
  }

  return json({ ok: true, recorded: true });
};
