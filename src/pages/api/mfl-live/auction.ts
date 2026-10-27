import type { APIRoute } from 'astro';
import { appJson, requireOwnerLeague } from '../../../utils/live/owner-league';
import { readMflLiveAuction } from '../../../utils/live/mfl-live-auction';

export const prerender = false;

/**
 * The MFL Football app's auction room: who is up for bids, the high bids,
 * what the owner's team has won and can still spend, for any MFL league the
 * account is in. Read-only: MFL has no API for bidding, so the app opens
 * MFL's own Auction Bid page (`bidUrl`) for that.
 *
 * `requireOwnerLeague` is the whole authorisation, and the team is the one
 * MFL lists for THIS account. Every read uses the owner's own MFL cookie.
 * An auction MFL would not give us is a 502 with a sentence, never an empty
 * room.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;

  const room = await readMflLiveAuction(gate.league, gate.user.id).catch(() => null);
  if (!room) {
    return appJson({ ok: false, error: 'MyFantasyLeague didn’t send the auction just now. Pull down to try again.' }, 502);
  }
  return appJson(room);
};
