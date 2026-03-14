/**
 * API endpoint for fetching pending trades from MFL
 * GET /api/trades/pending
 *
 * Returns all pending trades for the authenticated user's franchise.
 * Uses mflFetch() to preserve Cookie headers across MFL's cross-origin redirects.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { getCurrentLeagueYear } from '../../../utils/league-year';
import { mflFetch } from '../../../utils/mfl-fetch';
import type { PendingTrade } from '../../../types/trade-builder';

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);

  if (!user) {
    return new Response(
      JSON.stringify({ success: false, message: 'Authentication required' }),
      { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  }

  if (!user.franchiseId) {
    return new Response(
      JSON.stringify({ success: false, message: 'No franchise associated with your account.' }),
      { status: 403, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const year = getCurrentLeagueYear();
    const leagueId = user.leagueId || '13522';
    const mflCookie = user.id;

    const exportUrl = `https://api.myfantasyleague.com/${year}/export?TYPE=pendingTrades&L=${leagueId}&JSON=1`;

    const mflResponse = await mflFetch({
      url: exportUrl,
      method: 'GET',
      mflUserCookie: mflCookie,
    });

    if (!mflResponse.ok) {
      console.error('[trades/pending] MFL error:', mflResponse.status);
      return new Response(
        JSON.stringify({ success: false, message: 'Failed to fetch pending trades' }),
        { status: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    const responseText = await mflResponse.text();
    console.log('[trades/pending] MFL raw response (first 500 chars):', responseText.substring(0, 500));

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('[trades/pending] Failed to parse MFL response as JSON');
      return new Response(
        JSON.stringify({ success: false, message: 'Invalid response from MFL' }),
        { status: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    // Check for MFL error responses (auth failure, etc.)
    if (data?.error) {
      console.error('[trades/pending] MFL returned error:', JSON.stringify(data.error));
      return new Response(
        JSON.stringify({ success: false, message: 'MFL authentication error. Try logging out and back in.' }),
        { status: 403, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    // MFL returns empty string when no trades, or { pendingTrades: { trade: [...] } }
    const rawTrades = data?.pendingTrades?.trade;
    console.log('[trades/pending] pendingTrades type:', typeof data?.pendingTrades, '| trade type:', typeof rawTrades, '| rawTrades:', JSON.stringify(rawTrades)?.substring(0, 200));
    if (!rawTrades) {
      return new Response(
        JSON.stringify({ success: true, trades: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    // MFL returns single object (not array) when there's only one trade
    const tradeArray = Array.isArray(rawTrades) ? rawTrades : [rawTrades];

    const trades: PendingTrade[] = tradeArray.map((t: any) => ({
      tradeId: t.id || t.trade_id || '',
      offeredBy: (t.franchise || '').padStart(4, '0'),
      offeredTo: (t.franchise2 || '').padStart(4, '0'),
      willGiveUp: (t.franchise1_gave_up || '').replace(/,\s*$/, ''),
      willReceive: (t.franchise2_gave_up || '').replace(/,\s*$/, ''),
      timestamp: parseInt(t.timestamp || '0', 10),
      expires: parseInt(t.expires || '0', 10),
      comments: t.comments || '',
      byCommish: t.by_commish === '1',
    }));

    return new Response(
      JSON.stringify({ success: true, trades }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[trades/pending] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  }
};
