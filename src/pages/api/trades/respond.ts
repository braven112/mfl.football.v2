/**
 * POST /api/trades/respond
 *
 * Respond to a pending trade on MFL (accept, reject, or revoke/withdraw).
 * Uses the user's MFL cookie (authUser.id) for per-user authentication.
 *
 * Follows the same pattern as /api/trade-bait — uses api.myfantasyleague.com
 * with redirect: 'follow' and no FRANCHISE_ID override.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { getCurrentLeagueYear } from '../../../utils/league-year';

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
    const importUrl = `https://api.myfantasyleague.com/${year}/import`;

    const params = new URLSearchParams({
      TYPE: 'tradeResponse',
      L: leagueId,
      TRADE_ID: tradeId,
      RESPONSE: response,
      JSON: '1',
    });

    if (comments?.trim()) {
      params.set('COMMENTS', comments.trim());
    }

    console.log(`[trades/respond] POST ${importUrl} tradeId=${tradeId} response=${response}`);

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
    console.log('[trades/respond] MFL response:', mflResponse.status, responseText.substring(0, 500));

    // MFL returns HTTP 200 even for errors — check response body
    if (responseText.includes('<error>') || responseText.includes('"error"')) {
      console.error('[trades/respond] MFL returned error:', responseText);
      const errorMatch = responseText.match(/<error[^>]*>(.*?)<\/error>/s)
        || responseText.match(/"error"\s*:\s*"([^"]+)"/);
      const errorMsg = errorMatch?.[1] || 'MFL rejected the trade response';
      return new Response(
        JSON.stringify({ success: false, message: errorMsg }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    if (!mflResponse.ok) {
      console.error('[trades/respond] MFL error:', mflResponse.status, responseText);
      return new Response(
        JSON.stringify({ success: false, message: `MFL API error: ${mflResponse.status}` }),
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
