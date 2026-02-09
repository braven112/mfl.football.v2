/**
 * Live Auction Poller
 * 
 * Handles real-time polling of the MFL auctionResults endpoint.
 * Detects changes in auction state (new bids, completed auctions, new nominations)
 * and emits events for the UI to consume.
 */

export interface AuctionItem {
  player: string;       // Player ID
  franchise: string;    // Current high bidder
  winningBid: string;   // Bid amount
  timeStarted: string;  // Unix timestamp
  lastBidTime: string;  // Unix timestamp
  timeToLive?: string;  // Seconds remaining (if active)
  comments?: string;
}

export interface PollerConfig {
  leagueId: string;
  year: string;
  pollIntervalMs?: number;
  useMockData?: boolean;
}

export type AuctionEventType = 'NEW_BID' | 'AUCTION_WON' | 'PLAYER_NOMINATED' | 'POLL_COMPLETE' | 'ERROR';

export interface AuctionEvent {
  type: AuctionEventType;
  data: any;
  timestamp: number;
}

export class LiveAuctionPoller {
  private config: PollerConfig;
  private intervalId: number | NodeJS.Timeout | null = null;
  private lastKnownState: Map<string, AuctionItem> = new Map();
  private listeners: ((event: AuctionEvent) => void)[] = [];
  private isPolling: boolean = false;
  private consecutiveErrors: number = 0;

  constructor(config: PollerConfig) {
    this.config = {
      pollIntervalMs: 60000, // Default 60s
      useMockData: false,
      ...config
    };
  }

  /**
   * Start polling
   */
  public start() {
    if (this.isPolling) return;
    
    this.isPolling = true;
    this.consecutiveErrors = 0;
    
    console.log(`[AuctionPoller] Starting poll every ${this.config.pollIntervalMs}ms`);
    
    // Initial fetch immediately
    this.fetchData();
    
    // Set up interval
    this.intervalId = setInterval(() => {
      this.fetchData();
    }, this.config.pollIntervalMs);
  }

  /**
   * Stop polling
   */
  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isPolling = false;
    console.log('[AuctionPoller] Polling stopped');
  }

  /**
   * Subscribe to events
   */
  public subscribe(callback: (event: AuctionEvent) => void) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  /**
   * Emit event to listeners
   */
  private emit(type: AuctionEventType, data: any) {
    const event: AuctionEvent = {
      type,
      data,
      timestamp: Date.now()
    };
    
    this.listeners.forEach(cb => cb(event));
  }

  /**
   * Fetch data from API or Mock
   */
  private async fetchData() {
    try {
      let data: any;

      if (this.config.useMockData) {
        // Fetch local mock file
        const response = await fetch('/data/theleague/mocks/auction-response.json');
        data = await response.json();
      } else {
        // Real MFL API call
        // Note: In a browser context, we rely on the proxy or CORS-enabled endpoint
        // For CLI/Node context, we'd use node-fetch
        const url = `https://www49.myfantasyleague.com/${this.config.year}/export?TYPE=auctionResults&L=${this.config.leagueId}&JSON=1`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.json();
      }

      this.processData(data);
      this.consecutiveErrors = 0;
      this.emit('POLL_COMPLETE', { success: true });

    } catch (error) {
      this.consecutiveErrors++;
      console.error('[AuctionPoller] Fetch error:', error);
      this.emit('ERROR', { error: error instanceof Error ? error.message : 'Unknown error' });
      
      // Backoff strategy: Stop if too many errors
      if (this.consecutiveErrors >= 5) {
        console.warn('[AuctionPoller] Too many consecutive errors, stopping.');
        this.stop();
      }
    }
  }

  /**
   * Process raw API response and detect changes
   */
  private processData(data: any) {
    const rawAuctions = data?.auctionResults?.auctionUnit?.auction;
    
    if (!rawAuctions) return;
    
    // Normalize to array (MFL returns single object if only 1 item)
    const currentAuctions: AuctionItem[] = Array.isArray(rawAuctions) 
      ? rawAuctions 
      : [rawAuctions];

    const currentMap = new Map<string, AuctionItem>();
    
    const isFirstPoll = this.lastKnownState.size === 0;

    currentAuctions.forEach(item => {
      currentMap.set(item.player, item);
      
      // If this is the first poll (map empty), just sync state without events
      if (isFirstPoll) return;

      const previous = this.lastKnownState.get(item.player);
      
      if (!previous) {
        // New player detected
        this.emit('PLAYER_NOMINATED', item);
      } else {
        // Existing player - check for changes
        if (item.winningBid !== previous.winningBid) {
          this.emit('NEW_BID', {
            player: item.player,
            oldBid: previous.winningBid,
            newBid: item.winningBid,
            bidder: item.franchise
          });
        }
        
        // Check if auction closed (active -> inactive)
        // MFL active auctions have timeToLive. Completed ones don't.
        if (previous.timeToLive && !item.timeToLive) {
          this.emit('AUCTION_WON', item);
        }
      }
    });

    // Update state
    this.lastKnownState = currentMap;
  }
}
