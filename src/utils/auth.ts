/**
 * Authentication Utilities
 * Handles user authentication and authorization
 * Currently supports franchise/league context from message board or external auth
 */

export interface AuthUser {
  id: string;
  name: string;
  franchiseId: string;
  leagueId: string;
  role: 'owner' | 'commissioner' | 'admin';
}

/**
 * Get authenticated user from request
 * Checks multiple sources for authentication:
 * 1. Authorization header with Bearer token (future JWT implementation)
 * 2. X-Auth-User header with user context (message board or test)
 * 3. Query parameters (for testing/development)
 * 4. Cookies (for future session-based auth)
 */
export function getAuthUser(request: Request): AuthUser | null {
  // Get headers from request
  const authHeader = request.headers.get('authorization');
  const userHeader = request.headers.get('x-auth-user');
  const userContextHeader = request.headers.get('x-user-context');

  // TODO: Implement JWT token validation from Authorization header
  // if (authHeader?.startsWith('Bearer ')) {
  //   const token = authHeader.substring(7);
  //   return validateJWT(token);
  // }

  // Check for user context header (sent by message board or test harness)
  if (userContextHeader) {
    try {
      const user = JSON.parse(userContextHeader) as AuthUser;
      if (user.id && user.franchiseId && user.leagueId) {
        return user;
      }
    } catch {
      // Invalid JSON in header, continue checking
    }
  }

  // Check for X-Auth-User header with format: "id:franchiseId:leagueId:name:role"
  if (userHeader) {
    const parts = userHeader.split(':');
    if (parts.length >= 3) {
      return {
        id: parts[0],
        franchiseId: parts[1],
        leagueId: parts[2],
        name: parts[3] || 'User',
        role: (parts[4] as any) || 'owner',
      };
    }
  }

  // TODO: Check cookies for session-based auth
  // const sessionCookie = request.headers.get('cookie')?.split(';').find(c => c.includes('__session'));

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
