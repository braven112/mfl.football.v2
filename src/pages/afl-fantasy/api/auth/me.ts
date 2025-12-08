/**
 * API Endpoint: GET /api/auth/me
 * Returns current authenticated user session
 */

import type { APIRoute } from 'astro';
import { getSessionTokenFromCookie, validateSessionToken } from '../../../../utils/session';

const normalizeFranchise = (value: string | null | undefined): string => {
  if (!value) return '';
  const trimmed = `${value}`.trim();
  if (!trimmed) return '';
  return /^\d+$/.test(trimmed) ? trimmed.padStart(4, '0') : trimmed;
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
      franchiseId: normalizeFranchise(sessionData.franchiseId),
      leagueId: sessionData.leagueId,
      role: sessionData.role,
    };

    // Dev logging to verify override application
    if (process.env.NODE_ENV !== 'production') {
      console.log('[api/auth/me] sessionData', sessionData);
      console.log('[api/auth/me] baseUser', baseUser);
    }

    return new Response(
      JSON.stringify({
        authenticated: true,
        user: {
          userId: baseUser.id,
          username: baseUser.name,
          franchiseId: baseUser.franchiseId,
          leagueId: baseUser.leagueId,
          role: baseUser.role,
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
