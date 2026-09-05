/**
 * Trade-offer push notification — the first real web-push notification.
 *
 * Called fire-and-forget from POST /api/trades/submit after MFL accepts a
 * trade proposal: pushes to every subscription of the RECEIVING franchise,
 * in the league the proposing session belongs to. League + proposer
 * identity come from the session JWT upstream — this module only shapes
 * the message.
 *
 * Adding another notification type? Follow this file's shape: a pure
 * `build*Payload` function (unit-testable) plus a `notify*` wrapper that
 * resolves league/team context and calls sendPushToFranchise. See
 * docs/features/web-push.md.
 */

import { getLeagueById } from '../config/leagues';
import { isPushConfigured, sendPushToFranchise, type PushPayload, type PushSendResult } from './push-sender';

interface LeagueTeam {
  franchiseId?: string;
  name?: string;
}

/** Per-league notification icon (site-relative, must exist in public/). */
export function leaguePushIcon(navSlug: string): string {
  return navSlug === 'afl' ? '/assets/afl/favicons/favicon-192.png' : '/assets/icons/pwa/icon-192.png';
}

/**
 * Build the trade-offer payload. Pure — unit-tested directly.
 * The click-through lands on the league home page, where the global
 * TradeAlertModal pops for pending received trades.
 */
export function buildTradeOfferPayload(opts: {
  leagueSlug: string;
  leagueName: string;
  navSlug: string;
  fromTeamName: string | null;
}): PushPayload {
  const from = opts.fromTeamName?.trim();
  return {
    title: from ? `Trade offer from ${from}` : 'New trade offer',
    body: from
      ? `${from} sent you a trade offer in ${opts.leagueName}. Tap to review it.`
      : `You have a new trade offer in ${opts.leagueName}. Tap to review it.`,
    url: `/${opts.leagueSlug}`,
    // One collapsing notification per league — a flurry of offers updates
    // in place instead of stacking.
    tag: `trade-offer-${opts.leagueSlug}`,
    icon: leaguePushIcon(opts.navSlug),
  };
}

/** Look up a team display name from the league's config file. */
async function resolveTeamName(navSlug: string, franchiseId: string): Promise<string | null> {
  try {
    let teams: LeagueTeam[] = [];
    if (navSlug === 'afl') {
      const cfg = (await import('../../data/afl-fantasy/afl.config.json')) as unknown as {
        default?: { teams?: LeagueTeam[] };
        teams?: LeagueTeam[];
      };
      teams = cfg.default?.teams ?? cfg.teams ?? [];
    } else {
      const cfg = (await import('../data/theleague.config.json')) as unknown as {
        default?: { teams?: LeagueTeam[] };
        teams?: LeagueTeam[];
      };
      teams = cfg.default?.teams ?? cfg.teams ?? [];
    }
    return teams.find((t) => t.franchiseId === franchiseId)?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Push "you got a trade offer" to the receiving franchise's devices.
 * Never throws — call sites treat this as best-effort.
 */
export async function notifyTradeOfferPush(
  leagueId: string,
  fromFranchiseId: string,
  toFranchiseId: string,
): Promise<PushSendResult | null> {
  try {
    if (!isPushConfigured()) return null;

    const league = getLeagueById(leagueId);
    // Unknown league or draft-only best-ball (no trades) → nothing to send.
    if (!league || league.bestBall) return null;

    const normalizedTo = /^\d+$/.test(toFranchiseId.trim())
      ? toFranchiseId.trim().padStart(4, '0')
      : toFranchiseId.trim();
    if (!normalizedTo) return null;

    const fromTeamName = await resolveTeamName(league.navSlug, fromFranchiseId);
    const payload = buildTradeOfferPayload({
      leagueSlug: league.slug,
      leagueName: league.name,
      navSlug: league.navSlug,
      fromTeamName,
    });

    return await sendPushToFranchise(leagueId, normalizedTo, payload);
  } catch (e) {
    console.warn('[push-notify-trade] failed:', e);
    return null;
  }
}
