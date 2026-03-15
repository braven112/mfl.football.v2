/**
 * GET /api/auction
 *
 * Proxies MFL transactions endpoint, filters to AUCTION_* events,
 * and returns derived auction state (active auctions, completed, team summaries).
 *
 * Query params:
 *   - franchise (optional): Filter to a specific franchise's activity
 *   - year (optional): Override league year (defaults to currentLeagueYear)
 *
 * Returns pre-computed auction state so the client doesn't need to
 * process raw transactions — just render the data.
 */

import type { APIRoute } from 'astro';
import { getCurrentLeagueYear } from '../../utils/league-year';
import {
  deriveAuctionState,
  type MflAuctionTransaction,
  type AuctionState,
} from '../../utils/auction-utils';

export const prerender = false;

const DEFAULT_HOST = 'https://api.myfantasyleague.com';
const DEFAULT_LEAGUE_ID = '13522';
const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};

export const GET: APIRoute = async ({ url }) => {
  const year = url.searchParams.get('year') || getCurrentLeagueYear().toString();
  const leagueId = url.searchParams.get('L') || DEFAULT_LEAGUE_ID;
  const host = url.searchParams.get('host') || DEFAULT_HOST;

  try {
    // Fetch transactions from MFL
    const mflUrl = `${host}/${year}/export?TYPE=transactions&L=${leagueId}&JSON=1`;
    const response = await fetch(mflUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' },
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `MFL API error: ${response.status}`, active: [], completed: [], teamSummaries: {} }),
        { status: 502, headers: JSON_HEADERS }
      );
    }

    const data = await response.json();

    // Extract transactions array (MFL returns single object or array)
    let transactions: any[] = [];
    if (data?.transactions?.transaction) {
      transactions = Array.isArray(data.transactions.transaction)
        ? data.transactions.transaction
        : [data.transactions.transaction];
    }

    // Filter to auction events only
    const auctionTransactions: MflAuctionTransaction[] = transactions.filter(
      (t: any) =>
        t.type === 'AUCTION_INIT' ||
        t.type === 'AUCTION_BID' ||
        t.type === 'AUCTION_WON'
    );

    // Derive full state
    const state = deriveAuctionState(auctionTransactions);

    // Serialize team summaries (Map → object)
    const teamSummariesObj: Record<string, any> = {};
    for (const [id, summary] of state.teamSummaries) {
      teamSummariesObj[id] = summary;
    }

    return new Response(
      JSON.stringify({
        active: state.active,
        completed: state.completed,
        teamSummaries: teamSummariesObj,
        lastEventTime: state.lastEventTime,
        eventCount: state.allEvents.length,
      }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (error) {
    console.error('[api/auction] Error fetching auction data:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch auction data',
        active: [],
        completed: [],
        teamSummaries: {},
      }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};
