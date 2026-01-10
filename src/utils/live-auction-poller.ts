/**
 * Live Auction Polling Client
 *
 * Polls the /api/live-auction endpoint to track real-time auction activity
 * during the March 15-21, 2026 auction.
 *
 * Features:
 * - Automatic polling with configurable interval
 * - Circuit breaker pattern (stops after 3 consecutive failures)
 * - Exponential backoff on errors
 * - Callbacks for auction events (new bid, auction won, player nominated)
 */

export interface CurrentPlayer {
  playerId: string;
  startingBid: number;
  currentBid: number;
  currentBidder: string | null;
  timeStarted: number;
  lastBidTime: number;
}

export interface RecentBid {
  playerId: string;
  franchise: string;
  amount: number;
  timestamp: number;
}

export interface CompletedAuction {
  playerId: string;
  franchise: string;
  winningBid: number;
  timestamp: number;
}

export interface AuctionState {
  currentPlayer: CurrentPlayer | null;
  recentBids: RecentBid[];
  completedAuctions: CompletedAuction[];
  isActive: boolean;
  lastUpdate: number;
}

export interface AuctionEventCallbacks {
  onPlayerNominated?: (player: CurrentPlayer) => void;
  onNewBid?: (bid: RecentBid) => void;
  onAuctionWon?: (auction: CompletedAuction) => void;
  onStateUpdate?: (state: AuctionState) => void;
  onError?: (error: Error) => void;
}

interface PollerConfig {
  year?: number;
  leagueId?: string;
  pollInterval?: number; // milliseconds
  maxFailures?: number;
  callbacks?: AuctionEventCallbacks;
}

export class LiveAuctionPoller {
  private year: number;
  private leagueId: string;
  private pollInterval: number;
  private maxFailures: number;
  private callbacks: AuctionEventCallbacks;

  private isPolling = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private failureCount = 0;
  private lastState: AuctionState | null = null;
  private lastProcessedTimestamp = 0;

  constructor(config: PollerConfig = {}) {
    this.year = config.year || new Date().getFullYear();
    this.leagueId = config.leagueId || '13522';
    this.pollInterval = config.pollInterval || 15000; // 15 seconds default
    this.maxFailures = config.maxFailures || 3;
    this.callbacks = config.callbacks || {};
  }

  /**
   * Start polling for auction updates
   */
  start(): void {
    if (this.isPolling) {
      console.warn('Auction poller already running');
      return;
    }

    console.log('Starting live auction polling...');
    this.isPolling = true;
    this.failureCount = 0;
    this.poll();
  }

  /**
   * Stop polling
   */
  stop(): void {
    if (!this.isPolling) {
      return;
    }

    console.log('Stopping live auction polling');
    this.isPolling = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Get current auction state (from last poll)
   */
  getCurrentState(): AuctionState | null {
    return this.lastState;
  }

  /**
   * Force an immediate poll (resets failure count)
   */
  async forcePoll(): Promise<void> {
    this.failureCount = 0;
    await this.poll();
  }

  /**
   * Internal polling logic
   */
  private async poll(): Promise<void> {
    if (!this.isPolling) {
      return;
    }

    try {
      // Build API URL (use 'since' parameter for incremental updates)
      const params = new URLSearchParams({
        year: this.year.toString(),
        L: this.leagueId,
      });

      if (this.lastProcessedTimestamp > 0) {
        params.set('since', this.lastProcessedTimestamp.toString());
      }

      const url = `/api/live-auction?${params.toString()}`;

      // Fetch auction state
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const state: AuctionState = await response.json();

      // Reset failure count on success
      this.failureCount = 0;

      // Process state changes and trigger callbacks
      this.processStateUpdate(state);

      // Update last processed timestamp
      if (state.recentBids.length > 0) {
        const latestBidTimestamp = Math.max(...state.recentBids.map((b) => b.timestamp));
        this.lastProcessedTimestamp = Math.max(this.lastProcessedTimestamp, latestBidTimestamp);
      }

      if (state.completedAuctions.length > 0) {
        const latestCompletionTimestamp = Math.max(
          ...state.completedAuctions.map((a) => a.timestamp)
        );
        this.lastProcessedTimestamp = Math.max(
          this.lastProcessedTimestamp,
          latestCompletionTimestamp
        );
      }

      // Store state
      this.lastState = state;

      // Trigger state update callback
      this.callbacks.onStateUpdate?.(state);

      // Schedule next poll
      this.scheduleNextPoll(this.pollInterval);
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  /**
   * Process state changes and trigger event callbacks
   */
  private processStateUpdate(newState: AuctionState): void {
    if (!this.lastState) {
      // First poll - trigger all callbacks for initial state
      if (newState.currentPlayer) {
        this.callbacks.onPlayerNominated?.(newState.currentPlayer);
      }

      for (const bid of newState.recentBids.slice(0, 10)) {
        this.callbacks.onNewBid?.(bid);
      }

      for (const auction of newState.completedAuctions.slice(0, 10)) {
        this.callbacks.onAuctionWon?.(auction);
      }

      return;
    }

    // Detect new player on block
    if (
      newState.currentPlayer &&
      newState.currentPlayer.playerId !== this.lastState.currentPlayer?.playerId
    ) {
      this.callbacks.onPlayerNominated?.(newState.currentPlayer);
    }

    // Detect new bids (compare recent bids arrays)
    const lastBidIds = new Set(
      this.lastState.recentBids.map((b) => `${b.playerId}-${b.timestamp}`)
    );
    const newBids = newState.recentBids.filter(
      (b) => !lastBidIds.has(`${b.playerId}-${b.timestamp}`)
    );

    for (const bid of newBids) {
      this.callbacks.onNewBid?.(bid);
    }

    // Detect completed auctions
    const lastCompletedIds = new Set(
      this.lastState.completedAuctions.map((a) => `${a.playerId}-${a.timestamp}`)
    );
    const newCompletions = newState.completedAuctions.filter(
      (a) => !lastCompletedIds.has(`${a.playerId}-${a.timestamp}`)
    );

    for (const auction of newCompletions) {
      this.callbacks.onAuctionWon?.(auction);
    }
  }

  /**
   * Handle polling errors with circuit breaker pattern
   */
  private handleError(error: Error): void {
    console.error('Auction polling error:', error);
    this.failureCount++;

    // Trigger error callback
    this.callbacks.onError?.(error);

    // Circuit breaker: stop polling after max failures
    if (this.failureCount >= this.maxFailures) {
      console.error(
        `Circuit breaker triggered: ${this.failureCount} consecutive failures. Stopping polling.`
      );
      this.stop();
      return;
    }

    // Exponential backoff: 15s, 30s, 60s
    const backoffDelay = Math.min(
      this.pollInterval * Math.pow(2, this.failureCount - 1),
      60000
    );

    console.log(`Retrying in ${backoffDelay / 1000}s (attempt ${this.failureCount}/${this.maxFailures})`);
    this.scheduleNextPoll(backoffDelay);
  }

  /**
   * Schedule next poll
   */
  private scheduleNextPoll(delay: number): void {
    if (!this.isPolling) {
      return;
    }

    this.pollTimer = setTimeout(() => {
      this.poll();
    }, delay);
  }
}

/**
 * Create a live auction poller instance
 */
export function createAuctionPoller(config?: PollerConfig): LiveAuctionPoller {
  return new LiveAuctionPoller(config);
}
