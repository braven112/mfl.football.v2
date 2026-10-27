/**
 * POST /api/push/expo-test
 *
 * The app's "send me a test" button: the same 'system-test' alert as
 * /api/push/test, through the same door (sendPushToFranchise), so it proves
 * the path a real alert takes. Bearer sign-in, hence `getMflLiveUser`.
 */

import type { APIRoute } from 'astro';
import { getMflLiveUser } from '../../../utils/auth';
import { checkRateLimit } from '../../../utils/rate-limit';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { getLeagueById } from '../../../config/leagues';
import { sendPushToFranchise } from '../../../utils/push-sender';
import type { MflLiveAppPushResponse } from '../../../../packages/shared-types/src/mfl-live-app-push';

const reply = (body: MflLiveAppPushResponse, status: number) =>
  json(body, status, JSON_HEADERS_NO_STORE);

export const POST: APIRoute = async ({ request }) => {
  const user = getMflLiveUser(request);
  if (!user) return reply({ success: false, message: 'Sign in to test alerts.' }, 401);
  if (!user.franchiseId || !user.leagueId) {
    return reply({ success: false, message: 'No team is linked to this sign-in.' }, 403);
  }

  // A league this site does not run is sent to as well (app only, push-sender.ts).
  const league = getLeagueById(user.leagueId);

  const limit = await checkRateLimit('push-expo-test', `${user.leagueId}:${user.franchiseId}`, 5, 600);
  if (!limit.allowed) {
    return reply({ success: false, message: 'Too many test alerts — try again in a few minutes.' }, 429);
  }

  try {
    const result = await sendPushToFranchise(
      user.leagueId,
      user.franchiseId,
      {
        title: 'Test alert',
        body: league ? `Alerts are working for your ${league.name} team.` : 'Alerts are working on this phone.',
        url: '/notifications',
        tag: 'push-test',
      },
      'system-test',
    );
    if (result.sent === 0) {
      return reply(
        {
          success: false,
          message:
            result.total === 0
              ? 'This phone is not registered for alerts yet.'
              : 'The alert could not be delivered — try turning alerts off and on again.',
        },
        200,
      );
    }
    return reply({ success: true }, 200);
  } catch (e) {
    console.error('[push/expo-test] error:', e);
    return reply({ success: false, message: 'Internal server error.' }, 500);
  }
};
