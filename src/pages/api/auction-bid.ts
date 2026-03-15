/**
 * POST /api/auction-bid
 *
 * Place an auction bid via MFL's import endpoint.
 * Uses the authenticated user's MFL cookie for owner-level auth.
 *
 * Body (JSON):
 *   - playerId: string — MFL player ID to bid on
 *   - amount: number — Bid amount in whole dollars (e.g., 500000 = $500k)
 *
 * MFL endpoint: POST /import?TYPE=auctionBid
 *   Params: PLAYER_ID, AMOUNT, L (league ID)
 *
 * NOTE: TYPE=auctionBid is the best candidate for email auction leagues.
 * Needs live validation by inspecting MFL's options?O=52 form submission
 * in browser DevTools. If auctionBid fails, try BID instead of AMOUNT.
 * Test league ID for safe testing: 36189
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getCurrentLeagueYear } from '../../utils/league-year';
import { mflFetch } from '../../utils/mfl-fetch';

export const prerender = false;

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

  if (!user.franchiseId || user.franchiseId === '0000') {
    return new Response(
      JSON.stringify({ success: false, message: 'No franchise associated with your account.' }),
      { status: 403, headers: JSON_HEADERS }
    );
  }

  try {
    const body = await request.json();
    const { playerId, amount } = body;

    if (!playerId || !amount) {
      return new Response(
        JSON.stringify({ success: false, message: 'Missing required fields: playerId, amount' }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    const bidAmount = parseInt(String(amount), 10);
    if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
      return new Response(
        JSON.stringify({ success: false, message: 'Invalid bid amount' }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    const year = getCurrentLeagueYear();
    // TODO: Switch back to '13522' after test auction is complete
    const leagueId = user.leagueId || '36189';

    // Build MFL import request
    // NOTE: TYPE=auctionBid is the best candidate for email auction leagues.
    // Needs live validation by inspecting MFL's O=52 form submission in DevTools.
    // If auctionBid fails, also try parameter name BID instead of AMOUNT.
    // Amount is in whole dollars (e.g., 6000000 = $6M) — no conversion needed.
    const params = new URLSearchParams({
      TYPE: 'auctionBid',
      L: leagueId,
      FRANCHISE: user.franchiseId,
      PLAYER_ID: playerId,
      AMOUNT: String(bidAmount),
    });

    const importUrl = `https://api.myfantasyleague.com/${year}/import`;

    console.log(`[auction-bid] POST ${importUrl} (player=${playerId}, amount=${bidAmount}, franchise=${user.franchiseId})`);

    const mflResponse = await mflFetch({
      url: importUrl,
      method: 'POST',
      mflUserCookie: user.id,
      body: params.toString(),
    });

    const responseText = await mflResponse.text();
    console.log('[auction-bid] MFL response:', mflResponse.status, responseText.substring(0, 500));

    // MFL returns HTTP 200 even for errors — check response body
    if (responseText.includes('<error>') || responseText.includes('"error"')) {
      const errorMatch = responseText.match(/<error[^>]*>(.*?)<\/error>/s)
        || responseText.match(/"error"\s*:\s*"([^"]+)"/);
      const errorMsg = errorMatch?.[1] || 'MFL rejected the bid';
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

    // Detect HTML page response (MFL sometimes returns HTML instead of API response)
    if (responseText.includes('<html') || responseText.includes('<!DOCTYPE')) {
      return new Response(
        JSON.stringify({ success: false, message: 'MFL did not process the bid. Please try again.' }),
        { status: 502, headers: JSON_HEADERS }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Bid placed successfully' }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (error) {
    console.error('[auction-bid] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};
