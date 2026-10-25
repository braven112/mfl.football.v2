/**
 * Owner Map — set or clear one team's hometown.
 *
 * POST /api/owner-map/hometown?league=<slug>
 *   { franchiseId, name, region }  → saves that bundled place
 *   { franchiseId, clear: true }   → removes the team's hometown
 *
 * An owner may set their OWN team; the league's commissioner may set any team
 * in it. The league always comes from the session; `?league=` is a check
 * that the page the request came from is the session's league, never an
 * input (both leagues have a franchise 0001).
 *
 * Only a name and region are accepted. The coordinates come from the bundled
 * place list (src/utils/owner-hometowns.ts#findPlace), never from the request.
 */
import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdminForLeague } from '../../../utils/auth';
import { getLeagueById } from '../../../config/leagues';
import { handledFailure, json, unauthorized } from '../../../utils/api-response';
import { findPlace, writeHometown } from '../../../utils/owner-hometowns';

export const prerender = false;

const FRANCHISE_ID = /^\d{4}$/;

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) return unauthorized({ success: false, message: 'Sign in to set a hometown.' });
  const league = user.leagueId ? getLeagueById(user.leagueId) : null;
  if (!league) return unauthorized({ success: false, message: 'This session has no recognized league.' });
  const requested = new URL(request.url).searchParams.get('league');
  if (requested && requested !== league.slug) {
    return unauthorized({ success: false, message: `You're signed in to a different league than this page.` });
  }

  let body: { franchiseId?: unknown; name?: unknown; region?: unknown; clear?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: 'Bad request.' }, 400);
  }
  const franchiseId = typeof body.franchiseId === 'string' ? body.franchiseId : '';
  if (!FRANCHISE_ID.test(franchiseId)) return json({ success: false, message: 'Unknown team.' }, 400);

  const isCommissioner = isCommissionerOrAdminForLeague(user, league.id);
  const setBy = user.franchiseId === franchiseId && !isCommissioner ? 'owner' : 'commissioner';
  if (user.franchiseId !== franchiseId && !isCommissioner) {
    return json({ success: false, message: 'You can only set your own team’s hometown.' }, 403);
  }

  let place = null;
  if (body.clear !== true) {
    const name = typeof body.name === 'string' ? body.name : '';
    const region = typeof body.region === 'string' ? body.region : '';
    place = findPlace(name, region);
    if (!place) return json({ success: false, message: 'Pick a place from the list.' }, 400);
  }

  try {
    const saved = await writeHometown(league.slug, franchiseId, place, setBy);
    if (!saved) return handledFailure('Hometowns can’t be saved right now. Try again later.', 503);
  } catch (err) {
    console.error('[owner-map] hometown write failed:', err);
    return handledFailure('Hometowns can’t be saved right now. Try again later.', 503);
  }
  return json({ success: true });
};
