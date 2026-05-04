/**
 * POST /api/move-to-practice
 *
 * Move a rookie to / from the user's Taxi (Practice) Squad via MFL's
 * import?TYPE=taxi_squad endpoint. Owner-mode auth only.
 *
 * Body: { playerId: string, direction?: 'to' | 'from' }
 *   direction='to'   (default) — promote ACTIVE → PRACTICE (rookies only)
 *   direction='from'           — demote PRACTICE → ACTIVE
 *
 * Server enforces:
 *   - Player is on the user's roster
 *   - For direction='to': player has MFL `status === 'R'` (rookie)
 *   - For direction='to': practice squad is not full (TheLeague cap = 3)
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getCurrentLeagueYear } from '../../utils/league-year';
import { createMFLApiClient } from '../../utils/mfl-matchup-api';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const TAXI_SQUAD_LIMIT = 3;

interface MflPlayerRecord {
  id: string;
  status?: string;
  draft_year?: string;
}

async function fetchPlayerStatus(
  year: number,
  leagueId: string,
  playerId: string,
): Promise<MflPlayerRecord | null> {
  const url =
    `https://api.myfantasyleague.com/${year}/export` +
    `?TYPE=players&L=${leagueId}&PLAYERS=${playerId}&DETAILS=1&JSON=1`;
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { players?: { player?: MflPlayerRecord | MflPlayerRecord[] } };
    const raw = data?.players?.player;
    if (!raw) return null;
    const list = Array.isArray(raw) ? raw : [raw];
    return list.find((p) => p.id === playerId) ?? null;
  } catch (error) {
    console.error('[move-to-practice] failed to fetch player status:', error);
    return null;
  }
}

async function fetchPracticeSquadCount(
  year: number,
  leagueId: string,
  franchiseId: string,
): Promise<number | null> {
  const url =
    `https://api.myfantasyleague.com/${year}/export` +
    `?TYPE=rosters&L=${leagueId}&FRANCHISE=${franchiseId}&JSON=1`;
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      rosters?: { franchise?: { id: string; player?: Array<{ id: string; status?: string }> } | Array<{ id: string; player?: Array<{ id: string; status?: string }> }> };
    };
    const raw = data?.rosters?.franchise;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const franchise = list.find((f) => f.id === franchiseId);
    if (!franchise?.player) return 0;
    return franchise.player.filter((p) => p.status === 'TAXI_SQUAD').length;
  } catch (error) {
    console.error('[move-to-practice] failed to fetch practice count:', error);
    return null;
  }
}

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

    const rosters = await mflClient.getRosters();
    const userRoster = rosters[user.franchiseId] || [];
    if (!userRoster.includes(playerId)) {
      return new Response(
        JSON.stringify({ success: false, message: 'You can only move players from your own roster.' }),
        { status: 403, headers: JSON_HEADERS },
      );
    }

    if (direction === 'to') {
      // Gate 1: rookies only (use MFL's own classification)
      const playerRecord = await fetchPlayerStatus(year, leagueId, playerId);
      if (!playerRecord) {
        return new Response(
          JSON.stringify({ success: false, message: 'Could not verify player rookie status. Try again.' }),
          { status: 502, headers: JSON_HEADERS },
        );
      }
      if (playerRecord.status !== 'R') {
        return new Response(
          JSON.stringify({ success: false, message: 'Only rookies can be moved to the practice squad.' }),
          { status: 400, headers: JSON_HEADERS },
        );
      }

      // Gate 2: practice squad cap (TheLeague = 3)
      const practiceCount = await fetchPracticeSquadCount(year, leagueId, user.franchiseId);
      if (practiceCount !== null && practiceCount >= TAXI_SQUAD_LIMIT) {
        return new Response(
          JSON.stringify({
            success: false,
            message: `Your practice squad is full (${practiceCount}/${TAXI_SQUAD_LIMIT}). Demote a rookie first to free a slot.`,
          }),
          { status: 400, headers: JSON_HEADERS },
        );
      }
    }

    const result = await mflClient.movePlayerToTaxi(playerId, user.franchiseId, direction);

    if (!result.success) {
      return new Response(
        JSON.stringify({ success: false, message: result.error || 'MFL rejected the practice squad move.' }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    const message = direction === 'to' ? 'Player moved to practice squad' : 'Player promoted to active roster';
    return new Response(
      JSON.stringify({ success: true, message }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch (error) {
    console.error('[move-to-practice] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error. Please try again.' }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
};
