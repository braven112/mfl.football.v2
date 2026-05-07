/**
 * POST /api/move-to-ir
 *
 * Move a player to / from the user's Injured Reserve via MFL's
 * import?TYPE=ir endpoint. Owner-mode auth only — never uses commish creds.
 *
 * Body: { playerId: string, direction?: 'to' | 'from' }
 *   direction='to'   (default) — move ACTIVE → IR
 *   direction='from'           — move IR → ACTIVE
 *
 * Validates that the player is on the user's roster before submitting.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getCurrentLeagueYear } from '../../utils/league-year';
import { createMFLApiClient } from '../../utils/mfl-matchup-api';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);

  if (!user) {
    return new Response(
      JSON.stringify({ success: false, message: 'Authentication required. Please sign in to manage your roster.' }),
      { status: 401, headers: JSON_HEADERS },
    );
  }

  if (!user.id) {
    return new Response(
      JSON.stringify({ success: false, message: 'MFL session not found. Please sign in again.' }),
      { status: 401, headers: JSON_HEADERS },
    );
  }

  if (!user.franchiseId) {
    return new Response(
      JSON.stringify({ success: false, message: 'No franchise associated with your account.' }),
      { status: 403, headers: JSON_HEADERS },
    );
  }

  try {
    const body = await request.json();
    const playerId = body?.playerId ? String(body.playerId) : '';
    const direction: 'to' | 'from' = body?.direction === 'from' ? 'from' : 'to';

    if (!playerId || !/^\d+$/.test(playerId)) {
      return new Response(
        JSON.stringify({ success: false, message: 'Missing or invalid playerId' }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    const year = getCurrentLeagueYear();
    const leagueId = user.leagueId || '13522';

    const mflClient = createMFLApiClient({
      leagueId,
      year: String(year),
      mflUserId: user.id,
    });

    // Verify the player is on the user's roster (active OR currently on IR)
    const rosters = await mflClient.getRosters();
    const userRoster = rosters[user.franchiseId] || [];
    if (!userRoster.includes(playerId)) {
      return new Response(
        JSON.stringify({ success: false, message: 'You can only move players from your own roster.' }),
        { status: 403, headers: JSON_HEADERS },
      );
    }

    const result = await mflClient.movePlayerToIR(playerId, user.franchiseId, direction);

    if (!result.success) {
      return new Response(
        JSON.stringify({ success: false, message: result.error || 'MFL rejected the IR move.' }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    const message = direction === 'to' ? 'Player moved to IR' : 'Player activated from IR';
    return new Response(
      JSON.stringify({ success: true, message }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch (error) {
    console.error('[move-to-ir] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error. Please try again.' }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
};
