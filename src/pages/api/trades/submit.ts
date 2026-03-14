/**
 * API endpoint for submitting a trade proposal to MFL
 * POST /api/trades/submit
 *
 * Requires authenticated user. The user's MFL cookie (stored as userId in session)
 * is forwarded to MFL to identify the proposing franchise.
 *
 * IMPORTANT: Write operations must target the league-specific host (www49)
 * not the api.myfantasyleague.com load balancer, which 302-redirects POSTs
 * and Node's fetch converts them to GETs (losing the request body).
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { getCurrentLeagueYear } from '../../../utils/league-year';

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
    const { offeredTo, willGiveUp, willReceive, comments, franchiseId } = body;

    if (!offeredTo || !willGiveUp || !willReceive) {
      return new Response(
        JSON.stringify({ success: false, message: 'Missing required fields: offeredTo, willGiveUp, willReceive' }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    const year = getCurrentLeagueYear();
    const leagueId = user.leagueId || '13522';
    const mflCookie = user.id; // MFL_USER_ID cookie stored as userId during login

    // Must use league-specific host for write operations — NOT api.myfantasyleague.com
    const mflHost = `www${Number(leagueId) % 50}.myfantasyleague.com`;
    const importUrl = `https://${mflHost}/${year}/import`;
    const params = new URLSearchParams({
      TYPE: 'tradeProposal',
      L: leagueId,
      OFFEREDTO: offeredTo,
      WILL_GIVE_UP: willGiveUp,
      WILL_RECEIVE: willReceive,
      JSON: '1',
    });

    // Commissioner accounts (franchiseId "0000") must specify which franchise
    // they're acting as. The client sends the actual franchise ID.
    if (franchiseId && franchiseId !== '0000') {
      params.set('FRANCHISE_ID', franchiseId);
    }

    if (comments?.trim()) {
      params.set('COMMENTS', comments.trim());
    }

    console.log(`[trades/submit] POST ${importUrl} offeredTo=${offeredTo} franchiseId=${franchiseId || 'none'}`);

    const mflResponse = await fetch(importUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: `MFL_USER_ID=${mflCookie}`,
      },
      body: params.toString(),
      redirect: 'manual', // Never follow redirects on write operations
    });

    // A redirect means we hit the wrong host or MFL is bouncing us
    if (mflResponse.status >= 300 && mflResponse.status < 400) {
      const location = mflResponse.headers.get('location');
      console.error('[trades/submit] Unexpected redirect:', mflResponse.status, location);
      return new Response(
        JSON.stringify({ success: false, message: 'MFL redirected the request. Trade was not submitted.' }),
        { status: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    const responseText = await mflResponse.text();
    console.log('[trades/submit] MFL response:', mflResponse.status, responseText.substring(0, 500));

    if (!mflResponse.ok) {
      console.error('[trades/submit] MFL error:', mflResponse.status, responseText);
      return new Response(
        JSON.stringify({ success: false, message: `MFL API error: ${mflResponse.status}` }),
        { status: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    // Check for MFL error responses in the body
    if (responseText.includes('<error>') || responseText.includes('"error"')) {
      console.error('[trades/submit] MFL returned error:', responseText);
      const errorMatch = responseText.match(/<error[^>]*>(.*?)<\/error>/s)
        || responseText.match(/"error"\s*:\s*"([^"]+)"/);
      const errorMsg = errorMatch?.[1] || 'MFL rejected the trade proposal';
      return new Response(
        JSON.stringify({ success: false, message: errorMsg }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Trade proposal submitted' }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[trades/submit] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  }
};
