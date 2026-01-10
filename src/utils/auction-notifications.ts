/**
 * Auction Notification System
 *
 * Provides toast notifications and sound alerts for live auction events.
 * Respects user preferences stored in localStorage.
 */

export interface NotificationPreferences {
  enabled: boolean;
  soundEnabled: boolean;
  notifyAllBids: boolean; // Notify for all bids vs only target players
  notifyCompletions: boolean;
  alertThreshold: number; // Only notify for bids >= this amount (in dollars)
  maxNotificationsPerMinute: number;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: true,
  soundEnabled: true,
  notifyAllBids: false, // Default: only notify for target players
  notifyCompletions: true,
  alertThreshold: 0, // Notify for all amounts
  maxNotificationsPerMinute: 12, // Max 1 per 5 seconds
};

const STORAGE_KEY = 'auction_notification_preferences';

/**
 * Load notification preferences from localStorage
 */
export function loadNotificationPreferences(): NotificationPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return DEFAULT_PREFERENCES;
    }

    const parsed = JSON.parse(stored);
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch (error) {
    console.error('Failed to load notification preferences:', error);
    return DEFAULT_PREFERENCES;
  }
}

/**
 * Save notification preferences to localStorage
 */
export function saveNotificationPreferences(preferences: NotificationPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch (error) {
    console.error('Failed to save notification preferences:', error);
  }
}

/**
 * Reset preferences to defaults
 */
export function resetNotificationPreferences(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Notification Manager
 * Handles rate limiting, sound playback, and toast display
 */
export class AuctionNotificationManager {
  private preferences: NotificationPreferences;
  private notificationTimestamps: number[] = [];
  private audioContext: AudioContext | null = null;

  constructor() {
    this.preferences = loadNotificationPreferences();
  }

  /**
   * Update preferences
   */
  updatePreferences(preferences: Partial<NotificationPreferences>): void {
    this.preferences = { ...this.preferences, ...preferences };
    saveNotificationPreferences(this.preferences);
  }

  /**
   * Get current preferences
   */
  getPreferences(): NotificationPreferences {
    return { ...this.preferences };
  }

  /**
   * Check if notifications should be shown (rate limiting)
   */
  private canNotify(): boolean {
    if (!this.preferences.enabled) {
      return false;
    }

    // Clean up old timestamps (older than 1 minute)
    const oneMinuteAgo = Date.now() - 60000;
    this.notificationTimestamps = this.notificationTimestamps.filter(
      (timestamp) => timestamp > oneMinuteAgo
    );

    // Check if we've exceeded rate limit
    if (this.notificationTimestamps.length >= this.preferences.maxNotificationsPerMinute) {
      console.log('Notification rate limit exceeded, skipping notification');
      return false;
    }

    return true;
  }

  /**
   * Record notification timestamp (for rate limiting)
   */
  private recordNotification(): void {
    this.notificationTimestamps.push(Date.now());
  }

  /**
   * Play notification sound (simple beep)
   */
  private playSound(): void {
    if (!this.preferences.soundEnabled) {
      return;
    }

    try {
      // Create AudioContext if needed
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const ctx = this.audioContext;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      // Short beep: 800Hz for 100ms
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.1);
    } catch (error) {
      console.error('Failed to play notification sound:', error);
    }
  }

  /**
   * Show toast notification
   */
  private showToast(message: string, type: 'info' | 'success' | 'warning' = 'info'): void {
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `auction-toast auction-toast-${type}`;
    toast.textContent = message;

    // Add to page
    let container = document.querySelector('.auction-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'auction-toast-container';
      document.body.appendChild(container);
    }

    container.appendChild(toast);

    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);

    // Remove after 5 seconds
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  /**
   * Notify for new player on auction block
   */
  notifyPlayerNominated(playerName: string, startingBid: number): void {
    if (!this.canNotify()) {
      return;
    }

    this.recordNotification();
    this.playSound();

    const formattedBid = `$${(startingBid / 1_000_000).toFixed(1)}M`;
    this.showToast(
      `🔨 ${playerName} on auction block (starting at ${formattedBid})`,
      'info'
    );
  }

  /**
   * Notify for new bid
   */
  notifyNewBid(
    playerName: string,
    teamName: string,
    bidAmount: number,
    isTargetPlayer: boolean = false
  ): void {
    // Check if we should notify based on preferences
    if (!this.preferences.notifyAllBids && !isTargetPlayer) {
      return; // Only notify for target players
    }

    // Check alert threshold
    if (bidAmount < this.preferences.alertThreshold) {
      return;
    }

    if (!this.canNotify()) {
      return;
    }

    this.recordNotification();

    // Play sound for target players
    if (isTargetPlayer) {
      this.playSound();
    }

    const formattedBid = `$${(bidAmount / 1_000_000).toFixed(1)}M`;
    const emoji = isTargetPlayer ? '⭐' : '💰';

    this.showToast(
      `${emoji} ${teamName} bid ${formattedBid} on ${playerName}`,
      isTargetPlayer ? 'warning' : 'info'
    );
  }

  /**
   * Notify for auction completion
   */
  notifyAuctionWon(
    playerName: string,
    teamName: string,
    winningBid: number,
    predictedPrice: number | null = null
  ): void {
    if (!this.preferences.notifyCompletions) {
      return;
    }

    if (!this.canNotify()) {
      return;
    }

    this.recordNotification();

    const formattedBid = `$${(winningBid / 1_000_000).toFixed(1)}M`;
    let message = `✅ ${teamName} signed ${playerName} for ${formattedBid}`;

    // Add prediction accuracy if available
    if (predictedPrice && predictedPrice > 0) {
      const difference = winningBid - predictedPrice;
      const percentDiff = Math.abs((difference / predictedPrice) * 100);

      if (Math.abs(difference) < predictedPrice * 0.1) {
        // Within 10% - accurate prediction
        message += ` (predicted: ${(predictedPrice / 1_000_000).toFixed(1)}M ✓)`;
      } else if (difference > 0) {
        // Went over prediction
        message += ` (+${percentDiff.toFixed(0)}% over predicted)`;
      } else {
        // Went under prediction
        message += ` (${percentDiff.toFixed(0)}% under predicted)`;
      }
    }

    this.showToast(message, 'success');
  }

  /**
   * Show error notification
   */
  notifyError(message: string): void {
    this.showToast(`❌ ${message}`, 'warning');
  }
}

/**
 * Create notification manager instance
 */
export function createNotificationManager(): AuctionNotificationManager {
  return new AuctionNotificationManager();
}

/**
 * CSS for toast notifications (inject into page)
 */
export function injectNotificationStyles(): void {
  if (document.getElementById('auction-notification-styles')) {
    return; // Already injected
  }

  const style = document.createElement('style');
  style.id = 'auction-notification-styles';
  style.textContent = `
    .auction-toast-container {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    }

    .auction-toast {
      background: white;
      color: #1f2937;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      font-size: 14px;
      font-weight: 500;
      max-width: 350px;
      opacity: 0;
      transform: translateX(100%);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      pointer-events: auto;
      border-left: 4px solid #3b82f6;
    }

    .auction-toast.show {
      opacity: 1;
      transform: translateX(0);
    }

    .auction-toast-info {
      border-left-color: #3b82f6;
      background: #eff6ff;
    }

    .auction-toast-success {
      border-left-color: #10b981;
      background: #f0fdf4;
    }

    .auction-toast-warning {
      border-left-color: #f59e0b;
      background: #fef3c7;
    }

    @media (max-width: 640px) {
      .auction-toast-container {
        top: 10px;
        right: 10px;
        left: 10px;
      }

      .auction-toast {
        max-width: 100%;
        font-size: 13px;
        padding: 10px 16px;
      }
    }
  `;

  document.head.appendChild(style);
}
