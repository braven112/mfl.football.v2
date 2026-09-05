/**
 * POST /api/push/test
 *
 * Send the caller a test notification on every device they've enabled —
 * the "did it actually work?" button on the notification settings page.
 * Sends only to the session's own league + franchise.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { checkRateLimit } from '../../../utils/rate-limit';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { getLeagueById } from '../../../config/leagues';
import { isPushConfigured, sendPushToFranchise } from '../../../utils/push-sender';
import { leaguePushIcon } from '../../../utils/push-notify-trade';

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

  const limit = await checkRateLimit('push-test', `${user.leagueId}:${user.franchiseId}`, 5, 600);
  if (!limit.allowed) {
    return json({ success: false, message: 'Too many test notifications — try again in a few minutes.' }, 429, JSON_HEADERS_NO_STORE);
  }

  try {
    const league = getLeagueById(user.leagueId);
    const leagueName = league?.name ?? 'your league';
    const result = await sendPushToFranchise(user.leagueId, user.franchiseId, {
      title: 'Test notification',
      body: `Push notifications are working for your ${leagueName} team. This is what a trade-offer alert will feel like.`,
      url: league ? `/${league.slug}/notifications` : '/',
      tag: 'push-test',
      icon: leaguePushIcon(league?.navSlug ?? 'theleague'),
    });

    if (result.total === 0) {
      return json(
        { success: false, message: 'No devices are subscribed yet — enable notifications first.' },
        200,
        JSON_HEADERS_NO_STORE,
      );
    }
    if (result.sent === 0) {
      return json(
        {
          success: false,
          message: 'Delivery failed on every subscribed device — try disabling and re-enabling notifications.',
          ...result,
        },
        200,
        JSON_HEADERS_NO_STORE,
      );
    }
    return json({ success: true, ...result }, 200, JSON_HEADERS_NO_STORE);
  } catch (e) {
    console.error('[push/test] error:', e);
    return json({ success: false, message: 'Internal server error.' }, 500, JSON_HEADERS_NO_STORE);
  }
};
