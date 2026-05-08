/**
 * Live MFL auction snapshot.
 *
 * Joins MFL's `auctionResults` (final wins) with `transactions`
 * (`AUCTION_INIT` / `AUCTION_BID` / `AUCTION_WON`) into a single map of
 * `playerId → { bid, franchise, status, lastBidTime, initTime }`.
 *
 * Used by both the `/api/live-auction` route (for client polling) and the
 * homepage SSR loader so we don't pay for a self-fetch round-trip.
 */
import { getCurrentLeagueYear } from './league-year';

const DEFAULT_HOST = 'https://api.myfantasyleague.com';
const DEFAULT_LEAGUE_ID = '13522';

export interface LiveAuctionEntry {
  bid: number;
  franchise: string;
  status: 'won' | 'active';
  lastBidTime: number | null;
  initTime: number | null;
}

export interface LiveAuctionSnapshot {
  auctions: Record<string, LiveAuctionEntry>;
  timestamp: number;
  count: number;
}

export interface FetchAuctionOpts {
  year?: string | number;
  leagueId?: string;
  host?: string;
  fetchImpl?: typeof fetch;
}

function parseAuctionTransaction(transaction: string): { playerId: string; amount: number } | null {
  const parts = transaction.split('|');
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  const amount = parseInt(parts[1], 10);
  if (isNaN(amount)) return null;
  return { playerId: parts[0], amount };
}

export async function fetchLiveAuctions(opts: FetchAuctionOpts = {}): Promise<LiveAuctionSnapshot> {
  const year = String(opts.year ?? getCurrentLeagueYear());
  const leagueId = opts.leagueId ?? DEFAULT_LEAGUE_ID;
  const host = opts.host ?? DEFAULT_HOST;
  const fetchImpl = opts.fetchImpl ?? fetch;

  const auctions: Record<string, LiveAuctionEntry> = {};
  const initTimes: Record<string, number> = {};

  try {
    const [resultsResponse, txnResponse] = await Promise.all([
      fetchImpl(`${host}/${year}/export?TYPE=auctionResults&L=${leagueId}&JSON=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' },
      }),
      fetchImpl(`${host}/${year}/export?TYPE=transactions&L=${leagueId}&JSON=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' },
      }),
    ]);

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

    if (txnResponse.ok) {
      const txnData = await txnResponse.json();
      let transactions = txnData?.transactions?.transaction;
      if (transactions && !Array.isArray(transactions)) transactions = [transactions];

      if (Array.isArray(transactions)) {
        for (const txn of transactions) {
          if (txn?.type === 'AUCTION_INIT' && txn?.transaction) {
            const parsed = parseAuctionTransaction(txn.transaction);
            if (parsed) {
              const ts = parseInt(txn.timestamp, 10) || 0;
              if (!initTimes[parsed.playerId] || ts < initTimes[parsed.playerId]) {
                initTimes[parsed.playerId] = ts;
              }
            }
          }
        }

        for (const txn of transactions) {
          if (!txn?.type || !txn?.transaction) continue;
          const parsed = parseAuctionTransaction(txn.transaction);
          if (!parsed) continue;

          if (txn.type === 'AUCTION_WON') {
            auctions[parsed.playerId] = {
              bid: parsed.amount,
              franchise: txn.franchise || '',
              status: 'won',
              lastBidTime: parseInt(txn.timestamp, 10) || null,
              initTime: initTimes[parsed.playerId] || null,
            };
          } else if (txn.type === 'AUCTION_BID' || txn.type === 'AUCTION_INIT') {
            const existing = auctions[parsed.playerId];
            if (!existing || (existing.status !== 'won' && parsed.amount > existing.bid)) {
              const newFranchise = txn.franchise || '';
              const franchiseChanged = !existing || existing.franchise !== newFranchise;
              auctions[parsed.playerId] = {
                bid: parsed.amount,
                franchise: newFranchise,
                status: 'active',
                lastBidTime: franchiseChanged
                  ? (parseInt(txn.timestamp, 10) || null)
                  : (existing?.lastBidTime ?? null),
                initTime: initTimes[parsed.playerId] || null,
              };
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('[live-auctions] Failed to fetch from MFL:', error);
    return { auctions: {}, timestamp: Date.now(), count: 0 };
  }

  return {
    auctions,
    timestamp: Date.now(),
    count: Object.keys(auctions).length,
  };
}
