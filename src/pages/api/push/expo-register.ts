/**
 * POST   /api/push/expo-register  — store this phone's Expo push token
 * DELETE /api/push/expo-register  — forget it (sign-out, alerts turned off)
 *
 * The MFL Live app's half of /api/push/subscribe. It signs in with
 * `Authorization: Bearer`, which only `getMflLiveUser` reads, so that is the
 * reader here. League + franchise come from the session, never the body.
 *
 * A league this site does not run is stored too (`delivering: false`): it has
 * no alert senders yet, and the app says so rather than going quiet.
 */

import type { APIRoute } from 'astro';
import { getMflLiveUser } from '../../../utils/auth';
import { checkRateLimit } from '../../../utils/rate-limit';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { getLeagueById } from '../../../config/leagues';
import {
  validateExpoToken,
  validatePlatform,
  saveExpoToken,
  removeExpoToken,
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
  if (!user.franchiseId || !user.leagueId) {
    return { error: reply({ success: false, message: 'No team is linked to this sign-in.' }, 403) };
  }
  return { user };
}

export const POST: APIRoute = async ({ request }) => {
  const { user, error } = sessionFor(request);
  if (!user) return error;

  const limit = await checkRateLimit('push-expo-register', `${user.leagueId}:${user.franchiseId}`, 20, 3600);
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
    const saved = await saveExpoToken(user.leagueId, user.franchiseId, token, platform, user.id);
    if (!saved) return reply({ success: false, message: 'Alert storage is unavailable right now — try again later.' }, 503);
    return reply({ success: true, delivering: Boolean(getLeagueById(user.leagueId)) }, 200);
  } catch (e) {
    console.error('[push/expo-register] error:', e);
    return reply({ success: false, message: 'Internal server error.' }, 500);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const { user, error } = sessionFor(request);
  if (!user) return error;

  const body = await readBody(request);
  const token = validateExpoToken(body?.token);
  if (!token) return reply({ success: false, message: 'Expected { token: "ExponentPushToken[…]" }.' }, 400);

  try {
    const removed = await removeExpoToken(user.leagueId, user.franchiseId, token);
    if (!removed) return reply({ success: false, message: 'Alert storage is unavailable right now — try again later.' }, 503);
    return reply({ success: true }, 200);
  } catch (e) {
    console.error('[push/expo-register] delete error:', e);
    return reply({ success: false, message: 'Internal server error.' }, 500);
  }
};
