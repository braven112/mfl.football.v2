/**
 * API Endpoint: GET /api/auth/me
 * Returns current authenticated user session
 */

import type { APIRoute } from 'astro';
import { getSessionTokenFromCookie, validateSessionToken } from '../../../utils/session';

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
    return new Response(
      JSON.stringify({
        authenticated: true,
        user: {
          userId: sessionData.userId,
          username: sessionData.username,
          franchiseId: sessionData.franchiseId,
          leagueId: sessionData.leagueId,
          role: sessionData.role,
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
