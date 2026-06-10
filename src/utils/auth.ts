/**
 * Authentication Utilities
 * Handles user authentication and authorization
 *
 * Identity comes exclusively from the signed session JWT. Unsigned identity
 * headers (X-User-Context / X-Auth-User) were removed — they let any client
 * claim any franchise or the admin role. Do not re-add them; for local
 * testing, mint a real session via the login flow or createSessionToken().
 */

import { getSessionTokenFromCookie, validateSessionToken } from './session';
import { isAdminFranchise } from '../config/nav-config';

export interface AuthUser {
  id: string;
  name: string;
  franchiseId: string;
  leagueId: string;
  role: 'owner' | 'commissioner' | 'admin';
}

const normalizeFranchise = (value: string | null | undefined): string => {
  if (!value) return '';
  const trimmed = `${value}`.trim();
  if (!trimmed) return '';
  return /^\d+$/.test(trimmed) ? trimmed.padStart(4, '0') : trimmed;
};

/**
 * Get authenticated user from request.
 * The session JWT in the httpOnly cookie is the only accepted identity source.
 */
export function getAuthUser(request: Request): AuthUser | null {
  const cookieHeader = request.headers.get('cookie');
  const sessionToken = getSessionTokenFromCookie(cookieHeader);
  if (!sessionToken) return null;

  const sessionData = validateSessionToken(sessionToken);
  if (!sessionData) return null;

  return {
    id: sessionData.userId,
    name: sessionData.username,
    franchiseId: normalizeFranchise(sessionData.franchiseId),
    leagueId: sessionData.leagueId,
    role: sessionData.role,
  };
}

/**
 * Verify that user is authenticated
 */
export function requireAuth(user: AuthUser | null): user is AuthUser {
  return user !== null;
}

/**
 * Verify that user owns the franchise they're trying to modify
 */
export function isFranchiseOwner(user: AuthUser, franchiseId: string): boolean {
  return user.franchiseId === franchiseId;
}

/**
 * Verify that user has commissioner-level access.
 * Checks both the JWT role AND the admin franchise list from nav config,
 * so commissioners are recognized even if MFL didn't set the commish cookie at login.
 */
export function isCommissionerOrAdmin(user: AuthUser): boolean {
  if (user.role === 'commissioner' || user.role === 'admin') return true;

  // Fallback: check admin franchise IDs from nav config
  // This handles cases where MFL login didn't return the MFL_IS_COMMISH cookie
  return isAdminFranchise(user.franchiseId);
}

/**
 * Verify that user is authorized for the league
 */
export function isAuthorizedForLeague(user: AuthUser, leagueId: string): boolean {
  return user.leagueId === leagueId;
}
