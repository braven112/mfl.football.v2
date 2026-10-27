/**
 * POST /api/trades/submit
 *
 * Submit a trade proposal to MFL on behalf of the authenticated user.
 * Uses the user's MFL cookie (authUser.id) for per-user authentication.
 * Always operates in OWNER mode — never sends MFL_IS_COMMISH.
 *
 * Security:
 * - Validates the user has a resolved franchise before allowing trade submission
 * - Verifies the user owns every player they're offering (roster check)
 * - Never uses commissioner credentials for owner-level operations
 *
 * Uses mflFetch() to handle the cross-origin redirect from
 * api.myfantasyleague.com → www49, which would otherwise strip the
 * Cookie header and cause "API requires a logged in user" errors.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { recordInsightAction } from '../../../utils/site-insights';
import { getLeagueYearForMflId } from '../../../utils/league-year';
import { LEAGUES } from '../../../config/leagues';
import { mflFetch, describeMflFailure } from '../../../utils/mfl-fetch';
import { proposeTrade } from '../../../utils/mfl-trade-ops';
import { reportOwnerTrades } from '../../../utils/owner-trade-reports';
import { buildMflExportUrl } from '../../../utils/mfl-url';
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
    const { offeredTo, willGiveUp, willReceive, comments } = body;

    if (!offeredTo || !willGiveUp || !willReceive) {
      return new Response(
        JSON.stringify({ success: false, message: 'Missing required fields: offeredTo, willGiveUp, willReceive' }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    const leagueId = user.leagueId || LEAGUES.theleague.id;
    // Per-league rollover clock (AFL June 1, TheLeague Feb 14) — must match
    // the year pending.ts reads with, or the roster check and import target
    // the wrong MFL season between the two rollover dates.
    const year = getLeagueYearForMflId(leagueId);

    // The roster check, the owner-cookie import and MFL's HTTP-200 error
    // bodies all live in the shared helper the app's endpoint calls too.
    console.log(`[trades/submit] tradeProposal (OFFEREDTO=${offeredTo})`);
    const result = await proposeTrade({
      leagueId,
      year,
      mflUserCookie: user.id,
      franchiseId: user.franchiseId,
      offeredTo: String(offeredTo),
      willGiveUp: String(willGiveUp),
      willReceive: String(willReceive),
      comments,
    });
    if (!result.ok) {
      return new Response(
        JSON.stringify({ success: false, message: result.message }),
        { status: result.status, headers: JSON_HEADERS }
      );
    }

    // Silent capture: re-read pendingTrades to grab MFL's assigned trade_id
    // for the offer we just sent, then feed it into the Schefter rumor mill.
    // MFL's tradeProposal response doesn't return the offer id, so a refetch
    // is the reliable way to record it. Fire-and-forget — a capture failure
    // must never reject the submit.
    void (async () => {
      try {
        const url = buildMflExportUrl({ type: 'pendingTrades', leagueId, year });
        const res = await mflFetch({ url, method: 'GET', mflUserCookie: user.id });
        if (!res.ok) return;
        const text = await res.text();
        const data = JSON.parse(text);
        const pending = data?.pendingTrades;
        const raw = pending?.pendingTrade ?? pending?.trade;
        if (!raw) return;
        const rows = Array.isArray(raw) ? raw : [raw];
        await reportOwnerTrades(user.franchiseId!, rows, leagueId);
      } catch {
        // swallow — capture is best-effort
      }
    })();

    // Web push: nudge the receiving franchise's subscribed devices about the
    // new offer. Fire-and-forget — push problems must never fail the submit.
    // League + proposer identity come from the session JWT (never the body).
    void (async () => {
      try {
        const { notifyTradeOfferPush } = await import('../../../utils/push-notify-trade');
        await notifyTradeOfferPush(leagueId, user.franchiseId!, String(offeredTo));
      } catch {
        // swallow — notification is best-effort
      }
    })();

    await recordInsightAction(user, 'trade_offer');

    return new Response(
      JSON.stringify({ success: true, message: 'Trade proposal submitted' }),
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
    console.error('[trades/submit] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};
