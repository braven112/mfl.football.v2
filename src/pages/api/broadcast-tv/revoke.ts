import type { APIRoute } from 'astro';
import { getMflLiveUser } from '../../../utils/auth';
import { ownerKeyFor, revokePass, revokePassByToken, TV_PASS_COOKIE } from '../../../utils/broadcast-tv-pairing';
import { getPairingStore } from '../../../utils/broadcast-tv-store';
import { readTvPassToken } from '../../../utils/broadcast-viewer';

export const prerender = false;

/**
 * Unpair a TV — two ways in, and neither can reach another owner's TVs.
 *
 *  - `{ id }` from a signed-in owner removes one of THEIR passes. The id is
 *    looked up only in the session owner's own index.
 *  - `{ self: true }` from a TV removes the pass it is holding, and clears the
 *    cookie. A TV can always unpair itself; it can never unpair anything else.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { id?: unknown; self?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false }, 400);
  }

  const store = await getPairingStore();
  if (!store) return json({ ok: false }, 503);

  if (body.self === true) {
    const token = readTvPassToken(request);
    if (token) await revokePassByToken(store, token);
    cookies.delete(TV_PASS_COOKIE, { path: '/' });
    return json({ ok: true });
  }

  const user = getMflLiveUser(request);
  if (!user) return json({ ok: false }, 401);
  if (typeof body.id !== 'string' || !body.id) return json({ ok: false }, 400);
  const ok = await revokePass(store, ownerKeyFor(user), body.id);
  return json({ ok }, ok ? 200 : 404);
};
