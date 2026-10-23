/**
 * Who may read the forum archive: signed-in TheLeague owners only. Old posts
 * can be personal, so the pages, the download and Ask Schefter all gate here,
 * and nothing in the archive is ever served to a signed-out visitor or to a
 * session from another league (both leagues have a franchise 0001).
 */
import {
  franchiseIdForLeague,
  getAuthUser,
  isAuthorizedForLeague,
  isCommissionerOrAdminForLeague,
  type AuthUser,
} from '../auth';
import { getLeagueBySlug, type LeagueDefinition } from '../../config/leagues';

export const FORUM_ARCHIVE_LEAGUE_SLUG = 'theleague';

/**
 * Owners the commissioner has handed the full download to, by franchise id.
 * The download is admin-only by default (commissioner's call, 2026-10-22): reading the
 * archive on the site is for every owner, but a copy of the whole thing leaves
 * the site, so it goes only to the owners named here.
 */
export const FORUM_ARCHIVE_DOWNLOAD_FRANCHISES: readonly string[] = [];

export interface ArchiveAccess {
  league: LeagueDefinition;
  user: AuthUser | null;
  /** A signed-in owner of this league. */
  member: boolean;
  /** May import a new copy of the archive. */
  commissioner: boolean;
  /** May download the whole archive: admins, plus the franchises named above. */
  download: boolean;
}

export function forumArchiveAccess(request: Request): ArchiveAccess {
  const league = getLeagueBySlug(FORUM_ARCHIVE_LEAGUE_SLUG)!;
  const user = getAuthUser(request);
  const commissioner = !!user && isCommissionerOrAdminForLeague(user, league.id);
  const franchiseId = franchiseIdForLeague(user, league.id);
  return {
    league,
    user,
    member: !!user && isAuthorizedForLeague(user, league.id),
    commissioner,
    download: commissioner || (!!franchiseId && FORUM_ARCHIVE_DOWNLOAD_FRANCHISES.includes(franchiseId)),
  };
}
