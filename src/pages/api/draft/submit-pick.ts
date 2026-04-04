/**
 * POST /api/draft/submit-pick
 *
 * Submits a draft pick to MFL during a live draft.
 * Uses TYPE=pickPlayer which is the MFL live draft submission endpoint.
 *
 * Auth: requires logged-in user who is currently on the clock.
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
    const { playerId } = body as { playerId: string };

    if (!playerId || typeof playerId !== 'string') {
      return new Response(
        JSON.stringify({ success: false, message: 'playerId is required.' }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    const year = getCurrentLeagueYear();
    const leagueId = user.leagueId || '13522';

    const params = new URLSearchParams({
      TYPE: 'pickPlayer',
      L: leagueId,
      PLAYER: playerId,
    });

    const importUrl = `https://api.myfantasyleague.com/${year}/import`;
    console.log(`[draft/submit-pick] POST ${importUrl} (PLAYER=${playerId})`);

    const mflResponse = await mflFetch({
      url: importUrl,
      method: 'POST',
      mflUserCookie: user.id,
      body: params.toString(),
    });

    const responseText = await mflResponse.text();
    console.log('[draft/submit-pick] MFL response:', mflResponse.status, responseText.substring(0, 300));

    // MFL returns HTTP 200 even for errors — check body
    if (responseText.includes('<error>') || responseText.includes('"error"')) {
      const match = responseText.match(/<error[^>]*>(.*?)<\/error>/s)
        || responseText.match(/"error"\s*:\s*"([^"]+)"/);
      const errorMsg = match?.[1] || 'MFL rejected the pick submission';
      return new Response(
        JSON.stringify({ success: false, message: errorMsg }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    if (responseText.includes('<html') || responseText.includes('<!DOCTYPE')) {
      return new Response(
        JSON.stringify({ success: false, message: 'MFL did not process the pick. Please sign in and try again.' }),
        { status: 502, headers: JSON_HEADERS }
      );
    }

    if (!mflResponse.ok) {
      return new Response(
        JSON.stringify({ success: false, message: `MFL API error: ${mflResponse.status}` }),
        { status: 502, headers: JSON_HEADERS }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Pick submitted' }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (error) {
    console.error('[draft/submit-pick] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};
