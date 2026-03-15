/**
 * Auction Tracker Utilities
 *
 * Pure functions for deriving auction state from MFL transaction data.
 * MFL has no "active auctions" endpoint — state must be computed from
 * AUCTION_INIT, AUCTION_BID, and AUCTION_WON transaction events.
 *
 * All monetary values from MFL are strings in whole dollars (e.g., "475000" = $475,000).
 * Timestamps are Unix epoch seconds as strings.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw MFL transaction record (subset for auction events) */
export interface MflAuctionTransaction {
  type: 'AUCTION_INIT' | 'AUCTION_BID' | 'AUCTION_WON';
  franchise: string;
  transaction: string;
  timestamp: string;
}

/** Parsed auction event */
export interface AuctionEvent {
  type: 'AUCTION_INIT' | 'AUCTION_BID' | 'AUCTION_WON';
  franchise: string;
  playerId: string;
  amount: number;
  timestamp: number;
}

/** Derived state for a single active auction */
export interface ActiveAuction {
  playerId: string;
  /** Franchise that nominated this player */
  nominatedBy: string;
  /** Starting bid amount (from AUCTION_INIT) */
  startingBid: number;
  /** Current highest bid amount */
  currentBid: number;
  /** Franchise holding the current highest bid */
  highBidder: string;
  /** Timestamp when player was nominated */
  timeStarted: number;
  /** Timestamp of the most recent bid */
  lastBidTime: number;
  /** Total number of bids placed on this player */
  bidCount: number;
  /** All bids in chronological order */
  bidHistory: AuctionEvent[];
}

/** Completed auction result */
export interface CompletedAuction {
  playerId: string;
  /** Winning franchise */
  winner: string;
  /** Final winning bid amount */
  winningBid: number;
  /** Timestamp when auction started */
  timeStarted: number;
  /** Timestamp of the winning bid */
  lastBidTime: number;
  /** Franchise that nominated the player */
  nominatedBy: string;
  /** Total number of bids */
  bidCount: number;
}

/** Per-team auction summary */
export interface TeamAuctionSummary {
  franchiseId: string;
  /** Total spent on won auctions */
  totalSpent: number;
  /** Number of players won */
  playersWon: number;
  /** Number of active auctions where this team is high bidder */
  activeBidsAsHighBidder: number;
  /** Number of active auctions where this team has bid but is not high bidder */
  activeBidsOutbid: number;
  /** Number of players this team nominated */
  nominations: number;
  /** IDs of players won */
  wonPlayerIds: string[];
}

/** Full derived auction state */
export interface AuctionState {
  active: ActiveAuction[];
  completed: CompletedAuction[];
  teamSummaries: Map<string, TeamAuctionSummary>;
  /** All auction events in chronological order */
  allEvents: AuctionEvent[];
  /** Timestamp of the most recent event */
  lastEventTime: number;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse the MFL transaction string format: "{playerId}|{bidAmount}|"
 */
export function parseAuctionTransaction(transaction: string): { playerId: string; amount: number } {
  const parts = transaction.split('|');
  return {
    playerId: parts[0] || '',
    amount: parseInt(parts[1] || '0', 10),
  };
}

/**
 * Convert raw MFL transaction to parsed AuctionEvent
 */
export function toAuctionEvent(raw: MflAuctionTransaction): AuctionEvent {
  const { playerId, amount } = parseAuctionTransaction(raw.transaction);
  return {
    type: raw.type,
    franchise: raw.franchise,
    playerId,
    amount,
    timestamp: parseInt(raw.timestamp, 10),
  };
}

// ---------------------------------------------------------------------------
// State Derivation
// ---------------------------------------------------------------------------

/**
 * Derive full auction state from raw MFL transaction events.
 *
 * Algorithm:
 * 1. Parse all AUCTION_* events
 * 2. Collect AUCTION_WON player IDs → completed set
 * 3. AUCTION_INIT not in completed set → active auctions
 * 4. Latest AUCTION_BID per active player → current high bid
 */
export function deriveAuctionState(rawTransactions: MflAuctionTransaction[]): AuctionState {
  // Parse and sort chronologically
  const events = rawTransactions.map(toAuctionEvent).sort((a, b) => a.timestamp - b.timestamp);

  // Group events by player
  const initByPlayer = new Map<string, AuctionEvent>();
  const bidsByPlayer = new Map<string, AuctionEvent[]>();
  const wonByPlayer = new Map<string, AuctionEvent>();

  for (const event of events) {
    switch (event.type) {
      case 'AUCTION_INIT':
        initByPlayer.set(event.playerId, event);
        break;
      case 'AUCTION_BID':
        if (!bidsByPlayer.has(event.playerId)) {
          bidsByPlayer.set(event.playerId, []);
        }
        bidsByPlayer.get(event.playerId)!.push(event);
        break;
      case 'AUCTION_WON':
        wonByPlayer.set(event.playerId, event);
        break;
    }
  }

  // Build active auctions
  const active: ActiveAuction[] = [];
  for (const [playerId, initEvent] of initByPlayer) {
    if (wonByPlayer.has(playerId)) continue; // completed

    const bids = bidsByPlayer.get(playerId) || [];
    const latestBid = bids.length > 0 ? bids[bids.length - 1] : null;

    active.push({
      playerId,
      nominatedBy: initEvent.franchise,
      startingBid: initEvent.amount,
      currentBid: latestBid?.amount ?? initEvent.amount,
      highBidder: latestBid?.franchise ?? initEvent.franchise,
      timeStarted: initEvent.timestamp,
      lastBidTime: latestBid?.timestamp ?? initEvent.timestamp,
      bidCount: bids.length,
      bidHistory: [initEvent, ...bids],
    });
  }

  // Sort active: most recent activity first
  active.sort((a, b) => b.lastBidTime - a.lastBidTime);

  // Build completed auctions
  const completed: CompletedAuction[] = [];
  for (const [playerId, wonEvent] of wonByPlayer) {
    const initEvent = initByPlayer.get(playerId);
    const bids = bidsByPlayer.get(playerId) || [];
    completed.push({
      playerId,
      winner: wonEvent.franchise,
      winningBid: wonEvent.amount,
      timeStarted: initEvent?.timestamp ?? wonEvent.timestamp,
      lastBidTime: wonEvent.timestamp,
      nominatedBy: initEvent?.franchise ?? wonEvent.franchise,
      bidCount: bids.length,
    });
  }

  // Sort completed: most recently won first
  completed.sort((a, b) => b.lastBidTime - a.lastBidTime);

  // Build team summaries
  const teamSummaries = buildTeamSummaries(active, completed, events);

  const lastEventTime = events.length > 0 ? events[events.length - 1].timestamp : 0;

  return { active, completed, teamSummaries, allEvents: events, lastEventTime };
}

// ---------------------------------------------------------------------------
// Team Summaries
// ---------------------------------------------------------------------------

function buildTeamSummaries(
  active: ActiveAuction[],
  completed: CompletedAuction[],
  events: AuctionEvent[]
): Map<string, TeamAuctionSummary> {
  const summaries = new Map<string, TeamAuctionSummary>();

  const getOrCreate = (franchiseId: string): TeamAuctionSummary => {
    if (!summaries.has(franchiseId)) {
      summaries.set(franchiseId, {
        franchiseId,
        totalSpent: 0,
        playersWon: 0,
        activeBidsAsHighBidder: 0,
        activeBidsOutbid: 0,
        nominations: 0,
        wonPlayerIds: [],
      });
    }
    return summaries.get(franchiseId)!;
  };

  // Count nominations
  for (const event of events) {
    if (event.type === 'AUCTION_INIT') {
      getOrCreate(event.franchise).nominations++;
    }
  }

  // Completed auction spending
  for (const auction of completed) {
    const summary = getOrCreate(auction.winner);
    summary.totalSpent += auction.winningBid;
    summary.playersWon++;
    summary.wonPlayerIds.push(auction.playerId);
  }

  // Active auction bid status
  for (const auction of active) {
    getOrCreate(auction.highBidder).activeBidsAsHighBidder++;

    // Find all teams that bid on this player but aren't the high bidder
    const bidders = new Set<string>();
    for (const bid of auction.bidHistory) {
      if (bid.type === 'AUCTION_BID' || bid.type === 'AUCTION_INIT') {
        bidders.add(bid.franchise);
      }
    }
    for (const franchiseId of bidders) {
      if (franchiseId !== auction.highBidder) {
        getOrCreate(franchiseId).activeBidsOutbid++;
      }
    }
  }

  return summaries;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format bid amount in compact salary format.
 * - >= $1M: "$X.XXM" (e.g., "$6.00M")
 * - < $1M: "$XXXk" (e.g., "$475k")
 */
export function formatBidAmount(amount: number): string {
  if (amount >= 1_000_000) {
    const millions = amount / 1_000_000;
    return `$${millions.toFixed(2)}M`;
  }
  if (amount >= 1_000) {
    const thousands = amount / 1_000;
    // Show decimal only if not a round number
    return thousands === Math.floor(thousands)
      ? `$${thousands}k`
      : `$${thousands.toFixed(0)}k`;
  }
  return `$${amount.toLocaleString()}`;
}

/**
 * Format a Unix timestamp as relative time ("2h ago", "3d ago").
 */
export function formatRelativeTime(unixSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixSeconds;

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a Unix timestamp as full date string for tooltips.
 */
export function formatFullDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// ---------------------------------------------------------------------------
// Timer Estimation
// ---------------------------------------------------------------------------

/**
 * Estimate when an auction expires, accounting for the timer suspension window.
 *
 * @param lastBidTimestamp - Unix seconds of the last bid
 * @param draftLimitHours - Timer hours (e.g., 12)
 * @param suspendStart - Hour when timer pauses (e.g., 3 for 3am)
 * @param suspendEnd - Hour when timer resumes (e.g., 7 for 7am)
 * @returns Estimated expiration as Unix seconds
 */
export function estimateExpiration(
  lastBidTimestamp: number,
  draftLimitHours: number = 12,
  suspendStart: number = 3,
  suspendEnd: number = 7
): number {
  const suspendDuration = (suspendEnd - suspendStart) * 3600; // seconds of daily suspension
  const limitSeconds = draftLimitHours * 3600;

  let remaining = limitSeconds;
  let cursor = lastBidTimestamp;
  let iterations = 0;

  // Walk forward in time, subtracting active hours until remaining is 0
  while (remaining > 0 && iterations < 100) {
    iterations++;
    const cursorDate = new Date(cursor * 1000);
    const hour = cursorDate.getHours();

    if (hour >= suspendStart && hour < suspendEnd) {
      // Currently in suspension window — skip to end of suspension
      const endOfSuspension = new Date(cursorDate);
      endOfSuspension.setHours(suspendEnd, 0, 0, 0);
      cursor = Math.floor(endOfSuspension.getTime() / 1000);
    } else {
      // Calculate seconds until next suspension window
      const nextSuspend = new Date(cursorDate);
      if (hour >= suspendEnd) {
        // Next suspension is tomorrow at suspendStart
        nextSuspend.setDate(nextSuspend.getDate() + 1);
      }
      nextSuspend.setHours(suspendStart, 0, 0, 0);
      const secondsUntilSuspend = Math.floor(nextSuspend.getTime() / 1000) - cursor;

      if (remaining <= secondsUntilSuspend) {
        // Timer expires before next suspension
        cursor += remaining;
        remaining = 0;
      } else {
        // Timer runs until suspension, then pause
        remaining -= secondsUntilSuspend;
        cursor += secondsUntilSuspend + suspendDuration;
      }
    }
  }

  return cursor;
}

/**
 * Format time remaining until expiration.
 */
export function formatTimeRemaining(expirationTimestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = expirationTimestamp - now;

  if (diff <= 0) return 'Expired';
  if (diff < 3600) return `${Math.floor(diff / 60)}m left`;
  if (diff < 86400) {
    const hours = Math.floor(diff / 3600);
    const mins = Math.floor((diff % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m left` : `${hours}h left`;
  }
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  return hours > 0 ? `${days}d ${hours}h left` : `${days}d left`;
}

// ---------------------------------------------------------------------------
// Available Players
// ---------------------------------------------------------------------------

/** Minimal player info for the available players board */
export interface AvailablePlayer {
  id: string;
  name: string;
  position: string;
  nflTeam: string;
  /** Rank from custom rankings (null if not ranked) */
  customRank: number | null;
  /** Average rank from imported rankings (null if not ranked) */
  averageRank: number | null;
  /** True if this player ranks higher than ANY active auction player on user's board */
  higherOnBoard: boolean;
}

/**
 * Determine which players are available (free agents not currently up for auction).
 *
 * @param allPlayers - All players from MFL feed { id, name, position, team }
 * @param rosteredPlayerIds - Set of player IDs currently on rosters
 * @param activeAuctionPlayerIds - Set of player IDs currently in active auctions
 * @param completedAuctionPlayerIds - Set of player IDs already won in auctions
 * @returns Player IDs that are available for nomination
 */
export function getAvailablePlayerIds(
  allPlayerIds: Set<string>,
  rosteredPlayerIds: Set<string>,
  activeAuctionPlayerIds: Set<string>,
  completedAuctionPlayerIds: Set<string>
): Set<string> {
  const available = new Set<string>();
  for (const id of allPlayerIds) {
    if (!rosteredPlayerIds.has(id) && !activeAuctionPlayerIds.has(id) && !completedAuctionPlayerIds.has(id)) {
      available.add(id);
    }
  }
  return available;
}

// ---------------------------------------------------------------------------
// Outbid Detection
// ---------------------------------------------------------------------------

/** Notification when user has been outbid */
export interface OutbidAlert {
  playerId: string;
  playerName: string;
  newHighBidder: string;
  newBidAmount: number;
  previousBidAmount: number;
}

/**
 * Detect if the user has been outbid by comparing previous and current auction state.
 *
 * @param previousState - Active auctions from previous poll
 * @param currentState - Active auctions from current poll
 * @param userFranchiseId - The authenticated user's franchise ID
 * @returns Array of outbid alerts (empty if no changes)
 */
export function detectOutbids(
  previousState: ActiveAuction[],
  currentState: ActiveAuction[],
  userFranchiseId: string
): OutbidAlert[] {
  const alerts: OutbidAlert[] = [];

  // Find auctions where user WAS high bidder but now ISN'T
  const prevByPlayer = new Map(previousState.map(a => [a.playerId, a]));

  for (const current of currentState) {
    const prev = prevByPlayer.get(current.playerId);
    if (!prev) continue;

    // User was high bidder before, but isn't now
    if (prev.highBidder === userFranchiseId && current.highBidder !== userFranchiseId) {
      alerts.push({
        playerId: current.playerId,
        playerName: '', // Filled in by caller with player lookup
        newHighBidder: current.highBidder,
        newBidAmount: current.currentBid,
        previousBidAmount: prev.currentBid,
      });
    }
  }

  return alerts;
}
