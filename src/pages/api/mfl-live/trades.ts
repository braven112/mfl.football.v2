/**
 * GET  /api/mfl-live/trades?league=  — the owner's pending offers, both ways.
 * POST /api/mfl-live/trades?league=  — propose a trade, or counter one.
 *
 * The MFL Football app, for ANY MFL league the account is in. The league and
 * the team come from `requireOwnerLeague` (the team MFL lists for this
 * account), never from the body, and every MFL call carries the owner's own
 * cookie (src/utils/mfl-trade-ops.ts).
 *
 * A counter is a NEW offer plus a rejection of the original, in that order:
 * MFL has no counter import, and rejecting first would lose the original
 * whenever the new offer bounces. If the rejection then fails, both are open
 * and the answer says so (`originalStillOpen`).
 */

import type { APIRoute } from 'astro';
import type {
  MflLiveAppTradeProposal,
  MflLiveAppTradeResult,
} from '../../../../packages/shared-types/src/mfl-live-app-trades';
import { appJson, requireOwnerLeague } from '../../../utils/live/owner-league';
import { describeMflFailure } from '../../../utils/mfl-fetch';
import { isTradeAssetCode, proposeTrade, respondToTrade } from '../../../utils/mfl-trade-ops';
import { loadAppTrades, TradeReadError } from '../../../utils/live/mfl-live-app-trades';
import { reportOwnerTrades } from '../../../utils/owner-trade-reports';

const MAX_ASSETS_PER_SIDE = 20;
const MAX_COMMENT = 500;

export const GET: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;
  const { user, league } = gate;

  try {
    const { view, rows } = await loadAppTrades({
      leagueId: league.leagueId,
      year: league.year,
      host: league.host,
      franchiseId: league.franchiseId,
      mflUserCookie: user.id,
    });
    // Same silent capture as /api/trades/pending; it gates on TheLeague itself.
    if (rows.length) void reportOwnerTrades(league.franchiseId, rows, league.leagueId).catch(() => {});
    return appJson(view);
  } catch (error) {
    if (error instanceof TradeReadError) {
      return appJson({ success: false, message: "Couldn't read your trades from MFL. Try again." }, 502);
    }
    console.error('[mfl-live/trades] GET failed:', error);
    return appJson({ success: false, message: "Couldn't reach MFL. Try again." }, 502);
  }
};

/** Validate a proposal body. A string is the message to answer 400 with. */
export function readProposal(body: unknown, myFranchiseId: string): MflLiveAppTradeProposal | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const offeredTo = String(b.offeredTo ?? '').trim();
  if (!/^\d{4}$/.test(offeredTo)) return 'Pick a team to trade with.';
  if (offeredTo === myFranchiseId) return "You can't trade with yourself.";
  const codes = (v: unknown) => (Array.isArray(v) ? v.map((c) => String(c).trim()).filter(Boolean) : null);
  const give = codes(b.give);
  const get = codes(b.get);
  if (!give || !get) return 'Missing give or get.';
  if (give.length === 0 && get.length === 0) return 'Add something to the trade.';
  if (give.length > MAX_ASSETS_PER_SIDE || get.length > MAX_ASSETS_PER_SIDE) return 'Too many assets in one trade.';
  if (![...give, ...get].every(isTradeAssetCode)) return 'One of those assets is not something MFL can trade.';
  if (new Set(give).size !== give.length || new Set(get).size !== get.length) return 'An asset is listed twice.';
  const comments = typeof b.comments === 'string' ? b.comments.slice(0, MAX_COMMENT) : undefined;
  const counter = b.counterOfTradeId == null ? undefined : String(b.counterOfTradeId).trim();
  if (counter !== undefined && !/^\d+$/.test(counter)) return 'That offer id is not valid.';
  return { offeredTo, give, get, comments, counterOfTradeId: counter };
}

export const POST: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;
  const { user, league } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return appJson({ success: false, message: 'Bad request.' } satisfies MflLiveAppTradeResult, 400);
  }
  const proposal = readProposal(body, league.franchiseId);
  if (typeof proposal === 'string') {
    return appJson({ success: false, message: proposal } satisfies MflLiveAppTradeResult, 400);
  }

  try {
    const sent = await proposeTrade({
      leagueId: league.leagueId,
      year: league.year,
      mflUserCookie: user.id,
      franchiseId: league.franchiseId,
      offeredTo: proposal.offeredTo,
      willGiveUp: proposal.give.join(','),
      willReceive: proposal.get.join(','),
      comments: proposal.comments,
      host: league.host,
    });
    if (!sent.ok) {
      return appJson({ success: false, message: sent.message } satisfies MflLiveAppTradeResult, sent.status);
    }

    // TODO(push, package H): notifyLeagueEvent({ kind: 'trade-offer', leagueId: league.leagueId,
    // fromFranchiseId: league.franchiseId, toFranchiseId: proposal.offeredTo, summary })
    // from src/utils/push-events.ts once it is on staging. No push is sent from here until then.

    if (proposal.counterOfTradeId) {
      const rejected = await respondToTrade({
        leagueId: league.leagueId,
        year: league.year,
        mflUserCookie: user.id,
        tradeId: proposal.counterOfTradeId,
        response: 'reject',
      }).catch(() => ({ ok: false as const, status: 502, message: '' }));
      if (!rejected.ok) {
        return appJson({
          success: true,
          message: 'Counter sent, but MFL kept their original offer open. Reject it from Trades.',
          originalStillOpen: true,
        } satisfies MflLiveAppTradeResult);
      }
      return appJson({ success: true, message: 'Counter sent' } satisfies MflLiveAppTradeResult);
    }
    return appJson({ success: true, message: sent.message } satisfies MflLiveAppTradeResult);
  } catch (error) {
    // A staging/preview deployment refuses the send itself (mfl-fetch#describeMflFailure).
    const failure = describeMflFailure(error);
    if (!failure.blocked) console.error('[mfl-live/trades] POST failed:', error);
    return appJson(
      { success: false, message: failure.blocked ? failure.message : "Couldn't reach MFL. Try again." } satisfies MflLiveAppTradeResult,
      failure.blocked ? 503 : 502,
    );
  }
};
