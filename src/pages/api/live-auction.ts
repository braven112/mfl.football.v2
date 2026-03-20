import type { APIRoute } from 'astro';
import { getCurrentLeagueYear } from '../../utils/league-year';

export const prerender = false;

const DEFAULT_HOST = 'https://api.myfantasyleague.com';
const DEFAULT_LEAGUE_ID = '13522';

/**
 * Parses MFL auction transaction string format: "{playerId}|{amount}|"
 */
function parseAuctionTransaction(transaction: string): { playerId: string; amount: number } | null {
  const parts = transaction.split('|');
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  const amount = parseInt(parts[1], 10);
  if (isNaN(amount)) return null;
  return { playerId: parts[0], amount };
}

export const GET: APIRoute = async ({ url }) => {
  const year = url.searchParams.get('year') || getCurrentLeagueYear().toString();
  const leagueId = url.searchParams.get('L') || DEFAULT_LEAGUE_ID;

  try {
    // Fetch both auctionResults (completed) and transactions (live bids) in parallel
    const [resultsResponse, txnResponse] = await Promise.all([
      fetch(`${DEFAULT_HOST}/${year}/export?TYPE=auctionResults&L=${leagueId}&JSON=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' },
      }),
      fetch(`${DEFAULT_HOST}/${year}/export?TYPE=transactions&L=${leagueId}&JSON=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' },
      }),
    ]);

    const auctions: Record<string, { bid: number; franchise: string; status: 'won' | 'active'; lastBidTime: number | null; initTime: number | null }> = {};
    // Track AUCTION_INIT timestamps separately (first nomination time per player)
    const initTimes: Record<string, number> = {};

    // 1. Parse completed auction results (highest priority — these are final)
    if (resultsResponse.ok) {
      const data = await resultsResponse.json();
      const auctionUnit = data?.auctionResults?.auctionUnit;
      if (auctionUnit?.auction) {
        const auctionList = Array.isArray(auctionUnit.auction)
          ? auctionUnit.auction
          : [auctionUnit.auction];
        for (const a of auctionList) {
          if (a?.player && a?.winningBid) {
            auctions[a.player] = {
              bid: parseInt(a.winningBid, 10),
              franchise: a.franchise || '',
              status: 'won',
              lastBidTime: parseInt(a.lastBidTime, 10) || null,
              initTime: parseInt(a.timeStarted, 10) || null,
            };
          }
        }
      }
    }

    // 2. Parse transactions for live auction bids (AUCTION_BID, AUCTION_WON, AUCTION_INIT)
    if (txnResponse.ok) {
      const txnData = await txnResponse.json();
      let transactions = txnData?.transactions?.transaction;
      if (transactions && !Array.isArray(transactions)) transactions = [transactions];

      if (Array.isArray(transactions)) {
        // First pass: collect all AUCTION_INIT timestamps
        for (const txn of transactions) {
          if (txn?.type === 'AUCTION_INIT' && txn?.transaction) {
            const parsed = parseAuctionTransaction(txn.transaction);
            if (parsed) {
              const ts = parseInt(txn.timestamp, 10) || 0;
              // Keep the earliest init time per player
              if (!initTimes[parsed.playerId] || ts < initTimes[parsed.playerId]) {
                initTimes[parsed.playerId] = ts;
              }
            }
          }
        }

        // Second pass: process bids and wins
        for (const txn of transactions) {
          if (!txn?.type || !txn?.transaction) continue;
          const parsed = parseAuctionTransaction(txn.transaction);
          if (!parsed) continue;

          if (txn.type === 'AUCTION_WON') {
            // Won overrides any bid — this is the final price
            auctions[parsed.playerId] = {
              bid: parsed.amount,
              franchise: txn.franchise || '',
              status: 'won',
              lastBidTime: parseInt(txn.timestamp, 10) || null,
              initTime: initTimes[parsed.playerId] || null,
            };
          } else if (txn.type === 'AUCTION_BID' || txn.type === 'AUCTION_INIT') {
            // Only set if we don't already have a won result or a higher bid
            const existing = auctions[parsed.playerId];
            if (!existing || (existing.status !== 'won' && parsed.amount > existing.bid)) {
              auctions[parsed.playerId] = {
                bid: parsed.amount,
                franchise: txn.franchise || '',
                status: 'active',
                lastBidTime: parseInt(txn.timestamp, 10) || null,
                initTime: initTimes[parsed.playerId] || null,
              };
            }
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        auctions,
        timestamp: Date.now(),
        count: Object.keys(auctions).length,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching auction results:', error);
    return new Response(
      JSON.stringify({
        auctions: {},
        timestamp: Date.now(),
        count: 0,
        error: 'Failed to fetch auction results',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
