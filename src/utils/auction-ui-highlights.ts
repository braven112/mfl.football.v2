/**
 * Auction UI Highlight System
 *
 * Manages visual highlights for players in the auction predictor table
 * based on live auction activity (current player on block, recently bid, recently sold).
 */

export type HighlightType = 'current' | 'recent-bid' | 'sold' | 'target';

export interface PlayerHighlight {
  playerId: string;
  type: HighlightType;
  timestamp: number;
  metadata?: {
    currentBid?: number;
    franchise?: string;
    winningBid?: number;
  };
}

const HIGHLIGHT_DURATION = {
  'current': Infinity, // Stays until auction completes
  'recent-bid': 30000, // 30 seconds
  'sold': 120000, // 2 minutes
  'target': Infinity, // Manual highlights persist
};

/**
 * Player Highlight Manager
 * Tracks which players should be highlighted in the UI
 */
export class PlayerHighlightManager {
  private highlights = new Map<string, PlayerHighlight>();
  private targetPlayers = new Set<string>(); // Players user is tracking
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Clean up expired highlights every 5 seconds
    this.cleanupTimer = setInterval(() => this.cleanupExpiredHighlights(), 5000);
  }

  /**
   * Cleanup when manager is destroyed
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Add player to target list (from budget planner)
   */
  addTargetPlayer(playerId: string): void {
    this.targetPlayers.add(playerId);
    this.addHighlight({
      playerId,
      type: 'target',
      timestamp: Date.now(),
    });
  }

  /**
   * Remove player from target list
   */
  removeTargetPlayer(playerId: string): void {
    this.targetPlayers.delete(playerId);
    if (this.highlights.get(playerId)?.type === 'target') {
      this.highlights.delete(playerId);
    }
  }

  /**
   * Check if player is a target
   */
  isTargetPlayer(playerId: string): boolean {
    return this.targetPlayers.has(playerId);
  }

  /**
   * Get all target player IDs
   */
  getTargetPlayers(): string[] {
    return Array.from(this.targetPlayers);
  }

  /**
   * Highlight player currently on auction block
   */
  highlightCurrentPlayer(playerId: string, currentBid: number, franchise: string | null): void {
    this.addHighlight({
      playerId,
      type: 'current',
      timestamp: Date.now(),
      metadata: { currentBid, franchise: franchise || undefined },
    });
  }

  /**
   * Highlight player who received a recent bid
   */
  highlightRecentBid(playerId: string, bidAmount: number, franchise: string): void {
    // Don't override 'current' highlight
    const existing = this.highlights.get(playerId);
    if (existing?.type === 'current') {
      return;
    }

    this.addHighlight({
      playerId,
      type: 'recent-bid',
      timestamp: Date.now(),
      metadata: { currentBid: bidAmount, franchise },
    });
  }

  /**
   * Highlight player who was just sold
   */
  highlightSoldPlayer(playerId: string, winningBid: number, franchise: string): void {
    this.addHighlight({
      playerId,
      type: 'sold',
      timestamp: Date.now(),
      metadata: { winningBid, franchise },
    });
  }

  /**
   * Clear highlight for specific player
   */
  clearHighlight(playerId: string): void {
    this.highlights.delete(playerId);
  }

  /**
   * Clear all highlights of a specific type
   */
  clearHighlightsByType(type: HighlightType): void {
    for (const [playerId, highlight] of this.highlights.entries()) {
      if (highlight.type === type) {
        this.highlights.delete(playerId);
      }
    }
  }

  /**
   * Clear all highlights
   */
  clearAllHighlights(): void {
    // Keep target highlights
    for (const [playerId, highlight] of this.highlights.entries()) {
      if (highlight.type !== 'target') {
        this.highlights.delete(playerId);
      }
    }
  }

  /**
   * Get highlight for specific player
   */
  getHighlight(playerId: string): PlayerHighlight | null {
    return this.highlights.get(playerId) || null;
  }

  /**
   * Get all highlights
   */
  getAllHighlights(): PlayerHighlight[] {
    return Array.from(this.highlights.values());
  }

  /**
   * Get CSS class for player row
   */
  getHighlightClass(playerId: string): string {
    const highlight = this.highlights.get(playerId);
    if (!highlight) {
      return '';
    }

    switch (highlight.type) {
      case 'current':
        return 'player-row-current-auction';
      case 'recent-bid':
        return 'player-row-recent-bid';
      case 'sold':
        return 'player-row-sold';
      case 'target':
        return 'player-row-target';
      default:
        return '';
    }
  }

  /**
   * Check if player should be highlighted
   */
  isHighlighted(playerId: string): boolean {
    return this.highlights.has(playerId);
  }

  /**
   * Add or update highlight
   */
  private addHighlight(highlight: PlayerHighlight): void {
    this.highlights.set(highlight.playerId, highlight);
  }

  /**
   * Remove expired highlights
   */
  private cleanupExpiredHighlights(): void {
    const now = Date.now();

    for (const [playerId, highlight] of this.highlights.entries()) {
      const duration = HIGHLIGHT_DURATION[highlight.type];

      if (duration === Infinity) {
        continue; // Permanent highlight
      }

      const age = now - highlight.timestamp;
      if (age > duration) {
        this.highlights.delete(playerId);
      }
    }
  }
}

/**
 * Create player highlight manager
 */
export function createHighlightManager(): PlayerHighlightManager {
  return new PlayerHighlightManager();
}

/**
 * CSS for player highlights (inject into page)
 */
export function injectHighlightStyles(): void {
  if (document.getElementById('auction-highlight-styles')) {
    return; // Already injected
  }

  const style = document.createElement('style');
  style.id = 'auction-highlight-styles';
  style.textContent = `
    /* Current player on auction block - prominent highlight */
    .player-row-current-auction {
      background: linear-gradient(90deg, #fef3c7 0%, #fef9e6 100%) !important;
      border-left: 4px solid #f59e0b !important;
      animation: pulse-auction 2s infinite;
    }

    @keyframes pulse-auction {
      0%, 100% {
        background: linear-gradient(90deg, #fef3c7 0%, #fef9e6 100%);
      }
      50% {
        background: linear-gradient(90deg, #fde68a 0%, #fef3c7 100%);
      }
    }

    /* Recently bid player - moderate highlight */
    .player-row-recent-bid {
      background: #eff6ff !important;
      border-left: 4px solid #3b82f6 !important;
    }

    /* Sold player - subtle highlight with strikethrough */
    .player-row-sold {
      background: #f3f4f6 !important;
      border-left: 4px solid #10b981 !important;
      opacity: 0.7;
    }

    .player-row-sold .player-name {
      text-decoration: line-through;
    }

    /* Target player (from budget planner) - always highlighted */
    .player-row-target {
      background: #fef2f2 !important;
      border-left: 4px solid #ef4444 !important;
    }

    /* Mobile card highlights */
    @media (max-width: 968px) {
      .player-card.player-row-current-auction {
        background: linear-gradient(135deg, #fef3c7 0%, #fef9e6 100%) !important;
        border: 2px solid #f59e0b !important;
      }

      .player-card.player-row-recent-bid {
        background: #eff6ff !important;
        border: 2px solid #3b82f6 !important;
      }

      .player-card.player-row-sold {
        background: #f3f4f6 !important;
        border: 2px solid #10b981 !important;
      }

      .player-card.player-row-target {
        background: #fef2f2 !important;
        border: 2px solid #ef4444 !important;
      }
    }

    /* Smooth transitions */
    .player-row,
    .player-card {
      transition: background-color 0.3s ease, border-color 0.3s ease, opacity 0.3s ease;
    }
  `;

  document.head.appendChild(style);
}
