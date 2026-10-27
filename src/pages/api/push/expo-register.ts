/**
 * POST   /api/push/expo-register  — store this phone's Expo push token
 * DELETE /api/push/expo-register  — forget it (sign-out, alerts turned off)
 *
 * The MFL Football app's half of /api/push/subscribe. It signs in with
 * `Authorization: Bearer`, which only `getMflLiveUser` reads, so that is the
 * reader here. Identity comes from the session, never the body.
 *
 * A phone belongs to the ACCOUNT, and alerts follow every team the account
 * has: each registration re-reads MFL's own `myleagues` list with the owner's
 * cookie (`listOwnerLeagues`, the app's league switcher) and re-indexes the account's teams (push-expo.ts). The app registers
 * on every launch, so a team traded away or a league left stops alerting.
 *
 * `delivering` is false when the session's league has no alert senders yet
 * (a league this site does not run), so the app can say so.
 */

import type { APIRoute } from 'astro';
import { getMflLiveUser } from '../../../utils/auth';
import { checkRateLimit } from '../../../utils/rate-limit';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { getLeagueById } from '../../../config/leagues';
import { listOwnerLeagues } from '../../../utils/live/owner-league';
import type { AuthUser } from '../../../utils/auth';
import {
  pushAccountKey,
  validateExpoToken,
  validatePlatform,
  saveExpoToken,
  removeExpoToken,
  indexAccountTeams,
  getIndexedLeagues,
} from '../../../utils/push-expo';
import type { MflLiveAppPushResponse } from '../../../../packages/shared-types/src/mfl-live-app-push';

const reply = (body: MflLiveAppPushResponse, status: number) =>
  json(body, status, JSON_HEADERS_NO_STORE);

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function sessionFor(request: Request) {
  const user = getMflLiveUser(request);
  if (!user) return { error: reply({ success: false, message: 'Sign in to turn on alerts.' }, 401) };
  const account = pushAccountKey(user);
  if (!account || !user.franchiseId || !user.leagueId) {
    return { error: reply({ success: false, message: 'No team is linked to this sign-in.' }, 403) };
  }
  return { user, account };
}

/**
 * Index every team the account has. Best-effort: the token is already saved,
 * and the session's own team is always indexed even when MFL is down. Only a
 * complete `myleagues` answer may un-index a league.
 */
async function indexTeams(user: AuthUser, account: string): Promise<void> {
  // The same list the app's league switcher shows (owner-league.ts).
  const mine = await listOwnerLeagues(user).catch(() => null);
  const teams = [
    { leagueId: user.leagueId, franchiseId: user.franchiseId },
    ...(mine?.ok ? mine.leagues : []).map((l) => ({ leagueId: l.leagueId, franchiseId: l.franchiseId })),
  ];
  const previous = mine?.ok ? await getIndexedLeagues(account) : [];
  await indexAccountTeams(account, teams, previous);
}

export const POST: APIRoute = async ({ request }) => {
  const { user, account, error } = sessionFor(request);
  if (!user) return error;

  const limit = await checkRateLimit('push-expo-register', account, 20, 3600);
  if (!limit.allowed) return reply({ success: false, message: 'Too many requests — try again later.' }, 429);

  const body = await readBody(request);
  const token = validateExpoToken(body?.token);
  const platform = validatePlatform(body?.platform);
  if (!token || !platform) {
    return reply(
      { success: false, message: 'Expected { token: "ExponentPushToken[…]", platform: "android" | "ios" }.' },
      400,
    );
  }

  try {
    const saved = await saveExpoToken(account, token, platform);
    if (!saved) return reply({ success: false, message: 'Alert storage is unavailable right now — try again later.' }, 503);
    await indexTeams(user, account).catch((e) => console.warn('[push/expo-register] index failed:', e));
    return reply({ success: true, delivering: Boolean(getLeagueById(user.leagueId)) }, 200);
  } catch (e) {
    console.error('[push/expo-register] error:', e);
    return reply({ success: false, message: 'Internal server error.' }, 500);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const { user, account, error } = sessionFor(request);
  if (!user) return error;

  const body = await readBody(request);
  const token = validateExpoToken(body?.token);
  if (!token) return reply({ success: false, message: 'Expected { token: "ExponentPushToken[…]" }.' }, 400);

  try {
    const removed = await removeExpoToken(account, token);
    if (!removed) return reply({ success: false, message: 'Alert storage is unavailable right now — try again later.' }, 503);
    return reply({ success: true }, 200);
  } catch (e) {
    console.error('[push/expo-register] delete error:', e);
    return reply({ success: false, message: 'Internal server error.' }, 500);
  }
};
