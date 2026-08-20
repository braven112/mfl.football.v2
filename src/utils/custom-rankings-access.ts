/**
 * Access gate for the Custom Rankings board.
 *
 * Lives in its own module because the check is shared by both league routes
 * but the REDIRECT cannot be: `Astro.redirect()` only produces a redirect from
 * a page, endpoint, or middleware. Returning it from a component's frontmatter
 * merely stops rendering, which serves a blank 200 to an unauthorized visitor
 * instead of bouncing them. So the routes own the redirect and share this.
 */

import type { LeagueDefinition } from '../config/leagues';
import { getLeagueBySlug } from '../config/leagues';
import { getLeagueContext } from './league-context';
import { getAuthUser, isAuthorizedForLeague, isCommissionerOrAdmin, type AuthUser } from './auth';

export interface CustomRankingsAccess {
  user: AuthUser;
  league: LeagueDefinition;
}

/**
 * Resolve the session allowed to open THIS league's board, or null.
 *
 * Admin-only (same auth as the nav sidebar), and the session must belong to
 * the league whose page this is: franchise ids collide across leagues, so an
 * AFL 0001 session opening TheLeague's board would load — and then save over —
 * a different team's rankings. `isCommissionerOrAdmin` is already league-scoped
 * internally; the `isAuthorizedForLeague` check is what stops a valid admin in
 * one league from reaching the other's page at all.
 */
export function resolveCustomRankingsAccess(
  request: Request,
  url: URL,
): CustomRankingsAccess | null {
  const league = getLeagueBySlug(getLeagueContext(url).slug);
  if (!league) return null;

  const user = getAuthUser(request);
  if (!user) return null;
  if (!isAuthorizedForLeague(user, league.id)) return null;
  if (!isCommissionerOrAdmin(user)) return null;

  return { user, league };
}
