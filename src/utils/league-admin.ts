/**
 * Who may change a league's SETTINGS — the persona, News Ops, and (next) the
 * branding editor.
 *
 * A league's own commissioner may, for their own league only. The site's
 * PLATFORM ADMINS may, for every league: the site owner runs the standard
 * package for other people's leagues and has to be able to set a client's
 * persona or fix a team's branding without holding a franchise in it.
 *
 * ── HOW A PLATFORM ADMIN IS RECOGNISED ────────────────────────────────────
 * By the MFL account name in the signed session (`AuthUser.name`). That field
 * is only ever written by /api/auth/login, and only AFTER MFL has accepted the
 * password for it, so it is an authenticated identity — never a request
 * parameter, never a cookie a browser can set. Compared case-insensitively,
 * because MFL accepts either case at sign-in.
 *
 * It is deliberately NOT the franchise id: both leagues have a franchise 0001,
 * and "admin franchise" lists are per-league (nav-config adminFranchiseIds).
 *
 * ── SCOPE ─────────────────────────────────────────────────────────────────
 * League settings only. This does NOT make a platform admin a commissioner in
 * MFL, and it is not consulted by the MFL-write routes (lineups, contracts,
 * accounting) — those act AS a franchise and stay session-scoped.
 */
import type { AuthUser } from './auth';
import { isCommissionerOrAdmin, isAuthorizedForLeague } from './auth';
import { getLeagueById, getLeagueBySlug, type LeagueDefinition } from '../config/leagues';

/** MFL account names with settings access to every league. Lowercase. */
export const PLATFORM_ADMIN_USERNAMES: readonly string[] = ['braven112'];

export function isPlatformAdmin(user: Pick<AuthUser, 'name'> | null | undefined): boolean {
  const name = typeof user?.name === 'string' ? user.name.trim().toLowerCase() : '';
  return name !== '' && PLATFORM_ADMIN_USERNAMES.includes(name);
}

/** May this user change `league`'s settings? */
export function canAdministerLeague(user: AuthUser | null | undefined, league: LeagueDefinition | null | undefined): boolean {
  if (!user || !league) return false;
  if (isPlatformAdmin(user)) return true;
  return isCommissionerOrAdmin(user) && isAuthorizedForLeague(user, league.id);
}

export type AdministeredLeague =
  | { ok: true; league: LeagueDefinition }
  | { ok: false; status: 401 | 403; error: string };

/**
 * The league a settings API call acts on.
 *
 * A commissioner acts on their SESSION's league, full stop; a `?league=` that
 * names a different one is refused rather than ignored, so a page that sent
 * the wrong league fails loudly instead of quietly editing another. A
 * platform admin may name any registered league (defaulting to their session's).
 */
export function resolveAdministeredLeague(
  user: AuthUser | null | undefined,
  requestedSlug: string | null | undefined,
): AdministeredLeague {
  if (!user) return { ok: false, status: 401, error: 'Sign in required.' };
  const requested = requestedSlug ? getLeagueBySlug(requestedSlug) : null;
  if (requestedSlug && !requested) return { ok: false, status: 403, error: 'Unknown league.' };

  if (isPlatformAdmin(user)) {
    const league = requested ?? getLeagueByIdSafe(user.leagueId);
    return league ? { ok: true, league } : { ok: false, status: 403, error: 'Pick a league.' };
  }

  if (!isCommissionerOrAdmin(user)) return { ok: false, status: 403, error: 'Commissioner only.' };
  const own = getLeagueByIdSafe(user.leagueId);
  if (!own) return { ok: false, status: 403, error: 'Unknown league.' };
  if (requested && requested.id !== own.id) {
    return { ok: false, status: 403, error: 'That league is not yours to change.' };
  }
  return { ok: true, league: own };
}

function getLeagueByIdSafe(id: string | null | undefined): LeagueDefinition | null {
  return id ? (getLeagueById(id) ?? null) : null;
}
