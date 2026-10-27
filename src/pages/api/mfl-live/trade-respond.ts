/**
 * POST /api/mfl-live/trade-respond?league=  — accept or reject an offer made
 * to you, or withdraw one you made, in ANY MFL league the account is in.
 *
 * League and team from `requireOwnerLeague`; the owner's own cookie; MFL's
 * HTTP-200 error bodies read by the shared helper (src/utils/mfl-trade-ops.ts).
 */

import type { APIRoute } from 'astro';
import type { MflLiveAppTradeResult } from '../../../../packages/shared-types/src/mfl-live-app-trades';
import { appJson, requireOwnerLeague } from '../../../utils/live/owner-league';
import { describeMflFailure } from '../../../utils/mfl-fetch';
import { respondToTrade, TRADE_RESPONSES, type TradeResponseKind } from '../../../utils/mfl-trade-ops';
import { invalidateAppBadge } from '../../../utils/app-badge-cache';

export const POST: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;
  const { user, league } = gate;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return appJson({ success: false, message: 'Bad request.' } satisfies MflLiveAppTradeResult, 400);
  }
  const tradeId = String(body.tradeId ?? '').trim();
  const response = String(body.response ?? '') as TradeResponseKind;
  if (!/^\d+$/.test(tradeId) || !TRADE_RESPONSES.includes(response)) {
    return appJson({ success: false, message: 'Bad request.' } satisfies MflLiveAppTradeResult, 400);
  }
  const comments = typeof body.comments === 'string' ? body.comments.slice(0, 500) : undefined;

  try {
    const result = await respondToTrade({
      leagueId: league.leagueId,
      year: league.year,
      mflUserCookie: user.id,
      tradeId,
      response,
      comments,
    });
    if (!result.ok) {
      return appJson({ success: false, message: result.message } satisfies MflLiveAppTradeResult, result.status);
    }
    // The answered offer was one of the numbers on this owner's site badge.
    void invalidateAppBadge(league.leagueId, league.franchiseId);
    // TODO(push, package H): on accept, notifyLeagueEvent({ kind: 'trade-accepted', leagueId,
    // fromFranchiseId, toFranchiseId, summary }) from src/utils/push-events.ts once it is on staging.
    return appJson({ success: true, message: result.message } satisfies MflLiveAppTradeResult);
  } catch (error) {
    const failure = describeMflFailure(error);
    if (!failure.blocked) console.error('[mfl-live/trade-respond] failed:', error);
    return appJson(
      { success: false, message: failure.blocked ? failure.message : "Couldn't reach MFL. Try again." } satisfies MflLiveAppTradeResult,
      failure.blocked ? 503 : 502,
    );
  }
};
