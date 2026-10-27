import type { APIRoute } from 'astro';
import { appJson, requireOwnerLeague } from '../../../utils/live/owner-league';
import { readMflLiveTeam } from '../../../utils/live/mfl-live-team';

export const prerender = false;

/**
 * The MFL Football app's My Team page, for any MFL league the account is in.
 *
 * `requireOwnerLeague` is the whole authorisation: it answers 401/400/403/503
 * itself, and the team acted on is the one MFL lists for THIS account in that
 * league, never one named by the request. Every read uses the owner's own MFL
 * cookie (`user.id`).
 *
 * A roster MFL would not give us is a 502 with a sentence, never an empty
 * team: "you have no players" and "we couldn't read your players" must not
 * look alike (docs/claude/rules/lineups.md).
 */
export const GET: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;

  const page = await readMflLiveTeam(gate.league, gate.user.id).catch(() => null);
  if (!page) {
    return appJson({ ok: false, error: 'MyFantasyLeague didn’t send your roster just now. Pull down to try again.' }, 502);
  }
  return appJson(page);
};
