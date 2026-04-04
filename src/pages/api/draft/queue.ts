/**
 * POST /api/draft/queue
 *
 * Syncs the user's pick queue to MFL as their draft board (myDraftList).
 * This is a destructive overwrite — MFL replaces the entire list each time.
 *
 * Auth: requires logged-in user with franchiseId (owner-level).
 * Never uses commissioner credentials.
 *
 * Uses mflFetch() to handle cross-origin redirect from
 * api.myfantasyleague.com that would otherwise strip the Cookie header.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { getCurrentLeagueYear } from '../../../utils/league-year';
import { mflFetch } from '../../../utils/mfl-fetch';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);

  if (!user) {
    return new Response(
      JSON.stringify({ success: false, message: 'Authentication required.' }),
      { status: 401, headers: JSON_HEADERS }
    );
  }

  if (!user.id) {
    return new Response(
      JSON.stringify({ success: false, message: 'MFL session not found. Please sign in again.' }),
      { status: 401, headers: JSON_HEADERS }
    );
  }

  if (!user.franchiseId) {
    return new Response(
      JSON.stringify({ success: false, message: 'No franchise associated with your account.' }),
      { status: 403, headers: JSON_HEADERS }
    );
  }

  try {
    const body = await request.json();
    const { playerIds } = body as { playerIds: string[] };

    if (!Array.isArray(playerIds)) {
      return new Response(
        JSON.stringify({ success: false, message: 'playerIds must be an array.' }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    const year = getCurrentLeagueYear();
    const leagueId = user.leagueId || '13522';

    // MFL myDraftList import: comma-separated ordered player IDs
    const params = new URLSearchParams({
      TYPE: 'myDraftList',
      L: leagueId,
      PLAYERS: playerIds.join(','),
    });

    const importUrl = `https://api.myfantasyleague.com/${year}/import`;
    console.log(`[draft/queue] POST ${importUrl} (${playerIds.length} players)`);

    const mflResponse = await mflFetch({
      url: importUrl,
      method: 'POST',
      mflUserCookie: user.id,
      body: params.toString(),
    });

    const responseText = await mflResponse.text();
    console.log('[draft/queue] MFL response:', mflResponse.status, responseText.substring(0, 300));

    // MFL returns HTTP 200 even for errors — check body
    if (responseText.includes('<error>') || responseText.includes('"error"')) {
      const match = responseText.match(/<error[^>]*>(.*?)<\/error>/s)
        || responseText.match(/"error"\s*:\s*"([^"]+)"/);
      const errorMsg = match?.[1] || 'MFL rejected the draft board update';
      return new Response(
        JSON.stringify({ success: false, message: errorMsg }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    if (responseText.includes('<html') || responseText.includes('<!DOCTYPE')) {
      return new Response(
        JSON.stringify({ success: false, message: 'MFL did not process the request. Please sign in and try again.' }),
        { status: 502, headers: JSON_HEADERS }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: `Draft board synced (${playerIds.length} players)` }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (error) {
    console.error('[draft/queue] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};
