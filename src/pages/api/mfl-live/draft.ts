import type { APIRoute } from 'astro';
import { appJson, requireOwnerLeague } from '../../../utils/live/owner-league';
import { readMflLiveDraft } from '../../../utils/live/mfl-live-draft';

export const prerender = false;

/**
 * The MFL Football app's draft room: the board, who is on the clock, your next
 * pick and your MFL pre-draft list, for any MFL league the account is in.
 *
 * `requireOwnerLeague` is the whole authorisation (401/400/403/503), and the
 * team the room is for is the one MFL lists for THIS account in that league.
 * Every read uses the owner's own MFL cookie (`user.id`).
 *
 * A board MFL would not give us is a 502 with a sentence, never an empty
 * draft: "no draft yet" and "couldn't read the draft" must not look alike.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;

  const room = await readMflLiveDraft(gate.league, gate.user.id).catch(() => null);
  if (!room) {
    return appJson({ ok: false, error: 'MyFantasyLeague didn’t send the draft board just now. Pull down to try again.' }, 502);
  }
  return appJson(room);
};
