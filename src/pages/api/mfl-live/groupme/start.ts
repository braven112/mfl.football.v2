import type { APIRoute } from 'astro';
import {
  GROUPME_COOKIE_PATH,
  GROUPME_STATE_COOKIE,
  STATE_TTL_SECONDS,
  groupMeAuthorizeUrl,
  isLiveState,
  isWellFormedState,
} from '../../../../utils/live/groupme-owner-auth';
import { signInPage } from '../../../../utils/live/groupme-sign-in-page';

export const prerender = false;

/**
 * Step 2 of an owner's GroupMe sign-in (src/utils/live/groupme-owner-auth.ts),
 * opened in the phone's browser from the link the chat POST handed the app.
 *
 * A BROWSER route, so it carries no app session — it is exempt from
 * requireOwnerLeague in tests/mfl-live-owner-league.test.ts. What stands in
 * for the session is the one-time state: minted only by a signed-in chat POST,
 * random, ten minutes, and single use at the callback.
 */
export const GET: APIRoute = async ({ url }) => {
  const state = url.searchParams.get('s');
  if (!isWellFormedState(state) || !(await isLiveState(state))) {
    return signInPage(
      'This link has expired',
      'Go back to the MFL Football app and tap Send again to get a new one.',
      400,
    );
  }
  const cookie = [
    `${GROUPME_STATE_COOKIE}=${state}`,
    `Path=${GROUPME_COOKIE_PATH}`,
    `Max-Age=${STATE_TTL_SECONDS}`,
    'HttpOnly',
    'Secure',
    // Lax, not Strict: GroupMe's redirect back is a top-level navigation
    // from another site, which Strict would send without the cookie.
    'SameSite=Lax',
  ].join('; ');
  return new Response(null, {
    status: 302,
    headers: { Location: groupMeAuthorizeUrl(), 'Set-Cookie': cookie, 'Cache-Control': 'no-store' },
  });
};
