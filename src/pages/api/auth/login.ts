import type { APIRoute } from 'astro';
import { authenticateWithMFL } from '../../../utils/mfl-login';
import { createSessionToken, createSessionCookie, createMFLCookies } from '../../../utils/session';
import { setTheLeaguePreference } from '../../../utils/team-preferences';

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const body = await request.json();
    const { username, password, leagueId, year } = body;

    // Validate inputs
    if (!username || !password) {
      return new Response(
        JSON.stringify({ success: false, message: 'Username and password are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Authenticate with MFL — year override lets AFL pass 2025 because
    // the AFL 2026 league hasn't been created on MFL yet.
    const seasonYear = Number.isInteger(Number(year)) ? Number(year) : undefined;
    const mflResponse = await authenticateWithMFL(username, password, leagueId, seasonYear);

    if (!mflResponse.success) {
      return new Response(
        JSON.stringify({
          success: false,
          message: mflResponse.error || 'Authentication failed',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!mflResponse.franchiseId) {
      // Forward the more specific error from the MFL resolver so the user
      // gets a useful message ("not a member of league X", "no leagues
      // found", etc.) instead of a generic "contact the commissioner".
      return new Response(
        JSON.stringify({
          success: false,
          message:
            mflResponse.error ||
            'Login succeeded but your franchise could not be determined. Contact the commissioner.',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create JWT session
    const sessionToken = createSessionToken({
      userId: mflResponse.userId || username,
      username,
      franchiseId: mflResponse.franchiseId,
      leagueId: mflResponse.leagueId || leagueId || '',
      role: (mflResponse.role as 'owner' | 'commissioner' | 'admin') || 'owner',
    });

    // Set session cookie
    const isDev = import.meta.env.DEV;
    const sessionCookie = createSessionCookie(sessionToken, isDev);

    // Set team preference cookie
    setTheLeaguePreference(cookies, mflResponse.franchiseId);

    // Build all Set-Cookie headers: session + MFL credentials
    const setCookieHeaders = [sessionCookie];
    if (mflResponse.userId) {
      setCookieHeaders.push(
        ...createMFLCookies(mflResponse.userId, mflResponse.commishCookie, isDev),
      );
    }

    const headers = new Headers({ 'Content-Type': 'application/json' });
    for (const cookie of setCookieHeaders) {
      headers.append('Set-Cookie', cookie);
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          userId: mflResponse.userId || username,
          username,
          franchiseId: mflResponse.franchiseId,
          leagueId: mflResponse.leagueId || leagueId || '',
          role: mflResponse.role || 'owner',
        },
      }),
      { status: 200, headers },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ success: false, message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
