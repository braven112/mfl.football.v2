/**
 * Live Mode Manager
 *
 * Manages the transition between Planning Mode and Live Mode,
 * handles UI visibility, and coordinates updates to the Live Auction Panel.
 */

import type { AuctionState, CurrentPlayer, RecentBid, CompletedAuction } from './live-auction-poller';
import type { PlayerLookup, TeamLookup } from './live-auction-activity-detector';

export type AuctionMode = 'planning' | 'live';

export interface LiveModeManagerConfig {
  playerLookup: PlayerLookup;
  teamLookup: TeamLookup;
  predictedPrices?: { [playerId: string]: number };
}

export class LiveModeManager {
  private currentMode: AuctionMode = 'planning';
  private playerLookup: PlayerLookup;
  private teamLookup: TeamLookup;
  private predictedPrices: { [playerId: string]: number };

  // DOM elements
  private planningContainer: HTMLElement | null = null;
  private livePanel: HTMLElement | null = null;

  constructor(config: LiveModeManagerConfig) {
    this.playerLookup = config.playerLookup;
    this.teamLookup = config.teamLookup;
    this.predictedPrices = config.predictedPrices || {};

    // Load mode from localStorage
    const savedMode = localStorage.getItem('auctionMode');
    this.currentMode = (savedMode === 'live' ? 'live' : 'planning') as AuctionMode;

    // Listen for mode change events
    window.addEventListener('auction-mode-changed', (e: Event) => {
      const customEvent = e as CustomEvent;
      this.setMode(customEvent.detail.mode);
    });
  }

  /**
   * Initialize DOM references
   */
  initialize(planningContainerId: string, livePanelId: string): void {
    this.planningContainer = document.getElementById(planningContainerId);
    this.livePanel = document.getElementById(livePanelId);

    // Apply initial mode
    this.updateUI();
  }

  /**
   * Get current mode
   */
  getMode(): AuctionMode {
    return this.currentMode;
  }

  /**
   * Set mode
   */
  setMode(mode: AuctionMode): void {
    if (this.currentMode === mode) {
      return;
    }

    this.currentMode = mode;
    localStorage.setItem('auctionMode', mode);
    this.updateUI();
  }

  /**
   * Update UI visibility based on mode
   */
  private updateUI(): void {
    if (!this.planningContainer || !this.livePanel) {
      return;
    }

    if (this.currentMode === 'live') {
      // Show live panel, hide planning
      this.planningContainer.style.display = 'none';
      this.livePanel.style.display = 'block';
    } else {
      // Show planning, hide live panel
      this.planningContainer.style.display = 'block';
      this.livePanel.style.display = 'none';
    }
  }

  /**
   * Update live panel with auction state
   */
  updateLivePanel(state: AuctionState): void {
    if (this.currentMode !== 'live') {
      return;
    }

    this.updateLastUpdate();
    this.updateCurrentPlayer(state.currentPlayer);
    this.updateActivityFeed(state.recentBids, state.completedAuctions);
    this.updatePriceComparison(state.completedAuctions);
  }

  /**
   * Update last update timestamp
   */
  private updateLastUpdate(): void {
    const lastUpdateTime = document.getElementById('lastUpdateTime');
    if (!lastUpdateTime) return;

    const now = new Date();
    lastUpdateTime.textContent = now.toLocaleTimeString();
  }

  /**
   * Update current player on block
   */
  private updateCurrentPlayer(player: CurrentPlayer | null): void {
    const currentPlayerCard = document.getElementById('currentPlayerCard');
    if (!currentPlayerCard) return;

    if (!player) {
      // No active auction
      currentPlayerCard.className = 'current-player-card';
      currentPlayerCard.innerHTML = `
        <div class="no-player-message">
          <span class="placeholder-icon">⏸️</span>
          <p>No active auction</p>
          <p class="placeholder-subtext">Waiting for next player to be nominated...</p>
        </div>
      `;
      return;
    }

    // Active auction
    const playerInfo = this.playerLookup[player.playerId];
    const playerName = playerInfo ? playerInfo.name : `Player ${player.playerId}`;
    const position = playerInfo ? playerInfo.position : 'UNK';

    const bidderInfo = player.currentBidder ? this.teamLookup[player.currentBidder] : null;
    const bidderName = bidderInfo ? bidderInfo.name : player.currentBidder ? `Team ${player.currentBidder}` : 'No bids';

    const formattedBid = this.formatCurrency(player.currentBid);
    const startingBid = this.formatCurrency(player.startingBid);

    currentPlayerCard.className = 'current-player-card active';
    currentPlayerCard.innerHTML = `
      <div class="current-player-info">
        <div class="player-details">
          <h4>${playerName}</h4>
          <div class="player-meta">
            <span><strong>Position:</strong> ${position}</span>
            <span><strong>Starting bid:</strong> ${startingBid}</span>
          </div>
          ${player.currentBidder ? `<div class="current-bidder">Current bidder: ${bidderName}</div>` : ''}
        </div>
        <div class="bid-info">
          <div class="bid-amount">${formattedBid}</div>
          <div class="bid-label">Current Bid</div>
        </div>
      </div>
    `;
  }

  /**
   * Update activity feed
   */
  private updateActivityFeed(recentBids: RecentBid[], completedAuctions: CompletedAuction[]): void {
    const activityFeed = document.getElementById('activityFeed');
    if (!activityFeed) return;

    // Combine and sort by timestamp (most recent first)
    const activities: Array<{ type: 'bid' | 'won'; timestamp: number; data: RecentBid | CompletedAuction }> = [
      ...recentBids.slice(0, 20).map(bid => ({ type: 'bid' as const, timestamp: bid.timestamp, data: bid })),
      ...completedAuctions.slice(0, 10).map(auction => ({ type: 'won' as const, timestamp: auction.timestamp, data: auction })),
    ];

    activities.sort((a, b) => b.timestamp - a.timestamp);

    if (activities.length === 0) {
      activityFeed.innerHTML = `
        <div class="no-activity-message">
          <span class="placeholder-icon">📭</span>
          <p>No recent activity</p>
        </div>
      `;
      return;
    }

    const activityHTML = activities.slice(0, 30).map(activity => {
      const timeAgo = this.formatTimeAgo(activity.timestamp);

      if (activity.type === 'bid') {
        const bid = activity.data as RecentBid;
        const playerInfo = this.playerLookup[bid.playerId];
        const playerName = playerInfo ? playerInfo.name : `Player ${bid.playerId}`;
        const teamInfo = this.teamLookup[bid.franchise];
        const teamName = teamInfo ? teamInfo.name : `Team ${bid.franchise}`;
        const amount = this.formatCurrency(bid.amount);

        return `
          <div class="activity-item">
            <div class="activity-header">
              <span class="activity-type">💰 New Bid</span>
              <span class="activity-time">${timeAgo}</span>
            </div>
            <div class="activity-details">
              ${teamName} bid <strong>${amount}</strong> on ${playerName}
            </div>
          </div>
        `;
      } else {
        const auction = activity.data as CompletedAuction;
        const playerInfo = this.playerLookup[auction.playerId];
        const playerName = playerInfo ? playerInfo.name : `Player ${auction.playerId}`;
        const teamInfo = this.teamLookup[auction.franchise];
        const teamName = teamInfo ? teamInfo.name : `Team ${auction.franchise}`;
        const amount = this.formatCurrency(auction.winningBid);

        return `
          <div class="activity-item">
            <div class="activity-header">
              <span class="activity-type">✅ Auction Won</span>
              <span class="activity-time">${timeAgo}</span>
            </div>
            <div class="activity-details">
              ${teamName} signed ${playerName} for <strong>${amount}</strong>
            </div>
          </div>
        `;
      }
    }).join('');

    activityFeed.innerHTML = activityHTML;
  }

  /**
   * Update price comparison dashboard
   */
  private updatePriceComparison(completedAuctions: CompletedAuction[]): void {
    const totalAuctions = document.getElementById('totalAuctions');
    const avgAccuracy = document.getElementById('avgAccuracy');
    const withinRange = document.getElementById('withinRange');
    const comparisonList = document.getElementById('priceComparisonList');

    if (!totalAuctions || !avgAccuracy || !withinRange || !comparisonList) return;

    // Calculate stats
    const auctionsWithPredictions = completedAuctions.filter(a => this.predictedPrices[a.playerId]);

    if (auctionsWithPredictions.length === 0) {
      totalAuctions.textContent = '0';
      avgAccuracy.textContent = '--%';
      withinRange.textContent = '0';

      comparisonList.innerHTML = `
        <div class="no-comparisons-message">
          <span class="placeholder-icon">📈</span>
          <p>No completed auctions yet</p>
        </div>
      `;
      return;
    }

    totalAuctions.textContent = completedAuctions.length.toString();

    // Calculate accuracy
    const accuracies = auctionsWithPredictions.map(auction => {
      const predicted = this.predictedPrices[auction.playerId];
      const actual = auction.winningBid;
      const diff = Math.abs(actual - predicted);
      return 100 - (diff / predicted) * 100;
    });

    const avgAcc = accuracies.reduce((sum, acc) => sum + acc, 0) / accuracies.length;
    avgAccuracy.textContent = `${Math.round(avgAcc)}%`;

    // Count within 10%
    const within10Percent = auctionsWithPredictions.filter(auction => {
      const predicted = this.predictedPrices[auction.playerId];
      const actual = auction.winningBid;
      const diff = Math.abs(actual - predicted);
      return diff / predicted <= 0.1;
    }).length;

    withinRange.textContent = within10Percent.toString();

    // Render comparison list
    const comparisonsHTML = completedAuctions.slice(0, 20).map(auction => {
      const playerInfo = this.playerLookup[auction.playerId];
      const playerName = playerInfo ? playerInfo.name : `Player ${auction.playerId}`;
      const predicted = this.predictedPrices[auction.playerId];
      const actual = auction.winningBid;

      if (!predicted) {
        return `
          <div class="comparison-item">
            <div class="comparison-player">${playerName}</div>
            <div class="comparison-prices">
              <span class="price-predicted">No prediction</span>
              <span class="price-actual">Sold: ${this.formatCurrency(actual)}</span>
              <span class="price-diff">--</span>
            </div>
          </div>
        `;
      }

      const diff = actual - predicted;
      const percentDiff = Math.abs((diff / predicted) * 100);
      const isAccurate = percentDiff <= 10;

      let diffClass = 'accurate';
      let diffText = `✓ ${percentDiff.toFixed(0)}%`;

      if (!isAccurate) {
        diffClass = diff > 0 ? 'over' : 'under';
        diffText = diff > 0 ? `+${percentDiff.toFixed(0)}%` : `-${percentDiff.toFixed(0)}%`;
      }

      return `
        <div class="comparison-item">
          <div class="comparison-player">${playerName}</div>
          <div class="comparison-prices">
            <span class="price-predicted">Pred: ${this.formatCurrency(predicted)}</span>
            <span class="price-actual">Sold: ${this.formatCurrency(actual)}</span>
            <span class="price-diff ${diffClass}">${diffText}</span>
          </div>
        </div>
      `;
    }).join('');

    comparisonList.innerHTML = comparisonsHTML;
  }

  /**
   * Format currency
   */
  private formatCurrency(amount: number): string {
    if (amount >= 1_000_000) {
      return `$${(amount / 1_000_000).toFixed(1)}M`;
    } else if (amount >= 1_000) {
      return `$${(amount / 1_000).toFixed(0)}k`;
    } else {
      return `$${amount}`;
    }
  }

  /**
   * Format time ago
   */
  private formatTimeAgo(timestamp: number): string {
    const now = Date.now() / 1000;
    const seconds = Math.floor(now - timestamp);

    if (seconds < 60) {
      return 'Just now';
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return `${minutes}m ago`;
    } else if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      return `${hours}h ago`;
    } else {
      const days = Math.floor(seconds / 86400);
      return `${days}d ago`;
    }
  }
}

/**
 * Create live mode manager
 */
export function createLiveModeManager(config: LiveModeManagerConfig): LiveModeManager {
  return new LiveModeManager(config);
}
