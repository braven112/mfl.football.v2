/**
 * POST /api/auth/role-switch
 *
 * Switch between owner and commissioner roles.
 * Only available to admin franchise IDs (0001, 0000).
 * Creates a new JWT with the requested role.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { isAdminFranchise } from '../../../config/nav-config';
import { createSessionToken, createSessionCookie } from '../../../utils/session';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const POST: APIRoute = async ({ request }) => {
  try {
    const user = getAuthUser(request);
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: JSON_HEADERS },
      );
    }

    if (!isAdminFranchise(user.franchiseId)) {
      return new Response(
        JSON.stringify({ error: 'Only admin franchises can switch roles' }),
        { status: 403, headers: JSON_HEADERS },
      );
    }

    const body = await request.json();
    const { role } = body as { role: string };

    if (role !== 'owner' && role !== 'commissioner') {
      return new Response(
        JSON.stringify({ error: 'Role must be "owner" or "commissioner"' }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    // Create new JWT with the requested role
    const sessionToken = createSessionToken({
      userId: user.id,
      username: user.name,
      franchiseId: user.franchiseId,
      leagueId: user.leagueId,
      role,
    });

    const isDev = import.meta.env.DEV;
    const sessionCookie = createSessionCookie(sessionToken, isDev);

    return new Response(
      JSON.stringify({ success: true, role }),
      {
        status: 200,
        headers: {
          ...JSON_HEADERS,
          'Set-Cookie': sessionCookie,
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
};
