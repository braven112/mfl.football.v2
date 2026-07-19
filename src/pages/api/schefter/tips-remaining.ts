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
import { getRedis } from '../../../utils/redis-client';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../../utils/api-response';
import { schefterKey } from '../../../../scripts/lib/schefter-keys.mjs';
import { resolveSchefterLeague, leagueHasSchefterTips } from '../../../utils/schefter-league';

export const prerender = false;

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_TTL_SEC = 24 * 60 * 60;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!user.franchiseId) return json({ error: 'no_franchise' }, 403);

  const league = resolveSchefterLeague({ user, url: new URL(request.url) });
  if (!league) return json({ error: 'bad_league' }, 400);
  if (!leagueHasSchefterTips(league)) return json({ error: 'feature_disabled' }, 404);

  let hashedOwnerId: string;
  try {
    hashedOwnerId = hashTipsterId(user.id);
  } catch {
    return json({ error: 'server_misconfigured' }, 500);
  }

  const redis = await getRedis();
  if (!redis) {
    // Degraded mode: we can't read the counter, but we shouldn't block the UI
    // from rendering. Return the optimistic max WITH a degraded flag so the
    // chip can say "couldn't confirm" instead of a confident "3 left"; the
    // submit endpoint still enforces the cap when Redis comes back.
    return json({ used: 0, remaining: RATE_LIMIT_MAX, max: RATE_LIMIT_MAX, resetsAt: null, degraded: true });
  }

  const key = `${schefterKey(league.navSlug, 'tips:ratelimit:')}${hashedOwnerId}`;
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
