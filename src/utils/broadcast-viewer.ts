/**
 * Who is watching the broadcast: a signed-in owner, or a paired TV.
 *
 * The ONLY reader of a TV pass, and it may be called only from the board's own
 * read-only pages and polls
 * (pinned by tests/broadcast-tv-pass-scope.test.ts):
 *
 *  - `src/pages/live/broadcast/index.astro`, the board's MFL Live home;
 *  - `src/pages/live/broadcast/overlay.astro`, the same board as the TV app's
 *    see-through score overlay;
 *  - `src/pages/api/broadcast-live.ts`, the board's poll.
 *
 * A pass resolves to the owner's full `AuthUser`, MFL cookie included,
 * because the board reads MFL as that owner. That is exactly why it must stop
 * at the board: handed to any other endpoint, a TV in a living room would be
 * able to do whatever the owner's session can — lineups, trades, the lot.
 */
import type { AuthUser } from './auth';
import { getMflLiveUser } from './auth';
import { readPass, TV_PASS_COOKIE, type TvPass } from './broadcast-tv-pairing';
import { getPairingStore } from './broadcast-tv-store';

export interface BroadcastViewer {
  user: AuthUser;
  /** `session` — a signed-in owner; `tv` — a paired television. */
  via: 'session' | 'tv';
  /** Present when `via === 'tv'`. */
  pass?: TvPass;
}

export function readTvPassToken(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === TV_PASS_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * The session wins over a pass. An owner who signs in on the TV itself gets
 * their own session's view, and a pass left on a shared laptop never
 * outranks the person actually signed in on it.
 */
export async function getBroadcastViewer(request: Request): Promise<BroadcastViewer | null> {
  const user = getMflLiveUser(request);
  if (user) return { user, via: 'session' };

  const token = readTvPassToken(request);
  if (!token) return null;
  try {
    const store = await getPairingStore();
    if (!store) return null;
    const pass = await readPass(store, token);
    return pass ? { user: pass.user, via: 'tv', pass } : null;
  } catch {
    return null;
  }
}
