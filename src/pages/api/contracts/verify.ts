/**
 * GET /api/contracts/verify
 *
 * Fetches current salary data from MFL and returns it so the commissioner
 * can verify that contract writes actually took effect.
 * Returns a map of playerId → { salary, contractYear, contractInfo }.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../../utils/auth';
import { buildMflExportUrl } from '../../../utils/mfl-url';
import { mflFetch } from '../../../utils/mfl-fetch';
import { JSON_HEADERS } from '../../../utils/api-response';
import { DEFAULT_LEAGUE_ID } from '../../../config/leagues';

const MFL_HOST = process.env.MFL_HOST || 'https://api.myfantasyleague.com';
const MFL_LEAGUE_ID = process.env.MFL_LEAGUE_ID || DEFAULT_LEAGUE_ID;
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

    // The salaries export is owner-gated: an anonymous read returns a
    // well-formed EMPTY payload with HTTP 200. This route exists to prove a
    // contract write landed, so answering "0 players, all good" without
    // credentials is the exact false confirmation it is meant to catch.
    if (!MFL_USER_ID) {
      return new Response(
        JSON.stringify({ error: 'Server is not configured with MFL credentials — cannot verify' }),
        { status: 503, headers: JSON_HEADERS },
      );
    }

    const year = new Date().getFullYear();
    const url = buildMflExportUrl({ type: 'salaries', leagueId: MFL_LEAGUE_ID, year, host: MFL_HOST });

    // mflFetch, not bare fetch — undici drops Cookie on the api→www49 302 and
    // MFL answers "requires a logged in user" with a 200 that parses as empty.
    const response = await mflFetch({ url, method: 'GET', mflUserCookie: MFL_USER_ID });

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
