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

// Temporary mapping to cover cases where MFL auth response omits franchise
const USER_FRANCHISE_OVERRIDES: Record<string, string> = {
  // username/userId (lowercased) -> franchiseId
  braven112: '0001',
};

const normalizeFranchise = (value: string | null | undefined): string => {
  if (!value) return '';
  const trimmed = `${value}`.trim();
  if (!trimmed) return '';
  return /^\d+$/.test(trimmed) ? trimmed.padStart(4, '0') : trimmed;
};

const applyFranchiseOverride = (user: AuthUser): AuthUser => {
  if (user.franchiseId) return user;
  const candidates = [user.id, user.name]
    .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v?.toLowerCase?.()))
    .filter(Boolean) as string[];
  for (const key of candidates) {
    const override = USER_FRANCHISE_OVERRIDES[key];
    if (override) {
      return { ...user, franchiseId: normalizeFranchise(override) };
    }
  }
  return user;
};

/**
 * Get authenticated user from request
 * Checks multiple sources for authentication (in priority order):
 * 1. Session JWT from httpOnly cookie (primary auth method)
 * 2. Authorization header with Bearer token
 * 3. X-User-Context header (sent by message board or test harness)
 * 4. X-Auth-User header (colon-delimited format for test)
 */
export function getAuthUser(request: Request): AuthUser | null {

  // Priority 1: Check for session JWT in cookies
  const cookieHeader = request.headers.get('cookie');
  console.log('[auth.ts] cookieHeader present?', !!cookieHeader);
  const sessionToken = getSessionTokenFromCookie(cookieHeader);
  console.log('[auth.ts] sessionToken found?', !!sessionToken);

  if (sessionToken) {
    const sessionData = validateSessionToken(sessionToken);
    console.log('[auth.ts] sessionData valid?', !!sessionData);
    if (sessionData) {
      return applyFranchiseOverride({
        id: sessionData.userId,
        name: sessionData.username,
        franchiseId: sessionData.franchiseId,
        leagueId: sessionData.leagueId,
        role: sessionData.role,
      });
    }
  }

  // Priority 2: Check Authorization header with Bearer token
  const authHeader = request.headers.get('authorization');
  // TODO: Implement JWT token validation from Authorization header
  // if (authHeader?.startsWith('Bearer ')) {
  //   const token = authHeader.substring(7);
  //   return validateJWT(token);
  // }

  // Priority 3: Check for user context header (sent by message board or test harness)
  const userContextHeader = request.headers.get('x-user-context');
  if (userContextHeader) {
    try {
      const rawUser = JSON.parse(userContextHeader) as AuthUser;
      const user = applyFranchiseOverride({
        id: rawUser.id,
        name: rawUser.name,
        franchiseId: rawUser.franchiseId,
        leagueId: rawUser.leagueId,
        role: rawUser.role,
      });
      if (user.id && user.franchiseId && user.leagueId) {
        return user;
      }
    } catch {
      // Invalid JSON in header, continue checking
    }
  }

  // Priority 4: Check for X-Auth-User header with format: "id:franchiseId:leagueId:name:role"
  const userHeader = request.headers.get('x-auth-user');
  if (userHeader) {
    const parts = userHeader.split(':');
    if (parts.length >= 3) {
      return applyFranchiseOverride({
        id: parts[0],
        franchiseId: parts[1],
        leagueId: parts[2],
        name: parts[3] || 'User',
        role: (parts[4] as any) || 'owner',
      });
    }
  }

  return null;
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
