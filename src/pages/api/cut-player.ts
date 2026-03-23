/**
 * POST /api/cut-player
 *
 * Drop a player from the authenticated user's roster via MFL's fcfsWaiver endpoint.
 * Uses the user's MFL cookie (authUser.id) for per-user authentication.
 * Always operates in OWNER mode — never sends MFL_IS_COMMISH.
 *
 * Security:
 * - Validates the user has a resolved franchise before allowing the cut
 * - Verifies the user owns the player being cut (roster check)
 * - Never uses commissioner credentials for owner-level operations
 *
 * Uses mflFetch() to handle the cross-origin redirect from
 * api.myfantasyleague.com → www49, which would otherwise strip the
 * Cookie header and cause "API requires a logged in user" errors.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getCurrentLeagueYear } from '../../utils/league-year';
import { mflFetch } from '../../utils/mfl-fetch';
import { createMFLApiClient } from '../../utils/mfl-matchup-api';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);

  if (!user) {
    return new Response(
      JSON.stringify({ success: false, message: 'Authentication required. Please sign in.' }),
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
    const { playerId } = await request.json();

    if (!playerId || !/^\d+$/.test(String(playerId))) {
      return new Response(
        JSON.stringify({ success: false, message: 'Missing or invalid playerId' }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    const year = getCurrentLeagueYear();
    const leagueId = user.leagueId || '13522';

    // SECURITY: Verify the player belongs to the user's roster
    const mflClient = createMFLApiClient({
      leagueId,
      year: String(year),
      mflUserId: user.id,
    });
    const rosters = await mflClient.getRosters();
    const userRoster = rosters[user.franchiseId] || [];

    if (!userRoster.includes(String(playerId))) {
      return new Response(
        JSON.stringify({ success: false, message: 'You can only cut players from your own roster.' }),
        { status: 403, headers: JSON_HEADERS }
      );
    }

    // Execute the drop via MFL's fcfsWaiver endpoint
    const importUrl = `https://api.myfantasyleague.com/${year}/import`;
    const params = new URLSearchParams({
      TYPE: 'fcfsWaiver',
      L: leagueId,
      DROP: String(playerId),
      FRANCHISE_ID: user.franchiseId,
    });

    console.log(`[cut-player] POST ${importUrl} (franchise=${user.franchiseId}, drop=${playerId})`);

    const mflResponse = await mflFetch({
      url: importUrl,
      method: 'POST',
      mflUserCookie: user.id,
      body: params.toString(),
    });

    const responseText = await mflResponse.text();
    console.log('[cut-player] MFL response:', mflResponse.status, responseText.substring(0, 500));

    // MFL returns HTTP 200 even for errors — check response body
    if (responseText.includes('<error>') || responseText.includes('"error"')) {
      const errorMatch = responseText.match(/<error[^>]*>(.*?)<\/error>/s)
        || responseText.match(/"error"\s*:\s*"([^"]+)"/);
      const errorMsg = errorMatch?.[1] || 'MFL rejected the cut request';
      return new Response(
        JSON.stringify({ success: false, message: errorMsg }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    if (!mflResponse.ok) {
      return new Response(
        JSON.stringify({ success: false, message: `MFL API error: ${mflResponse.status}` }),
        { status: 502, headers: JSON_HEADERS }
      );
    }

    // Detect when MFL returns an HTML page instead of an API response
    if (responseText.includes('<html') || responseText.includes('<!DOCTYPE')) {
      return new Response(
        JSON.stringify({ success: false, message: 'MFL did not process the cut. Please try again.' }),
        { status: 502, headers: JSON_HEADERS }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Player successfully cut' }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (error) {
    console.error('[cut-player] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error. Please try again.' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};
