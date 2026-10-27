/**
 * POST /api/trades/respond
 *
 * Respond to a pending trade on MFL (accept, reject, or revoke/withdraw).
 * Uses the user's MFL cookie (authUser.id) for per-user authentication.
 * Always operates in OWNER mode — never sends MFL_IS_COMMISH.
 *
 * Security:
 * - Validates the user has a resolved franchise before allowing response
 * - Verifies the user is a party to the trade (offeredBy or offeredTo)
 * - Never uses commissioner credentials for owner-level operations
 *
 * Uses mflFetch() to handle the cross-origin redirect from
 * api.myfantasyleague.com → www49, which would otherwise strip the
 * Cookie header and cause "API requires a logged in user" errors.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { recordInsightAction } from '../../../utils/site-insights';
import { invalidateAppBadge } from '../../../utils/app-badge-cache';
import { getLeagueYearForMflId } from '../../../utils/league-year';
import { LEAGUES } from '../../../config/leagues';
import { describeMflFailure } from '../../../utils/mfl-fetch';
import { respondToTrade, TRADE_RESPONSES, type TradeResponseKind } from '../../../utils/mfl-trade-ops';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../../utils/api-response';

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
    const body = await request.json();
    const { tradeId, response, comments } = body;

    if (!tradeId || !response) {
      return new Response(
        JSON.stringify({ success: false, message: 'Missing required fields: tradeId, response' }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    if (!TRADE_RESPONSES.includes(response as TradeResponseKind)) {
      return new Response(
        JSON.stringify({ success: false, message: `Invalid response: must be one of ${TRADE_RESPONSES.join(', ')}` }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    const leagueId = user.leagueId || LEAGUES.theleague.id;
    // Per-league rollover clock (AFL June 1, TheLeague Feb 14) — must match
    // the year pending.ts reads with, or the TRADE_ID targets a season that
    // doesn't contain it between the two rollover dates.
    const year = getLeagueYearForMflId(leagueId);

    console.log(`[trades/respond] tradeResponse (TRADE_ID=${tradeId}, RESPONSE=${response})`);
    const result = await respondToTrade({
      leagueId,
      year,
      mflUserCookie: user.id,
      tradeId: String(tradeId),
      response: response as TradeResponseKind,
      comments,
    });
    if (!result.ok) {
      return new Response(
        JSON.stringify({ success: false, message: result.message, ...(result.blocked ? { blocked: true } : {}) }),
        { status: result.status, headers: JSON_HEADERS }
      );
    }

    // The answered offer was one of the numbers on this owner's app icon.
    // Fire-and-forget: a stale badge must never fail a trade response.
    void invalidateAppBadge(leagueId, user.franchiseId);
    await recordInsightAction(user, 'trade_response');

    return new Response(
      JSON.stringify({ success: true, message: result.message }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (error) {
    // A staging/preview deployment refuses the send itself — report that,
    // not an outage or an internal error (mfl-fetch#describeMflFailure).
    const failure = describeMflFailure(error);
    if (failure.blocked) {
      return new Response(
        JSON.stringify({ success: false, message: failure.message, blocked: true }),
        { status: 503, headers: JSON_HEADERS }
      );
    }
    console.error('[trades/respond] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};
