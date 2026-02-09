/**
 * Live Auction Activity Detector
 *
 * Integrates polling, notifications, and UI highlights for complete live auction tracking.
 * Manages the full lifecycle of auction events from detection to user notification.
 */

import { createAuctionPoller, type LiveAuctionPoller, type CurrentPlayer, type RecentBid, type CompletedAuction, type AuctionState } from './live-auction-poller';
import { createNotificationManager, type AuctionNotificationManager, injectNotificationStyles } from './auction-notifications';
import { createHighlightManager, type PlayerHighlightManager, injectHighlightStyles } from './auction-ui-highlights';

export interface PlayerLookup {
  [playerId: string]: {
    name: string;
    position: string;
  };
}

export interface TeamLookup {
  [franchiseId: string]: {
    name: string;
    abbrev: string;
  };
}

export interface PredictedPrices {
  [playerId: string]: number;
}

export interface ActivityDetectorConfig {
  year?: number;
  leagueId?: string;
  pollInterval?: number;
  playerLookup: PlayerLookup;
  teamLookup: TeamLookup;
  predictedPrices?: PredictedPrices;
  onStateChange?: (state: AuctionState) => void;
}

/**
 * Live Auction Activity Detector
 * Orchestrates polling, notifications, and UI updates
 */
export class LiveAuctionActivityDetector {
  private poller: LiveAuctionPoller;
  private notificationManager: AuctionNotificationManager;
  private highlightManager: PlayerHighlightManager;

  private playerLookup: PlayerLookup;
  private teamLookup: TeamLookup;
  private predictedPrices: PredictedPrices;
  private onStateChange?: (state: AuctionState) => void;

  private isActive = false;

  constructor(config: ActivityDetectorConfig) {
    this.playerLookup = config.playerLookup;
    this.teamLookup = config.teamLookup;
    this.predictedPrices = config.predictedPrices || {};
    this.onStateChange = config.onStateChange;

    // Inject styles
    injectNotificationStyles();
    injectHighlightStyles();

    // Create managers
    this.notificationManager = createNotificationManager();
    this.highlightManager = createHighlightManager();

    // Create poller with event callbacks
    this.poller = createAuctionPoller({
      year: config.year,
      leagueId: config.leagueId,
      pollInterval: config.pollInterval || 15000,
      callbacks: {
        onPlayerNominated: (player) => this.handlePlayerNominated(player),
        onNewBid: (bid) => this.handleNewBid(bid),
        onAuctionWon: (auction) => this.handleAuctionWon(auction),
        onStateUpdate: (state) => this.handleStateUpdate(state),
        onError: (error) => this.handleError(error),
      },
    });
  }

  /**
   * Start live tracking
   */
  start(): void {
    if (this.isActive) {
      console.warn('Activity detector already active');
      return;
    }

    console.log('Starting live auction activity detection...');
    this.isActive = true;
    this.poller.start();
  }

  /**
   * Stop live tracking
   */
  stop(): void {
    if (!this.isActive) {
      return;
    }

    console.log('Stopping live auction activity detection');
    this.isActive = false;
    this.poller.stop();
    this.highlightManager.clearHighlightsByType('current');
    this.highlightManager.clearHighlightsByType('recent-bid');
  }

  /**
   * Check if detector is active
   */
  isRunning(): boolean {
    return this.isActive;
  }

  /**
   * Get notification manager (for preferences UI)
   */
  getNotificationManager(): AuctionNotificationManager {
    return this.notificationManager;
  }

  /**
   * Get highlight manager (for UI rendering)
   */
  getHighlightManager(): PlayerHighlightManager {
    return this.highlightManager;
  }

  /**
   * Get current auction state
   */
  getCurrentState(): AuctionState | null {
    return this.poller.getCurrentState();
  }

  /**
   * Add player to target tracking list
   */
  addTargetPlayer(playerId: string): void {
    this.highlightManager.addTargetPlayer(playerId);
  }

  /**
   * Remove player from target tracking list
   */
  removeTargetPlayer(playerId: string): void {
    this.highlightManager.removeTargetPlayer(playerId);
  }

  /**
   * Force immediate poll (useful for manual refresh)
   */
  async refresh(): Promise<void> {
    await this.poller.forcePoll();
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stop();
    this.highlightManager.destroy();
  }

  /**
   * Handle player nominated event
   */
  private handlePlayerNominated(player: CurrentPlayer): void {
    const playerInfo = this.playerLookup[player.playerId];
    const playerName = playerInfo ? `${playerInfo.name} (${playerInfo.position})` : `Player ${player.playerId}`;

    console.log(`Player nominated: ${playerName} at $${player.startingBid}`);

    // Clear previous current player highlight
    this.highlightManager.clearHighlightsByType('current');

    // Highlight current player
    this.highlightManager.highlightCurrentPlayer(
      player.playerId,
      player.currentBid,
      player.currentBidder
    );

    // Notify
    const isTarget = this.highlightManager.isTargetPlayer(player.playerId);
    if (isTarget) {
      // Always notify for target players
      this.notificationManager.notifyPlayerNominated(playerName, player.startingBid);
    }

    // Trigger UI update
    this.triggerUIUpdate();
  }

  /**
   * Handle new bid event
   */
  private handleNewBid(bid: RecentBid): void {
    const playerInfo = this.playerLookup[bid.playerId];
    const playerName = playerInfo ? `${playerInfo.name} (${playerInfo.position})` : `Player ${bid.playerId}`;

    const teamInfo = this.teamLookup[bid.franchise];
    const teamName = teamInfo ? teamInfo.name : `Team ${bid.franchise}`;

    console.log(`New bid: ${teamName} bid $${bid.amount} on ${playerName}`);

    // Highlight player (if not current player)
    this.highlightManager.highlightRecentBid(bid.playerId, bid.amount, bid.franchise);

    // Notify
    const isTarget = this.highlightManager.isTargetPlayer(bid.playerId);
    this.notificationManager.notifyNewBid(playerName, teamName, bid.amount, isTarget);

    // Trigger UI update
    this.triggerUIUpdate();
  }

  /**
   * Handle auction won event
   */
  private handleAuctionWon(auction: CompletedAuction): void {
    const playerInfo = this.playerLookup[auction.playerId];
    const playerName = playerInfo ? `${playerInfo.name} (${playerInfo.position})` : `Player ${auction.playerId}`;

    const teamInfo = this.teamLookup[auction.franchise];
    const teamName = teamInfo ? teamInfo.name : `Team ${auction.franchise}`;

    const predictedPrice = this.predictedPrices[auction.playerId] || null;

    console.log(`Auction won: ${teamName} signed ${playerName} for $${auction.winningBid}`);

    // Clear current player highlight if this was the current player
    const currentState = this.poller.getCurrentState();
    if (currentState?.currentPlayer?.playerId === auction.playerId) {
      this.highlightManager.clearHighlightsByType('current');
    }

    // Highlight as sold
    this.highlightManager.highlightSoldPlayer(
      auction.playerId,
      auction.winningBid,
      auction.franchise
    );

    // Notify
    this.notificationManager.notifyAuctionWon(
      playerName,
      teamName,
      auction.winningBid,
      predictedPrice
    );

    // Trigger UI update
    this.triggerUIUpdate();
  }

  /**
   * Handle state update
   */
  private handleStateUpdate(state: AuctionState): void {
    // Update current player highlight
    if (state.currentPlayer) {
      this.highlightManager.highlightCurrentPlayer(
        state.currentPlayer.playerId,
        state.currentPlayer.currentBid,
        state.currentPlayer.currentBidder
      );
    }

    // Trigger callback
    this.onStateChange?.(state);

    // Trigger UI update
    this.triggerUIUpdate();
  }

  /**
   * Handle polling error
   */
  private handleError(error: Error): void {
    console.error('Auction polling error:', error);
    this.notificationManager.notifyError('Failed to fetch auction updates');
  }

  /**
   * Trigger UI update (re-render player table)
   */
  private triggerUIUpdate(): void {
    // Dispatch custom event for UI to listen to
    window.dispatchEvent(new CustomEvent('auction-state-changed', {
      detail: {
        highlights: this.highlightManager.getAllHighlights(),
        state: this.poller.getCurrentState(),
      },
    }));
  }
}

/**
 * Create activity detector instance
 */
export function createActivityDetector(config: ActivityDetectorConfig): LiveAuctionActivityDetector {
  return new LiveAuctionActivityDetector(config);
}
