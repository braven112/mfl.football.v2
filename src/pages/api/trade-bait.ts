/**
 * POST /api/trade-bait
 *
 * Add or remove a player from the authenticated user's trade block on MFL.
 * Uses the user's MFL cookie (authUser.id) for per-user authentication,
 * NOT the server-level process.env.MFL_USER_ID.
 *
 * MFL's tradeBait import is a destructive overwrite — we read the current
 * list, merge/remove the player, then write back the complete list.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { createMFLApiClient } from '../../utils/mfl-matchup-api';
import { getCurrentLeagueYear } from '../../utils/league-year';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface TradeBaitRequestBody {
  playerId: string;
  action: 'add' | 'remove';
}

export const POST: APIRoute = async ({ request }) => {
  try {
    // 1. Authenticate — must have a logged-in user with an MFL cookie
    const user = getAuthUser(request);
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required. Please sign in to manage your trade block.' }),
        { status: 401, headers: JSON_HEADERS },
      );
    }

    if (!user.id) {
      return new Response(
        JSON.stringify({ error: 'MFL session not found. Please sign in again.' }),
        { status: 401, headers: JSON_HEADERS },
      );
    }

    if (!user.franchiseId) {
      return new Response(
        JSON.stringify({ error: 'No franchise associated with your account.' }),
        { status: 403, headers: JSON_HEADERS },
      );
    }

    // 2. Parse and validate request body
    const body = await request.json() as TradeBaitRequestBody;
    const { playerId, action } = body;

    if (!playerId || typeof playerId !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid playerId' }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    if (action !== 'add' && action !== 'remove') {
      return new Response(
        JSON.stringify({ error: 'Invalid action. Must be "add" or "remove".' }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    // 3. Create MFL API client with the USER's cookie (not the server env var)
    const leagueYear = getCurrentLeagueYear();
    const mflClient = createMFLApiClient({
      leagueId: user.leagueId || '13522',
      year: String(leagueYear),
      mflUserId: user.id, // Per-user auth — the user's MFL cookie
    });

    // 4. Perform the read-merge-write operation
    const result = await mflClient.updateTradeBait(playerId, action, user.franchiseId);

    if (result.success) {
      return new Response(
        JSON.stringify({
          success: true,
          message: action === 'add'
            ? 'Player added to your trade block'
            : 'Player removed from your trade block',
        }),
        { status: 200, headers: JSON_HEADERS },
      );
    } else {
      return new Response(
        JSON.stringify({ error: result.error || 'Failed to update trade block' }),
        { status: 500, headers: JSON_HEADERS },
      );
    }
  } catch (error) {
    console.error('Trade bait API error:', error);

    return new Response(
      JSON.stringify({
        error: 'Internal server error. Please try again or manage your trade bait directly on MFL.',
      }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
};
