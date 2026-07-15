/**
 * POST /api/trade-bait
 *
 * Add or remove a player from the authenticated user's trade block on MFL.
 * Uses the user's MFL cookie (authUser.id) for per-user authentication,
 * NOT the server-level process.env.MFL_USER_ID.
 *
 * Security:
 * - Validates the player belongs to the user's roster before allowing add
 * - Scopes all MFL writes to the authenticated user's franchise
 * - Never uses commissioner credentials for owner-level operations
 *
 * MFL's tradeBait import is a destructive overwrite — we read the current
 * list, merge/remove the player, then write back the complete list.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { createMFLApiClient } from '../../utils/mfl-matchup-api';
import { getLeagueYearForMflId } from '../../utils/league-year';
import { getLeagueById, getLeagueBySlug, DEFAULT_LEAGUE_ID, DEFAULT_LEAGUE_SLUG } from '../../config/leagues';
import { overwriteTradeBaitCache } from '../../utils/mfl-trade-bait-cache';
import fs from 'node:fs';
import path from 'node:path';
import { JSON_HEADERS } from '../../utils/api-response';

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
    // League year comes from the league's own rollover clock (AFL rolls
    // June 1, not TheLeague's Feb 14) — between the two dates the clocks
    // disagree and the wrong one targets an MFL league year that doesn't
    // exist yet. Shared helper keeps this route on the same clock as the
    // trade routes and the pages that read the caches this route writes.
    const leagueId = user.leagueId || DEFAULT_LEAGUE_ID;
    const leagueYear = getLeagueYearForMflId(leagueId);
    const mflClient = createMFLApiClient({
      leagueId,
      year: String(leagueYear),
      mflUserId: user.id, // Per-user auth — the user's MFL cookie
    });
    // Local cache directory matches the league we're writing for so AFL
    // updates don't overwrite TheLeague's tradeBait.json (or vice versa).
    const cacheLeague = getLeagueById(leagueId) ?? getLeagueBySlug(DEFAULT_LEAGUE_SLUG)!;

    // 4. SECURITY: Verify the player belongs to the user's roster
    //    This prevents any user from adding players they don't own to trade bait,
    //    and ensures commissioner-level cookies can't modify other teams.
    if (action === 'add') {
      const rosters = await mflClient.getRosters();
      const userRoster = rosters[user.franchiseId];

      if (!userRoster || !userRoster.includes(playerId)) {
        return new Response(
          JSON.stringify({
            error: 'You can only add players from your own roster to the trade block.',
          }),
          { status: 403, headers: JSON_HEADERS },
        );
      }
    }

    // 5. Perform the read-merge-write operation
    const result = await mflClient.updateTradeBait(playerId, action, user.franchiseId);

    if (result.success) {
      // Update local tradeBait.json cache so page reloads reflect the change
      // immediately (before the next scheduled MFL sync)
      if (result.allPlayerIds) {
        try {
          const cachePath = path.resolve(
            process.cwd(),
            `${cacheLeague.dataPath}/mfl-feeds/${leagueYear}/tradeBait.json`,
          );
          fs.writeFileSync(cachePath, JSON.stringify(result.allPlayerIds, null, 2), 'utf8');
        } catch (cacheErr) {
          // Cache update is best-effort — don't fail the request
          console.warn('Failed to update local tradeBait.json cache:', cacheErr);
        }
      }

      // Refresh the live Redis cache with the post-write state so the very
      // next page load shows the change. The file writes below are dev-only
      // conveniences — on Vercel the deployed filesystem is read-only and
      // pages bundle feed JSON at build time, so Redis is the only path
      // that makes a flag visible before the next data-sync deploy.
      if (result.byFranchise) {
        await overwriteTradeBaitCache(String(leagueYear), leagueId, result.byFranchise);
      }

      // Also refresh the franchise-attributed cache — UIs prefer it because the
      // flat list can't say WHO flagged a player (both AFL conferences roster
      // the same NFL player pool, so a bare id matches two teams).
      if (result.byFranchise) {
        try {
          const byFranchisePath = path.resolve(
            process.cwd(),
            `${cacheLeague.dataPath}/mfl-feeds/${leagueYear}/tradeBait-by-franchise.json`,
          );
          fs.writeFileSync(
            byFranchisePath,
            JSON.stringify({ fetchedAt: Date.now(), franchises: result.byFranchise }, null, 2),
            'utf8',
          );
        } catch (cacheErr) {
          console.warn('Failed to update local tradeBait-by-franchise.json cache:', cacheErr);
        }
      }

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
