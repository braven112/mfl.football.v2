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

    // MFL uses "pendingTrade" (singular) as the key, NOT "trade"
    // Empty state: { pendingTrades: "" } — guard against empty string
    const pendingTrades = data?.pendingTrades;
    const rawTrades = pendingTrades?.pendingTrade ?? pendingTrades?.trade;
    if (!rawTrades) {
      return new Response(
        JSON.stringify({ success: true, trades: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    // MFL returns single object (not array) when there's only one trade
    const tradeArray = Array.isArray(rawTrades) ? rawTrades : [rawTrades];

    // MFL pending trade fields differ from completed trade fields:
    //   Pending: trade_id, offeredto, will_give_up, will_receive
    //   Completed: id, franchise, franchise2, franchise1_gave_up, franchise2_gave_up
    // The proposing franchise is NOT in the response — it's the authenticated user.
    const trades: PendingTrade[] = tradeArray.map((t: any) => ({
      tradeId: t.trade_id || t.id || '',
      offeredBy: user.franchiseId,
      offeredTo: (t.offeredto || t.franchise2 || '').padStart(4, '0'),
      willGiveUp: (t.will_give_up || t.franchise1_gave_up || '').replace(/,\s*$/, ''),
      willReceive: (t.will_receive || t.franchise2_gave_up || '').replace(/,\s*$/, ''),
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
