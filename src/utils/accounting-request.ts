/**
 * Shared gate and context for every /api/accounting route.
 *
 * All four routes need the same five things resolved the same way, and getting
 * any of them wrong writes money into the wrong league. Centralised so the
 * rules are stated once rather than re-derived per route (schedule-plan.ts
 * learned the same lesson: a page gate protects the page, not its API).
 *
 * ── THE TWO CLOCKS ────────────────────────────────────────────────────────
 * This feature straddles both of the repo's year clocks, and they are NOT
 * interchangeable (see CLAUDE.md):
 *
 *   `year`    the MFL LEAGUE year — which league's ledger is being written.
 *             Roster-management-shaped, so getCurrentLeagueYear() (or the
 *             league's own rollover date). This is the ledger you are editing.
 *
 *   `season`  the SEASON being paid — whose results decide the winners.
 *             Results-shaped, so getCurrentSeasonYear().
 *
 * They differ for most of the calendar: settling the 2025 season's prizes in
 * March 2026 writes SEASON 2025's payouts into the 2026 LEAGUE's ledger.
 * Collapsing them into one parameter silently pays the wrong season's winners
 * out of the wrong year's books.
 */

import type { APIContext } from 'astro';
import { getAuthUser, isCommissionerOrAdmin, isAuthorizedForLeague, type AuthUser } from './auth';
import { getMFLCookiesFromRequest } from './session';
import { getLeagueBySlug, type LeagueDefinition } from '../config/leagues';
import { getCurrentLeagueYear, getRolloverLeagueYear, getCurrentSeasonYear } from './league-year';
import { json } from './api-response';

export interface AccountingContext {
  user: AuthUser;
  league: LeagueDefinition;
  /** MFL league year — the ledger being read or written. */
  year: number;
  /** Season whose results decide payouts. */
  season: number;
  /** The commissioner's MFL cookies, straight from their session. */
  mflUserCookie: string;
  mflCommishCookie?: string;
}

const parseYear = (raw: string | null, fallback: number): number => {
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 2000 && value <= 2100 ? value : fallback;
};

/** The MFL league year for this league, honouring its own rollover date. */
export function leagueYearFor(league: LeagueDefinition): number {
  return league.leagueYearRollover
    ? getRolloverLeagueYear(league.leagueYearRollover)
    : getCurrentLeagueYear();
}

/**
 * Resolve and authorize an accounting request.
 *
 * Returns a ready-to-return Response on any failure — callers do:
 *
 *   const ctx = resolveAccountingContext(context);
 *   if (ctx instanceof Response) return ctx;
 */
export function resolveAccountingContext(
  context: Pick<APIContext, 'request' | 'url'>
): AccountingContext | Response {
  const { request, url } = context;

  const user = getAuthUser(request);
  if (!user) return json({ error: 'Authentication required. Please sign in.' }, 401);

  // Every route here reads or writes the WHOLE league's books, including other
  // owners' balances. Owner-level access is not enough for any of them.
  if (!isCommissionerOrAdmin(user)) {
    return json({ error: 'Commissioner access required.' }, 403);
  }

  const slug = url.searchParams.get('league') ?? '';
  const league = getLeagueBySlug(slug);
  if (!league) return json({ error: `Unknown league "${slug}".` }, 400);

  // The slug is a CHECK against the session, never an input on its own: a
  // commissioner of one league must not be able to touch another's books.
  // Same rule as the rankings scope — the authority is always the session.
  if (!isAuthorizedForLeague(user, league.id)) {
    return json({ error: 'Not authorized for this league.' }, 403);
  }

  if (!league.features.accounting) {
    return json({ error: `${league.name} does not have accounting enabled.` }, 400);
  }

  // MFL cookies come from the session cookies our own login set, never from
  // anything the client can supply.
  const { mflUserId, mflIsCommish } = getMFLCookiesFromRequest(request);
  if (!mflUserId) {
    return json(
      { error: 'MFL session not found. Please sign out and sign in again.' },
      401
    );
  }

  return {
    user,
    league,
    year: parseYear(url.searchParams.get('year'), leagueYearFor(league)),
    season: parseYear(url.searchParams.get('season'), getCurrentSeasonYear()),
    mflUserCookie: mflUserId,
    ...(mflIsCommish ? { mflCommishCookie: mflIsCommish } : {}),
  };
}
