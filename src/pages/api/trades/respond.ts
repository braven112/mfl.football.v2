/**
 * POST /api/trades/respond
 *
 * Respond to a pending trade on MFL (accept, reject, or revoke/withdraw).
 * Uses the user's MFL cookie (authUser.id) for per-user authentication.
 * Always operates in OWNER mode — never sends MFL_IS_COMMISH.
 *
 * Uses mflFetch() to handle the cross-origin redirect from
 * api.myfantasyleague.com → www49, which would otherwise strip the
 * Cookie header and cause "API requires a logged in user" errors.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { getCurrentLeagueYear } from '../../../utils/league-year';
import { mflFetch } from '../../../utils/mfl-fetch';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const VALID_RESPONSES = ['accept', 'reject', 'revoke'] as const;
type TradeResponse = (typeof VALID_RESPONSES)[number];

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
    const { tradeId, response, comments } = body;

    if (!tradeId || !response) {
      return new Response(
        JSON.stringify({ success: false, message: 'Missing required fields: tradeId, response' }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    if (!VALID_RESPONSES.includes(response as TradeResponse)) {
      return new Response(
        JSON.stringify({ success: false, message: `Invalid response: must be one of ${VALID_RESPONSES.join(', ')}` }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    const year = getCurrentLeagueYear();
    const leagueId = user.leagueId || '13522';

    const params = new URLSearchParams({
      TYPE: 'tradeResponse',
      L: leagueId,
      TRADE_ID: tradeId,
      RESPONSE: response,
    });

    if (comments?.trim()) {
      params.set('COMMENTS', comments.trim());
    }

    const importUrl = `https://api.myfantasyleague.com/${year}/import`;

    console.log(`[trades/respond] POST ${importUrl} (TRADE_ID=${tradeId}, RESPONSE=${response})`);

    // Owner mode: only MFL_USER_ID cookie, no MFL_IS_COMMISH
    const mflResponse = await mflFetch({
      url: importUrl,
      method: 'POST',
      mflUserCookie: user.id,
      body: params.toString(),
    });

    const responseText = await mflResponse.text();
    console.log('[trades/respond] MFL response:', mflResponse.status, responseText.substring(0, 500));

    // MFL returns HTTP 200 even for errors — check response body
    if (responseText.includes('<error>') || responseText.includes('"error"')) {
      const errorMatch = responseText.match(/<error[^>]*>(.*?)<\/error>/s)
        || responseText.match(/"error"\s*:\s*"([^"]+)"/);
      const errorMsg = errorMatch?.[1] || 'MFL rejected the trade response';
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

    // Detect when MFL returns HTML instead of API response
    if (responseText.includes('<html') || responseText.includes('<!DOCTYPE')) {
      return new Response(
        JSON.stringify({ success: false, message: 'MFL did not process the request. Please try again.' }),
        { status: 502, headers: JSON_HEADERS }
      );
    }

    const actionLabels: Record<TradeResponse, string> = {
      accept: 'Trade accepted',
      reject: 'Trade rejected',
      revoke: 'Trade withdrawn',
    };

    return new Response(
      JSON.stringify({ success: true, message: actionLabels[response as TradeResponse] }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (error) {
    console.error('[trades/respond] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};
