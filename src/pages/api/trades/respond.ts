/**
 * API endpoint for responding to a pending trade on MFL
 * POST /api/trades/respond
 *
 * Supports: accept, reject, revoke (withdraw)
 * The action determines who can call it:
 *   - accept/reject: only the trade recipient
 *   - revoke: only the trade originator
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { getCurrentLeagueYear } from '../../../utils/league-year';

const VALID_RESPONSES = ['accept', 'reject', 'revoke'] as const;
type TradeResponse = (typeof VALID_RESPONSES)[number];

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);

  if (!user) {
    return new Response(
      JSON.stringify({ success: false, message: 'Authentication required' }),
      { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const body = await request.json();
    const { tradeId, response, comments } = body;

    if (!tradeId || !response) {
      return new Response(
        JSON.stringify({ success: false, message: 'Missing required fields: tradeId, response' }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    if (!VALID_RESPONSES.includes(response as TradeResponse)) {
      return new Response(
        JSON.stringify({ success: false, message: `Invalid response: must be one of ${VALID_RESPONSES.join(', ')}` }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    const year = getCurrentLeagueYear();
    const leagueId = user.leagueId || '13522';
    const mflCookie = user.id;

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

    const mflResponse = await fetch(importUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: `MFL_USER_ID=${mflCookie}`,
      },
      body: params.toString(),
    });

    const responseText = await mflResponse.text();

    if (!mflResponse.ok) {
      console.error('[trades/respond] MFL error:', mflResponse.status, responseText);
      return new Response(
        JSON.stringify({ success: false, message: `MFL API error: ${mflResponse.status}` }),
        { status: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    // Check for MFL error responses
    if (responseText.includes('<error>') || responseText.includes('"error"')) {
      console.error('[trades/respond] MFL returned error:', responseText);
      const errorMatch = responseText.match(/<error[^>]*>(.*?)<\/error>/s)
        || responseText.match(/"error"\s*:\s*"([^"]+)"/);
      const errorMsg = errorMatch?.[1] || 'MFL rejected the trade response';
      return new Response(
        JSON.stringify({ success: false, message: errorMsg }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    const actionLabels: Record<TradeResponse, string> = {
      accept: 'Trade accepted',
      reject: 'Trade rejected',
      revoke: 'Trade withdrawn',
    };

    return new Response(
      JSON.stringify({ success: true, message: actionLabels[response as TradeResponse] }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[trades/respond] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  }
};
