/**
 * Who may read the forum archive: signed-in TheLeague owners only. Old posts
 * can be personal, so the pages, the download and Ask Schefter all gate here,
 * and nothing in the archive is ever served to a signed-out visitor or to a
 * session from another league (both leagues have a franchise 0001).
 */
import {
  getAuthUser,
  isAuthorizedForLeague,
  isCommissionerOrAdminForLeague,
  type AuthUser,
} from '../auth';
import { getLeagueBySlug, type LeagueDefinition } from '../../config/leagues';

export const FORUM_ARCHIVE_LEAGUE_SLUG = 'theleague';

export interface ArchiveAccess {
  league: LeagueDefinition;
  user: AuthUser | null;
  /** A signed-in owner of this league. */
  member: boolean;
  /** May import a new copy of the archive. */
  commissioner: boolean;
}

export function forumArchiveAccess(request: Request): ArchiveAccess {
  const league = getLeagueBySlug(FORUM_ARCHIVE_LEAGUE_SLUG)!;
  const user = getAuthUser(request);
  return {
    league,
    user,
    member: !!user && isAuthorizedForLeague(user, league.id),
    commissioner: !!user && isCommissionerOrAdminForLeague(user, league.id),
  };
}
