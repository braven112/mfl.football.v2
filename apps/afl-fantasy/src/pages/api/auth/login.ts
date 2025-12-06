/**
 * API Endpoint: POST /api/auth/login
 * Authenticates user against MFL API and creates session
 */

import type { APIRoute } from 'astro';
import { authenticateWithMFL, createSessionToken, createSessionCookie } from '@mfl/shared-utils';

interface LoginRequest {
  username: string;
  password: string;
  leagueId?: string;
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  try {
    // Only allow POST requests
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({
          error: 'Method not allowed',
        }),
        {
          status: 405,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Parse request body
    const body: LoginRequest = await request.json();

    // Validate input
    if (!body.username || !body.password) {
      return new Response(
        JSON.stringify({
          error: 'Invalid request',
          message: 'Username and password are required',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Authenticate with MFL
    const mflResult = await authenticateWithMFL(
      body.username,
      body.password,
      body.leagueId
    );

    if (!mflResult.success) {
      return new Response(
        JSON.stringify({
          error: 'Authentication failed',
          message: mflResult.error || 'Invalid username or password',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Create session token
    const sessionToken = createSessionToken({
      userId: mflResult.userId || body.username,
      username: mflResult.username || body.username,
      franchiseId: mflResult.franchiseId || '',
      leagueId: mflResult.leagueId || body.leagueId || '',
      role: (mflResult.role as any) || 'owner',
    });

    // Determine if dev environment
    const isDev = process.env.NODE_ENV === 'development' || !process.env.VERCEL;

    // Create session cookie
    const sessionCookie = createSessionCookie(sessionToken, isDev);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Login successful',
        user: {
          username: mflResult.username,
          userId: mflResult.userId,
          franchiseId: mflResult.franchiseId,
          leagueId: mflResult.leagueId,
          role: mflResult.role,
        },
        ...(process.env.NODE_ENV !== 'production'
          ? { debug: { rawResponse: mflResult.rawResponse } }
          : {}),
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': sessionCookie,
        },
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
