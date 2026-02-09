import type { APIRoute } from 'astro';
import { getCurrentLeagueYear } from '../../utils/league-year';

export const prerender = false;

const DEFAULT_HOST = 'https://api.myfantasyleague.com';
const DEFAULT_LEAGUE_ID = '13522';

interface AuctionTransaction {
  type: 'AUCTION_INIT' | 'AUCTION_BID' | 'AUCTION_WON';
  franchise: string;
  transaction: string;
  timestamp: string;
}

interface ParsedAuctionData {
  playerId: string;
  amount: number;
}

interface CurrentPlayer {
  playerId: string;
  startingBid: number;
  currentBid: number;
  currentBidder: string | null;
  timeStarted: number;
  lastBidTime: number;
}

interface CompletedAuction {
  playerId: string;
  franchise: string;
  winningBid: number;
  timestamp: number;
}

interface RecentBid {
  playerId: string;
  franchise: string;
  amount: number;
  timestamp: number;
}

interface AuctionState {
  currentPlayer: CurrentPlayer | null;
  recentBids: RecentBid[];
  completedAuctions: CompletedAuction[];
  isActive: boolean;
  lastUpdate: number;
}

/**
 * Parse MFL auction transaction string format: "playerId|amount|"
 */
function parseAuctionTransaction(transaction: string): ParsedAuctionData | null {
  const parts = transaction.split('|');

  if (parts.length < 2) {
    return null;
  }

  const playerId = parts[0]?.trim();
  const amountStr = parts[1]?.trim();

  if (!playerId || !amountStr) {
    return null;
  }

  const amount = parseInt(amountStr, 10);

  if (isNaN(amount)) {
    return null;
  }

  return {
    playerId,
    amount,
  };
}

/**
 * Build auction state from transactions
 */
function buildAuctionState(transactions: AuctionTransaction[]): AuctionState {
  const state: AuctionState = {
    currentPlayer: null,
    recentBids: [],
    completedAuctions: [],
    isActive: false,
    lastUpdate: Date.now(),
  };

  // Sort transactions by timestamp (oldest first) to replay in order
  const sortedTransactions = [...transactions].sort(
    (a, b) => parseInt(a.timestamp) - parseInt(b.timestamp)
  );

  for (const transaction of sortedTransactions) {
    const parsed = parseAuctionTransaction(transaction.transaction);
    if (!parsed) {
      console.warn('Failed to parse auction transaction:', transaction.transaction);
      continue;
    }

    const timestamp = parseInt(transaction.timestamp);

    switch (transaction.type) {
      case 'AUCTION_INIT':
        // New player on block
        state.currentPlayer = {
          playerId: parsed.playerId,
          startingBid: parsed.amount,
          currentBid: parsed.amount,
          currentBidder: null,
          timeStarted: timestamp,
          lastBidTime: timestamp,
        };
        state.isActive = true;
        break;

      case 'AUCTION_BID':
        // New bid placed
        if (state.currentPlayer?.playerId === parsed.playerId) {
          state.currentPlayer.currentBid = parsed.amount;
          state.currentPlayer.currentBidder = transaction.franchise;
          state.currentPlayer.lastBidTime = timestamp;
        }

        // Add to recent bids (most recent first)
        state.recentBids.unshift({
          playerId: parsed.playerId,
          franchise: transaction.franchise,
          amount: parsed.amount,
          timestamp,
        });
        break;

      case 'AUCTION_WON':
        // Auction completed
        state.completedAuctions.unshift({
          playerId: parsed.playerId,
          franchise: transaction.franchise,
          winningBid: parsed.amount,
          timestamp,
        });

        // Clear current player if it was this one
        if (state.currentPlayer?.playerId === parsed.playerId) {
          state.currentPlayer = null;
        }
        break;
    }
  }

  // Limit arrays to most recent items to prevent unbounded growth
  state.recentBids = state.recentBids.slice(0, 50); // Keep last 50 bids
  state.completedAuctions = state.completedAuctions.slice(0, 100); // Keep last 100 completions

  // Determine if auction is still active
  // Active if there's a current player and last activity was within 10 minutes
  if (state.currentPlayer) {
    const timeSinceLastBid = Date.now() / 1000 - state.currentPlayer.lastBidTime;
    state.isActive = timeSinceLastBid < 600; // 10 minutes
  } else {
    state.isActive = false;
  }

  return state;
}

export const GET: APIRoute = async ({ url }) => {
  const year = url.searchParams.get('year') || getCurrentLeagueYear().toString();
  const leagueId = url.searchParams.get('L') || DEFAULT_LEAGUE_ID;
  const host = url.searchParams.get('host') || DEFAULT_HOST;
  const since = url.searchParams.get('since'); // Optional: only return transactions after this timestamp

  try {
    // Fetch transactions from MFL API
    const transactionsUrl = `${host}/${year}/export?TYPE=transactions&L=${leagueId}&JSON=1`;
    const response = await fetch(transactionsUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' },
    });

    if (!response.ok) {
      throw new Error(`MFL API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Extract transactions array
    let allTransactions: any[] = [];
    if (data?.transactions?.transaction) {
      allTransactions = Array.isArray(data.transactions.transaction)
        ? data.transactions.transaction
        : [data.transactions.transaction];
    }

    // Filter for auction-related transactions
    const auctionTransactions = allTransactions.filter(
      (t) =>
        t.type === 'AUCTION_INIT' || t.type === 'AUCTION_BID' || t.type === 'AUCTION_WON'
    ) as AuctionTransaction[];

    // Filter by timestamp if 'since' parameter provided
    let filteredTransactions = auctionTransactions;
    if (since) {
      const sinceTimestamp = parseInt(since, 10);
      if (!isNaN(sinceTimestamp)) {
        filteredTransactions = auctionTransactions.filter(
          (t) => parseInt(t.timestamp) > sinceTimestamp
        );
      }
    }

    // Build auction state
    const auctionState = buildAuctionState(filteredTransactions);

    // Return auction state
    return new Response(JSON.stringify(auctionState), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Cache for 10 seconds during active auction, 60 seconds when inactive
        'Cache-Control': auctionState.isActive
          ? 'public, max-age=10, must-revalidate'
          : 'public, max-age=60, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Error fetching live auction data:', error);

    // Return graceful error response with empty state
    const errorState: AuctionState = {
      currentPlayer: null,
      recentBids: [],
      completedAuctions: [],
      isActive: false,
      lastUpdate: Date.now(),
    };

    return new Response(
      JSON.stringify({
        ...errorState,
        error: 'Failed to fetch auction data',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      }
    );
  }
};
