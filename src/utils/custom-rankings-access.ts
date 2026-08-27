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
import { getAuthUser, isAuthorizedForLeague, type AuthUser } from './auth';

export interface CustomRankingsAccess {
  user: AuthUser;
  league: LeagueDefinition;
}

/**
 * Resolve the session allowed to open THIS league's board, or null.
 *
 * Open to EVERY owner since the board gained My Draft List sync — the thing it
 * now writes is the owner's own MFL draft list, which MFL will only accept
 * from that owner's own cookie, so there is nothing here for an admin to do on
 * someone else's behalf and no reason to withhold it from the owners it
 * belongs to. (It was admin-only while it was an unreleased experiment.)
 *
 * The session must still belong to the league whose page this is: franchise
 * ids collide across leagues, so an AFL 0001 session opening TheLeague's board
 * would load — and then save over — a different team's rankings. That check is
 * what makes the per-franchise KV key unambiguous, and it is now the ONLY gate,
 * so it carries more weight than it did.
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
  // A session with no franchise would share the bare KV key with every other
  // such session — the same reason kv-franchise-store rejects it.
  if (!user.franchiseId) return null;

  return { user, league };
}
