/**
 * POST /api/trades/submit
 *
 * Submit a trade proposal to MFL on behalf of the authenticated user.
 * Uses the user's MFL cookie (authUser.id) for per-user authentication,
 * NOT the server-level process.env.MFL_USER_ID.
 *
 * Follows the same pattern as /api/trade-bait — uses api.myfantasyleague.com
 * with redirect: 'follow' and no FRANCHISE_ID override.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { getCurrentLeagueYear } from '../../../utils/league-year';

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

  try {
    const body = await request.json();
    const { offeredTo, willGiveUp, willReceive, comments } = body;

    if (!offeredTo || !willGiveUp || !willReceive) {
      return new Response(
        JSON.stringify({ success: false, message: 'Missing required fields: offeredTo, willGiveUp, willReceive' }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    const year = getCurrentLeagueYear();
    const leagueId = user.leagueId || '13522';
    const importUrl = `https://api.myfantasyleague.com/${year}/import`;

    const params = new URLSearchParams({
      TYPE: 'tradeProposal',
      L: leagueId,
      OFFEREDTO: offeredTo,
      WILL_GIVE_UP: willGiveUp,
      WILL_RECEIVE: willReceive,
      JSON: '1',
    });

    if (comments?.trim()) {
      params.set('COMMENTS', comments.trim());
    }

    console.log(`[trades/submit] POST ${importUrl} offeredTo=${offeredTo}`);

    const mflResponse = await fetch(importUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: `MFL_USER_ID=${user.id}`,
      },
      body: params.toString(),
      redirect: 'follow',
    });

    const responseText = await mflResponse.text();
    console.log('[trades/submit] MFL response:', mflResponse.status, responseText.substring(0, 500));

    // MFL returns HTTP 200 even for errors — check response body
    if (responseText.includes('<error>') || responseText.includes('"error"')) {
      console.error('[trades/submit] MFL returned error:', responseText);
      const errorMatch = responseText.match(/<error[^>]*>(.*?)<\/error>/s)
        || responseText.match(/"error"\s*:\s*"([^"]+)"/);
      const errorMsg = errorMatch?.[1] || 'MFL rejected the trade proposal';
      return new Response(
        JSON.stringify({ success: false, message: errorMsg }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    if (!mflResponse.ok) {
      console.error('[trades/submit] MFL error:', mflResponse.status, responseText);
      return new Response(
        JSON.stringify({ success: false, message: `MFL API error: ${mflResponse.status}` }),
        { status: 502, headers: JSON_HEADERS }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Trade proposal submitted' }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (error) {
    console.error('[trades/submit] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};
