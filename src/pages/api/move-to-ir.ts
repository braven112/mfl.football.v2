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
import { getCurrentLeagueYear, getRolloverLeagueYear } from '../../utils/league-year';
import { createMFLApiClient } from '../../utils/mfl-matchup-api';
import { bustRosterCaches } from '../../utils/mfl-roster-cache';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../utils/api-response';
import { DEFAULT_LEAGUE_ID, getLeagueById } from '../../config/leagues';

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

    const leagueId = user.leagueId || DEFAULT_LEAGUE_ID;
    // Leagues roll to the new MFL year on different clocks (TheLeague Feb 14,
    // AFL June 1) — same rule cut-player.ts follows.
    const league = getLeagueById(leagueId);
    const year = league?.leagueYearRollover
      ? getRolloverLeagueYear(league.leagueYearRollover)
      : getCurrentLeagueYear();

    const mflClient = createMFLApiClient({
      leagueId,
      year: String(year),
      mflUserId: user.id,
    });

    // Verify the player is on the user's roster (active OR currently on IR),
    // reading MFL live — never the roster cache, which can lag a write.
    const rosters = await mflClient.getRosterEntries();
    const userRoster = rosters[user.franchiseId] || [];
    const entry = userRoster.find((p) => p.id === playerId);
    if (!entry) {
      return new Response(
        JSON.stringify({ success: false, message: 'You can only move players from your own roster.' }),
        { status: 403, headers: JSON_HEADERS },
      );
    }

    // Already where the owner asked to put him. MFL answers a repeat
    // DEACTIVATE with "Cannot Be Deactivated Because Is Not On Franchise …
    // Roster" (it means the ACTIVE roster), which reads as if the player had
    // been dropped. Report the real state instead, as a success, so a page
    // still showing the pre-move roster catches up rather than erroring.
    const onIR = entry.status === 'INJURED_RESERVE';
    if ((direction === 'to' && onIR) || (direction === 'from' && !onIR)) {
      await bustRosterCaches(String(year), leagueId).catch(() => {});
      const message = direction === 'to' ? 'Player is already on IR' : 'Player is already active';
      return new Response(
        JSON.stringify({ success: true, message, alreadyDone: true }),
        { status: 200, headers: JSON_HEADERS },
      );
    }

    const result = await mflClient.movePlayerToIR(playerId, user.franchiseId, direction);

    if (!result.success) {
      // 503 for a deployment that refused to send, not 400/500 — a blocked
      // staging write is neither the owner's mistake nor an MFL failure.
      return new Response(
        JSON.stringify({
          success: false,
          message: result.error || 'MFL rejected the IR move.',
          blocked: result.blocked === true,
        }),
        { status: result.blocked ? 503 : 400, headers: JSON_HEADERS },
      );
    }

    // The roster page reads a 60 s Redis cache; without this bust a reload
    // right after the move still shows the player on the active roster.
    await bustRosterCaches(String(year), leagueId).catch(() => {});

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
