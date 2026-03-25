/**
 * GET /api/contracts/verify
 *
 * Fetches current salary data from MFL and returns it so the commissioner
 * can verify that contract writes actually took effect.
 * Returns a map of playerId → { salary, contractYear, contractInfo }.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../../utils/auth';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MFL_HOST = process.env.MFL_HOST || 'https://api.myfantasyleague.com';
const MFL_LEAGUE_ID = process.env.MFL_LEAGUE_ID || '13522';
const MFL_USER_ID = process.env.MFL_USER_ID || '';

interface MFLSalaryPlayer {
  id: string;
  salary: string;
  contractYear: string;
  contractInfo: string;
}

export const GET: APIRoute = async ({ request }) => {
  try {
    const user = getAuthUser(request);
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: JSON_HEADERS },
      );
    }

    if (!isCommissionerOrAdmin(user)) {
      return new Response(
        JSON.stringify({ error: 'Commissioner access required' }),
        { status: 403, headers: JSON_HEADERS },
      );
    }

    const year = new Date().getFullYear();
    const url = `${MFL_HOST}/${year}/export?TYPE=salaries&L=${MFL_LEAGUE_ID}&JSON=1`;

    const response = await fetch(url, {
      headers: MFL_USER_ID ? { Cookie: `MFL_USER_ID=${MFL_USER_ID}` } : {},
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `MFL API returned ${response.status}` }),
        { status: 502, headers: JSON_HEADERS },
      );
    }

    const data = await response.json();
    const players: MFLSalaryPlayer[] = data?.salaries?.leagueUnit?.player ?? [];

    // Build a lookup map: playerId → contract info
    const contracts: Record<string, { salary: string; contractYear: string; contractInfo: string }> = {};
    for (const p of players) {
      contracts[p.id] = {
        salary: p.salary,
        contractYear: p.contractYear,
        contractInfo: p.contractInfo,
      };
    }

    return new Response(
      JSON.stringify({ contracts, playerCount: players.length }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch (error) {
    console.error('Verify contracts error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
};
