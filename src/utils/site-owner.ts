/**
 * The site owner's own franchises — the gate for pages that are Brandon's
 * alone, not every commissioner's (his private rankings board).
 *
 * `isCommissionerOrAdmin` is the wrong gate for these: it passes any league
 * commissioner and TheLeague's shared 0000 commissioner login. A personal page
 * opens only for the session of the franchise the owner himself runs, in the
 * league that session belongs to — both leagues have a franchise 0001, so the
 * league test is what makes the id mean "Brandon" (the same reason
 * `franchiseIdForLeague` exists).
 */

import type { AuthUser } from './auth';
import { franchiseIdForLeague } from './auth';
import { getLeagueBySlug } from '../config/leagues';

/** The franchise the site owner runs, per registry league slug. */
export const SITE_OWNER_FRANCHISES: Readonly<Record<string, string>> = {
  theleague: '0001',
  'afl-fantasy': '0001',
};

/** The owner's franchise in a league, or null where he has none. */
export function siteOwnerFranchise(slug: string): string | null {
  return SITE_OWNER_FRANCHISES[slug] ?? null;
}

/** True only for the owner's own session, signed in to the league `slug`. */
export function isSiteOwnerIn(user: AuthUser | null | undefined, slug: string): boolean {
  const league = getLeagueBySlug(slug);
  const mine = siteOwnerFranchise(slug);
  if (!league || !mine) return false;
  return franchiseIdForLeague(user, league.id) === mine;
}
