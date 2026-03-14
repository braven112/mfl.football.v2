/**
 * API endpoint for moving players to IR
 * Handles one-click IR moves through MFL API
 *
 * Security: Uses the authenticated user's MFL cookie, NOT commish credentials.
 * Validates the player belongs to the user's roster before allowing the move.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { createMFLApiClient } from '../../utils/mfl-matchup-api';
import { getCurrentLeagueYear } from '../../utils/league-year';

export const POST: APIRoute = async ({ request }) => {
  try {
    // 1. Authenticate — must have a logged-in user with an MFL cookie
    const user = getAuthUser(request);
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required. Please sign in to manage your roster.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!user.id) {
      return new Response(
        JSON.stringify({ error: 'MFL session not found. Please sign in again.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!user.franchiseId) {
      return new Response(
        JSON.stringify({ error: 'No franchise associated with your account.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const { playerId } = await request.json();

    if (!playerId) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: playerId' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // 2. Create MFL API client with the USER's cookie (not commish env var)
    const leagueYear = getCurrentLeagueYear();
    const mflClient = createMFLApiClient({
      leagueId: user.leagueId || '13522',
      year: String(leagueYear),
      mflUserId: user.id, // Per-user auth
    });

    // 3. SECURITY: Verify the player belongs to the user's roster
    const rosters = await mflClient.getRosters();
    const userRoster = rosters[user.franchiseId];

    if (!userRoster || !userRoster.includes(playerId)) {
      return new Response(
        JSON.stringify({ error: 'You can only move players from your own roster to IR.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // 4. Attempt to move player to IR using the user's own credentials
    const success = await mflClient.movePlayerToIR(playerId, user.franchiseId);

    if (success) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Player successfully moved to IR',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } else {
      return new Response(
        JSON.stringify({
          error: 'Failed to move player to IR. Please check authentication or try manually.',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  } catch (error) {
    console.error('IR move API error:', error);

    return new Response(
      JSON.stringify({
        error: 'Internal server error. Please try again or use manual IR move.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
