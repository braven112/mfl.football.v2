/**
 * Authentication Utilities
 * Handles user authentication and authorization
 * Currently supports franchise/league context from message board or external auth
 */

import { getSessionTokenFromCookie, validateSessionToken } from './session';

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
 * Unsigned identity headers (X-User-Context / X-Auth-User) were removed — they
 * let any client claim any franchise or the admin role. Do not re-add them.
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
 * Verify that user is authorized for the league
 */
export function isAuthorizedForLeague(user: AuthUser, leagueId: string): boolean {
  return user.leagueId === leagueId;
}
