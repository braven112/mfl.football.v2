/**
 * GET /api/mock-draft/list
 *
 * Returns active mock draft sessions from the PartyKit registry.
 * Query params: ?leagueId=13522 (defaults to 13522)
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
    return new Response(
      JSON.stringify({ success: false, message: 'Authentication required.' }),
      { status: 401, headers: JSON_HEADERS },
    );
  }

  const url = new URL(request.url);
  const leagueId = url.searchParams.get('leagueId') || user.leagueId || '13522';

  const rawPartyHost = import.meta.env.PUBLIC_PARTYKIT_HOST;
  if (!rawPartyHost) {
    return new Response(
      JSON.stringify({ success: false, sessions: [], message: 'PartyKit not configured.' }),
      { status: 200, headers: JSON_HEADERS },
    );
  }
  // Ensure protocol prefix for server-side fetch (env var may be bare hostname)
  const partyHost = rawPartyHost.startsWith('http') ? rawPartyHost : `https://${rawPartyHost}`;

  try {
    const registryUrl = `${partyHost}/party/${leagueId}-registry`;
    const res = await fetch(registryUrl, { method: 'GET' });

    if (!res.ok) {
      // Registry room may not exist yet — return empty list
      return new Response(
        JSON.stringify({ success: true, sessions: [] }),
        { status: 200, headers: JSON_HEADERS },
      );
    }

    const data = await res.json();
    const sessions = (data as any).sessions || [];

    return new Response(
      JSON.stringify({ success: true, sessions }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch (error) {
    console.error('[mock-draft/list] Error:', error);
    return new Response(
      JSON.stringify({ success: true, sessions: [] }),
      { status: 200, headers: JSON_HEADERS },
    );
  }
};
