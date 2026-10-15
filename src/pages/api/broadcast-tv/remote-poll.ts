import type { APIRoute } from 'astro';
import { passHashOfToken } from '../../../utils/broadcast-tv-pairing';
import { getPairingStore } from '../../../utils/broadcast-tv-store';
import { readRemoteState } from '../../../utils/broadcast-tv-remote';
import { readTvPassToken } from '../../../utils/broadcast-viewer';

export const prerender = false;

/**
 * The TV's fast check for a remote command, about once a second, and ONLY
 * while the board's normal poll has said a phone has the remote open
 * (docs/plans/broadcast-handheld.md, Phase 4).
 *
 * It never resolves the pass into its owner: it reads one record stored
 * under the cookie's hash and returns a closed-list command or nothing. A
 * made-up cookie hashes to a key nobody wrote, so it reads "inactive".
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const INACTIVE = { active: false, seq: 0, command: null };

export const GET: APIRoute = async ({ request }) => {
  const token = readTvPassToken(request);
  if (!token || token.length > 128) return json(INACTIVE, 401);
  const store = await getPairingStore();
  if (!store) return json(INACTIVE, 503);
  try {
    return json(await readRemoteState(store, passHashOfToken(token)));
  } catch {
    return json(INACTIVE);
  }
};
