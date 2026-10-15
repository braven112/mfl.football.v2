import type { APIRoute } from 'astro';
import { pollPairing, PASS_TTL_S, TV_PASS_COOKIE } from '../../../utils/broadcast-tv-pairing';
import { getPairingStore } from '../../../utils/broadcast-tv-store';

export const prerender = false;

/**
 * The TV asking "has anyone approved me yet?" every few seconds from `/tv`.
 *
 * The device code is the TV's secret and arrives in the BODY, never the URL,
 * so it stays out of access logs. On approval the pass is set as an HttpOnly
 * cookie on THIS response and nowhere else — the TV's page never sees the
 * token, it only learns to navigate to the board.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const POST: APIRoute = async ({ request, cookies, url }) => {
  let deviceCode = '';
  try {
    const body = (await request.json()) as { deviceCode?: unknown };
    if (typeof body.deviceCode === 'string') deviceCode = body.deviceCode;
  } catch {
    return json({ status: 'expired' }, 400);
  }

  const store = await getPairingStore();
  if (!store) return json({ status: 'unavailable' }, 503);

  const result = await pollPairing(store, deviceCode);
  if (result.status !== 'approved') return json({ status: result.status });

  cookies.set(TV_PASS_COOKIE, result.passToken, {
    path: '/',
    maxAge: PASS_TTL_S,
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
  });
  return json({ status: 'approved', next: '/live/broadcast' });
};
