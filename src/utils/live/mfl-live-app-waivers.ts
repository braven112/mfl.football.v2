/**
 * The phone app's side of add/drop and waivers (package L).
 *
 * The app serves ANY MFL league the account is in, so its owner context comes
 * from `requireOwnerLeague` (the account's own MFL league list), not from the
 * registry. Everything after that is the site's own code: the claim context
 * (`resolveOwnerClaimContext`), the write (`submitWaiverClaims`), the filed
 * claims (`waiver-claim-actions.ts`) and the cut (`cut-player-action.ts`).
 *
 * A registry league reached through the app keeps every registry input (its
 * clock, committed calendar, auction window, duplicate-player rule), so
 * TheLeague and the AFL behave exactly as they do on the site.
 *
 * Store rules: the view carries no headshots and no ESPN ids.
 */

import { getLeagueById } from '../../config/leagues';
import { resolveOwnerClaimContext } from '../claim-context';
import { readFiledClaimsView, type FiledClaimView, type OwnerLeagueContext } from '../waiver-claim-actions';
import type { OwnerLeague } from './owner-league';

/** `https://www49.myfantasyleague.com` or `www49.myfantasyleague.com` → the bare host; null when absent. */
export function bareMflHost(host: string | null | undefined): string | null {
  const bare = `${host ?? ''}`.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  return bare && /(^|\.)myfantasyleague\.com$/i.test(bare) ? bare : null;
}

/**
 * The owner context for an app request. Null when MFL gave no host for the
 * league: page handlers must be posted to the league's own host, and a guess
 * loses the cookie on the redirect.
 */
export function appOwnerContext(user: { id: string }, league: OwnerLeague): OwnerLeagueContext | null {
  const registry = getLeagueById(league.leagueId);
  const host = bareMflHost(league.host) ?? bareMflHost(registry?.mflHost);
  if (!host) return null;
  return {
    cookie: user.id,
    franchiseId: league.franchiseId,
    leagueId: league.leagueId,
    year: league.year,
    host,
    slug: registry?.slug ?? null,
    duplicatePlayers: !!registry?.duplicatePlayers,
    // Site insights count site owners; the app's sessions are not that.
    insightActor: null,
  };
}

/** What the add/drop sheet reads. A subset of the site's `ClaimContext`. */
export interface MflLiveAppWaiverContextView {
  canClaim: boolean;
  verb: 'Bid' | 'Claim';
  system: 'bbid' | 'priority';
  rules: {
    system: 'bbid' | 'priority';
    blindBid: boolean;
    minimum: number;
    increment: number;
    conditional: boolean;
    maxRounds: number;
  };
  roster: Array<{ id: string; name: string; slot: 'active' | 'ir' | 'taxi' }>;
  year: number;
  activeRosterCount?: number;
  rosterLimit?: number;
  balance?: number;
  windowMode: 'waiver' | 'fcfs' | 'unknown';
  windowLabel: string;
  addDropUrl: string;
  rosteredIds: string[];
}

export interface MflLiveAppWaiversView {
  success: true;
  context: MflLiveAppWaiverContextView;
  claims: FiledClaimView[] | null;
}

/** `GET /api/mfl-live/waivers`: the claim context and the claims already filed, read in parallel. */
export async function buildWaiversView(ctx: OwnerLeagueContext): Promise<MflLiveAppWaiversView> {
  const registry = getLeagueById(ctx.leagueId);
  const [full, claims] = await Promise.all([
    resolveOwnerClaimContext({ ...ctx, dataPath: registry?.dataPath ?? null }),
    readFiledClaimsView(ctx, { storeSafe: true }),
  ]);
  const context: MflLiveAppWaiverContextView = {
    canClaim: full.canClaim,
    verb: full.verb,
    system: full.system,
    rules: full.rules,
    roster: full.roster,
    year: full.year,
    activeRosterCount: full.activeRosterCount,
    rosterLimit: full.rosterLimit,
    balance: full.balance,
    windowMode: full.windowMode,
    windowLabel: full.windowLabel,
    addDropUrl: full.addDropUrl,
    rosteredIds: full.rosteredIds,
  };
  return { success: true, context, claims };
}
