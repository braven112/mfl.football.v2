import type { APIRoute } from 'astro';
import { getMflLiveUser } from '../../../utils/auth';
import { approvePairing, normalizeUserCode } from '../../../utils/broadcast-tv-pairing';
import { getPairingStore } from '../../../utils/broadcast-tv-store';
import { BROADCAST_LEAGUE_COOKIE } from '../../../utils/broadcast-selection';
import { checkRateLimit } from '../../../utils/rate-limit';

export const prerender = false;

/**
 * The phone saying yes to the code on the TV.
 *
 * Signed-in owners only, and the pass is minted for the SESSION's owner —
 * nothing in the body can name someone else. The TV inherits the league set
 * this phone's broadcast is watching, read from this phone's own cookie.
 *
 * Rate-limited per owner: six characters off a 29-letter alphabet is 594
 * million codes, which is plenty against guessing only while guessing is slow.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const POST: APIRoute = async ({ request, cookies }) => {
  const user = getMflLiveUser(request);
  if (!user) return json({ result: 'signed-out' }, 401);

  const limit = await checkRateLimit('broadcast-tv-approve', `${user.leagueId}:${user.franchiseId}`, 20, 10 * 60);
  if (!limit.allowed) return json({ result: 'slow-down' }, 429);

  let code: string | null = null;
  try {
    const body = (await request.json()) as { code?: unknown };
    code = normalizeUserCode(typeof body.code === 'string' ? body.code : null);
  } catch {
    /* falls through to the invalid answer */
  }
  if (!code) return json({ result: 'invalid' }, 400);

  const store = await getPairingStore();
  if (!store) return json({ result: 'unavailable' }, 503);

  const result = await approvePairing(store, code, user, {
    leagues: cookies.get(BROADCAST_LEAGUE_COOKIE)?.value ?? null,
  });
  return json({ result }, result === 'approved' ? 200 : 410);
};
