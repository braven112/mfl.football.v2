/**
 * API Endpoint: GET /api/auth/me
 * Returns current authenticated user session
 */

import type { APIRoute } from 'astro';
import { getSessionTokenFromCookie, validateSessionToken } from '../../../utils/session';
import { AuthUser } from '../../../utils/auth';

const USER_FRANCHISE_OVERRIDES: Record<string, string> = {
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

export const GET: APIRoute = async ({ request }) => {
  try {
    // Get session token from cookies
    const cookieHeader = request.headers.get('cookie');
    const sessionToken = getSessionTokenFromCookie(cookieHeader);

    // If no token, user is not authenticated
    if (!sessionToken) {
      return new Response(
        JSON.stringify({
          authenticated: false,
          user: null,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate token
    const sessionData = validateSessionToken(sessionToken);

    // If token is invalid or expired, user is not authenticated
    if (!sessionData) {
      return new Response(
        JSON.stringify({
          authenticated: false,
          user: null,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Return authenticated user
    const baseUser = {
      id: sessionData.userId,
      name: sessionData.username,
      franchiseId: sessionData.franchiseId,
      leagueId: sessionData.leagueId,
      role: sessionData.role,
    };
    const user = applyFranchiseOverride(baseUser as AuthUser);

    // Dev logging to verify override application
    if (process.env.NODE_ENV !== 'production') {
      console.log('[api/auth/me] sessionData', sessionData);
      console.log('[api/auth/me] baseUser', baseUser);
      console.log('[api/auth/me] resolvedUser', user);
    }

    return new Response(
      JSON.stringify({
        authenticated: true,
        user: {
          userId: user.id,
          username: user.name,
          franchiseId: user.franchiseId,
          leagueId: user.leagueId,
          role: user.role,
        },
        expiresAt: sessionData.expiresAt,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return new Response(
      JSON.stringify({
        error: 'Server error',
        message: errorMessage,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
