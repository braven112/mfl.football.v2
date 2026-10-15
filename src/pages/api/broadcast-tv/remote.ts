import type { APIRoute } from 'astro';
import { getMflLiveUser } from '../../../utils/auth';
import { listPasses, ownerKeyFor } from '../../../utils/broadcast-tv-pairing';
import { getPairingStore } from '../../../utils/broadcast-tv-store';
import { sendRemoteCommand } from '../../../utils/broadcast-tv-remote';
import { checkRateLimit } from '../../../utils/rate-limit';

export const prerender = false;

/**
 * The phone side of the TV remote (docs/plans/broadcast-handheld.md, Phase 4).
 *
 *  - GET lists the signed-in owner's paired TVs, for the remote's picker.
 *  - POST `{ passId, command }` sends one display command to one of them.
 *
 * Auth is the owner's SESSION only. A TV pass is never accepted here: a TV
 * can be told what to show, it can never tell anything else what to do. The
 * pass id is resolved only inside this owner's own TV list
 * (`passHashForOwner`), and the command is a closed-list string, validated
 * here and again on the TV (`broadcast-tv-remote.ts`).
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async ({ request }) => {
  const user = getMflLiveUser(request);
  if (!user) return json({ tvs: [] }, 401);
  const store = await getPairingStore();
  if (!store) return json({ tvs: [] }, 503);
  return json({ tvs: await listPasses(store, ownerKeyFor(user)) });
};

export const POST: APIRoute = async ({ request }) => {
  const user = getMflLiveUser(request);
  if (!user) return json({ ok: false }, 401);

  // A button press each, a few a second at the very most. Keyed on the MFL
  // user id, since both registry leagues have a franchise 0001.
  const limit = await checkRateLimit('broadcast-remote', user.id, 120, 60);
  if (!limit.allowed) return json({ ok: false, error: 'Slow down' }, 429);

  let body: { passId?: unknown; command?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false }, 400);
  }
  const { passId, command } = body;
  if (typeof passId !== 'string' || !passId || passId.length > 32) return json({ ok: false }, 400);
  if (typeof command !== 'string' || !command) return json({ ok: false }, 400);

  const store = await getPairingStore();
  if (!store) return json({ ok: false }, 503);

  const result = await sendRemoteCommand(store, ownerKeyFor(user), passId, command);
  if (result === 'invalid') return json({ ok: false }, 400);
  if (result === 'not-found') return json({ ok: false }, 404);
  return json({ ok: true });
};
