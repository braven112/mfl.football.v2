/**
 * Access gate for the Owners' Poll ballot page.
 *
 * Its own module for the same reason as custom-rankings-access.ts: the check
 * is shared by every league route but the REDIRECT cannot be.
 * `Astro.redirect()` only produces a redirect from a page, endpoint, or
 * middleware — returned from a component's frontmatter it merely stops
 * rendering and serves a blank 200. So the routes own the redirect and share
 * this.
 */

import type { LeagueDefinition } from '../config/leagues';
import { getLeagueBySlug } from '../config/leagues';
import { getLeagueContext } from './league-context';
import { getAuthUser, isAuthorizedForLeague, type AuthUser } from './auth';

export interface OwnersPollAccess {
  user: AuthUser;
  league: LeagueDefinition;
}

/**
 * Resolve the session allowed to cast a ballot in THIS league's poll, or null.
 *
 * Mirrors what the API enforces, because a page that renders a ballot the API
 * will refuse is worse than a redirect. Every owner may vote — including for
 * their own team, which is the point — but:
 *
 * - the session must belong to THIS league (franchise ids collide across
 *   leagues, so an AFL 0001 opening TheLeague's ballot would be voting as a
 *   different team);
 * - a session with no franchise is refused rather than allowed to address a
 *   shared key;
 * - a league that doesn't run the poll has no ballot to render.
 */
export function resolveOwnersPollAccess(
  request: Request,
  url: URL,
): OwnersPollAccess | null {
  const league = getLeagueBySlug(getLeagueContext(url).slug);
  if (!league) return null;
  if (!league.ownersPoll?.enabled) return null;

  const user = getAuthUser(request);
  if (!user) return null;
  if (!isAuthorizedForLeague(user, league.id)) return null;
  if (!user.franchiseId) return null;

  return { user, league };
}
