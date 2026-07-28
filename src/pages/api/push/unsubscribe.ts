/**
 * POST /api/push/unsubscribe
 *
 * Remove one of the caller's stored push subscriptions (by endpoint).
 * Scoped to the session's own league + franchise — a caller can never
 * delete another franchise's subscriptions. Idempotent: removing an
 * endpoint that isn't stored still succeeds.
 *
 * Deliberately does NOT require VAPID config — owners must be able to
 * clean up stored subscriptions even if the keys were rotated or unset.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { checkRateLimit } from '../../../utils/rate-limit';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { removeSubscription } from '../../../utils/push-subscriptions';

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
    return json({ success: false, message: 'Authentication required. Please sign in.' }, 401, JSON_HEADERS_NO_STORE);
  }
  if (!user.franchiseId || !user.leagueId) {
    return json({ success: false, message: 'No franchise associated with your account.' }, 403, JSON_HEADERS_NO_STORE);
  }

  const limit = await checkRateLimit('push-unsubscribe', `${user.leagueId}:${user.franchiseId}`, 20, 3600);
  if (!limit.allowed) {
    return json({ success: false, message: 'Too many requests — try again later.' }, 429, JSON_HEADERS_NO_STORE);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: 'Invalid JSON body.' }, 400, JSON_HEADERS_NO_STORE);
  }

  const endpoint = (body as { endpoint?: unknown })?.endpoint;
  if (typeof endpoint !== 'string' || !endpoint.trim() || endpoint.length > 2048) {
    return json({ success: false, message: 'Invalid endpoint.' }, 400, JSON_HEADERS_NO_STORE);
  }

  try {
    const removed = await removeSubscription(user.leagueId, user.franchiseId, endpoint.trim());
    if (!removed) {
      return json(
        { success: false, message: 'Notification storage is unavailable right now — try again later.' },
        503,
        JSON_HEADERS_NO_STORE,
      );
    }
    return json({ success: true }, 200, JSON_HEADERS_NO_STORE);
  } catch (e) {
    console.error('[push/unsubscribe] error:', e);
    return json({ success: false, message: 'Internal server error.' }, 500, JSON_HEADERS_NO_STORE);
  }
};
