import type { APIRoute } from 'astro';
import { appJson, requireOwnerLeague } from '../../../utils/live/owner-league';
import { readMflLiveDraftPool } from '../../../utils/live/mfl-live-draft';

export const prerender = false;

/**
 * The players still available in the app's draft room, best ADP first, for
 * any MFL league the account is in. Separate from `/api/mfl-live/draft` so the
 * board can be read every few seconds during a live draft without re-sending
 * hundreds of players each time; the app drops newly taken players itself.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;

  const pool = await readMflLiveDraftPool(gate.league, gate.user.id).catch(() => null);
  if (!pool) {
    return appJson({ ok: false, error: 'MyFantasyLeague didn’t send the available players just now. Pull down to try again.' }, 502);
  }
  return appJson(pool);
};
