import type { APIRoute } from 'astro';
import { getGroupMeUser } from '../../../../utils/groupme-client';
import {
  GROUPME_COOKIE_PATH,
  GROUPME_STATE_COOKIE,
  consumeState,
  isWellFormedState,
  saveGroupMeLink,
} from '../../../../utils/live/groupme-owner-auth';
import { signInPage } from '../../../../utils/live/groupme-sign-in-page';

export const prerender = false;

/**
 * Step 3 of an owner's GroupMe sign-in (src/utils/live/groupme-owner-auth.ts):
 * GroupMe redirects here with `?access_token=`. This URL is the one registered
 * on our GroupMe application, so it must not move.
 *
 * A BROWSER route with no app session (exempt in
 * tests/mfl-live-owner-league.test.ts): the owner is known only from the state
 * cookie the start route set, which is consumed here and cannot be replayed.
 */
export const GET: APIRoute = async ({ url, cookies }) => {
  const clear = {
    'Set-Cookie': `${GROUPME_STATE_COOKIE}=; Path=${GROUPME_COOKIE_PATH}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
  };
  const state = cookies.get(GROUPME_STATE_COOKIE)?.value;
  const account = isWellFormedState(state) ? await consumeState(state) : null;
  if (!account) {
    return signInPage(
      'This sign-in has expired',
      'Go back to the MFL Football app and tap Send again to start over.',
      400,
      clear,
    );
  }

  const token = (url.searchParams.get('access_token') ?? '').trim();
  const me = token && /^[A-Za-z0-9]{10,200}$/.test(token) ? await getGroupMeUser(token).catch(() => null) : null;
  if (!me) {
    return signInPage(
      'GroupMe did not sign you in',
      'Go back to the MFL Football app and tap Send to try again.',
      400,
      clear,
    );
  }

  const saved = await saveGroupMeLink(account, { token, userId: me.id, name: me.name });
  if (!saved) {
    return signInPage('Something went wrong', 'We could not save your sign-in. Try again in a minute.', 503, clear);
  }
  return signInPage(
    `Signed in as ${me.name}`,
    'Go back to the MFL Football app. Your messages now post to GroupMe as you.',
    200,
    clear,
  );
};
