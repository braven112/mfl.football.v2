/**
 * GET /api/mock-draft/list
 *
 * Returns active mock draft sessions from the lobby's registry (Redis).
 *
 * The LEAGUE always comes from the session, never a query param — a lobby
 * lists the caller's own league and nobody else's. `?conference=` selects a
 * board WITHIN that league: the AFL runs two independent drafts, and an AL
 * session in the NL's lobby is one an NL owner can open and then never be on
 * the clock in, because they are not in its order.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../../utils/api-response';
import { DEFAULT_LEAGUE_ID, getLeagueById } from '../../../config/leagues';
import { conferenceUnit, mockRegistryRoom, parseConference } from '../../../utils/mock-draft-scope';
import { listMockDrafts } from '../../../utils/mock-draft-store';

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
    return new Response(
      JSON.stringify({ success: false, message: 'Authentication required.' }),
      { status: 401, headers: JSON_HEADERS },
    );
  }

  const url = new URL(request.url);
  const leagueId = user.leagueId || DEFAULT_LEAGUE_ID;
  const isAfl = getLeagueById(leagueId)?.slug === 'afl-fantasy';
  const conference = isAfl ? parseConference(url.searchParams.get('conference')) : null;
  if (isAfl && !conference) {
    // Same reasoning as delete: the unscoped registry is empty for the AFL, so
    // falling back to it would answer "no sessions" for a board that has them.
    // An empty list reads as "mine vanished", which is a silent wrong.
    return new Response(
      JSON.stringify({ success: false, sessions: [], message: 'A conference is required to list AFL mock drafts.' }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  try {
    const sessions = await listMockDrafts(
      mockRegistryRoom(leagueId, conference ? conferenceUnit(conference) : null),
    );
    return new Response(
      JSON.stringify({ success: true, sessions }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch (error) {
    // Not an empty list: "no sessions" reads as "mine vanished". Say the
    // lobby could not be read, and let the page show that.
    console.error('[mock-draft/list] Error:', error);
    return new Response(
      JSON.stringify({ success: false, sessions: [], message: 'Could not load mock drafts.' }),
      { status: 503, headers: JSON_HEADERS },
    );
  }
};
