/**
 * POST /api/push/subscribe
 *
 * Store the caller's browser push subscription for their own franchise.
 *
 * Identity (league + franchise) comes EXCLUSIVELY from the signed session
 * JWT via getAuthUser() — the body only carries the PushSubscription
 * object. Degrades with a clear 503 when VAPID keys or Redis storage are
 * not configured.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { checkRateLimit } from '../../../utils/rate-limit';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { isPushConfigured } from '../../../utils/push-sender';
import {
  validateSubscription,
  saveSubscription,
} from '../../../utils/push-subscriptions';

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
    return json({ success: false, message: 'Authentication required. Please sign in.' }, 401, JSON_HEADERS_NO_STORE);
  }
  if (!user.franchiseId || !user.leagueId) {
    return json({ success: false, message: 'No franchise associated with your account.' }, 403, JSON_HEADERS_NO_STORE);
  }

  if (!isPushConfigured()) {
    return json(
      { success: false, message: 'Push notifications are not configured on this server yet.' },
      503,
      JSON_HEADERS_NO_STORE,
    );
  }

  const limit = await checkRateLimit('push-subscribe', `${user.leagueId}:${user.franchiseId}`, 20, 3600);
  if (!limit.allowed) {
    return json({ success: false, message: 'Too many requests — try again later.' }, 429, JSON_HEADERS_NO_STORE);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: 'Invalid JSON body.' }, 400, JSON_HEADERS_NO_STORE);
  }

  const subscription = validateSubscription((body as { subscription?: unknown })?.subscription);
  if (!subscription) {
    return json(
      { success: false, message: 'Invalid subscription — expected { subscription: { endpoint, keys: { p256dh, auth } } }.' },
      400,
      JSON_HEADERS_NO_STORE,
    );
  }

  try {
    const saved = await saveSubscription(user.leagueId, user.franchiseId, subscription, user.id);
    if (!saved) {
      return json(
        { success: false, message: 'Notification storage is unavailable right now — try again later.' },
        503,
        JSON_HEADERS_NO_STORE,
      );
    }
    return json({ success: true }, 200, JSON_HEADERS_NO_STORE);
  } catch (e) {
    console.error('[push/subscribe] error:', e);
    return json({ success: false, message: 'Internal server error.' }, 500, JSON_HEADERS_NO_STORE);
  }
};
