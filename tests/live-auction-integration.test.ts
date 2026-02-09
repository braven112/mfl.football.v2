import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createActivityDetector } from '../src/utils/live-auction-activity-detector';
import { createLiveModeManager } from '../src/utils/live-mode-manager';
import type { PlayerLookup, TeamLookup } from '../src/utils/live-auction-activity-detector';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// Mock DOM
const mockDOM = () => {
  document.body.innerHTML = `
    <div id="planningContainer">Planning Mode Content</div>
    <div id="liveAuctionPanel">
      <span id="lastUpdateTime"></span>
      <div id="currentPlayerCard"></div>
      <div id="activityFeed"></div>
      <div id="totalAuctions"></div>
      <div id="avgAccuracy"></div>
      <div id="withinRange"></div>
      <div id="priceComparisonList"></div>
    </div>
  `;
};

describe('Live Auction Integration', () => {
  const mockPlayerLookup: PlayerLookup = {
    '14835': { name: 'Saquon Barkley', position: 'RB' },
    '13130': { name: 'Travis Kelce', position: 'TE' },
    '14104': { name: 'CeeDee Lamb', position: 'WR' },
  };

  const mockTeamLookup: TeamLookup = {
    '0001': { name: 'Pacific Pigskins', abbrev: 'PP' },
    '0009': { name: 'Fire Ready Aim', abbrev: 'FRA' },
    '0005': { name: 'DMOC', abbrev: 'DMOC' },
  };

  const mockPredictedPrices = {
    '14835': 7500000, // $7.5M
    '13130': 5800000, // $5.8M
    '14104': 8000000, // $8M
  };

  beforeEach(() => {
    mockDOM();
    mockFetch.mockClear();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Live Mode Manager', () => {
    it('should initialize with planning mode by default', () => {
      localStorage.removeItem('auctionMode');

      const manager = createLiveModeManager({
        playerLookup: mockPlayerLookup,
        teamLookup: mockTeamLookup,
        predictedPrices: mockPredictedPrices,
      });

      manager.initialize('planningContainer', 'liveAuctionPanel');

      expect(manager.getMode()).toBe('planning');
      expect(document.getElementById('planningContainer')?.style.display).toBe('block');
      expect(document.getElementById('liveAuctionPanel')?.style.display).toBe('none');
    });

    it('should restore live mode from localStorage', () => {
      localStorage.setItem('auctionMode', 'live');

      const manager = createLiveModeManager({
        playerLookup: mockPlayerLookup,
        teamLookup: mockTeamLookup,
      });

      manager.initialize('planningContainer', 'liveAuctionPanel');

      expect(manager.getMode()).toBe('live');
      expect(document.getElementById('planningContainer')?.style.display).toBe('none');
      expect(document.getElementById('liveAuctionPanel')?.style.display).toBe('block');
    });

    it('should switch modes on setMode()', () => {
      const manager = createLiveModeManager({
        playerLookup: mockPlayerLookup,
        teamLookup: mockTeamLookup,
      });

      manager.initialize('planningContainer', 'liveAuctionPanel');

      // Switch to live mode
      manager.setMode('live');
      expect(manager.getMode()).toBe('live');
      expect(localStorage.getItem('auctionMode')).toBe('live');

      // Switch back to planning
      manager.setMode('planning');
      expect(manager.getMode()).toBe('planning');
      expect(localStorage.getItem('auctionMode')).toBe('planning');
    });

    it('should update current player display', () => {
      const manager = createLiveModeManager({
        playerLookup: mockPlayerLookup,
        teamLookup: mockTeamLookup,
      });

      manager.initialize('planningContainer', 'liveAuctionPanel');
      manager.setMode('live');

      const state = {
        currentPlayer: {
          playerId: '14835',
          startingBid: 425000,
          currentBid: 7500000,
          currentBidder: '0009',
          timeStarted: Date.now() / 1000,
          lastBidTime: Date.now() / 1000,
        },
        recentBids: [],
        completedAuctions: [],
        isActive: true,
        lastUpdate: Date.now(),
      };

      manager.updateLivePanel(state);

      const currentPlayerCard = document.getElementById('currentPlayerCard');
      expect(currentPlayerCard?.textContent).toContain('Saquon Barkley');
      expect(currentPlayerCard?.textContent).toContain('RB');
      expect(currentPlayerCard?.textContent).toContain('$7.5M');
      expect(currentPlayerCard?.textContent).toContain('Fire Ready Aim');
    });

    it('should show no player message when currentPlayer is null', () => {
      const manager = createLiveModeManager({
        playerLookup: mockPlayerLookup,
        teamLookup: mockTeamLookup,
      });

      manager.initialize('planningContainer', 'liveAuctionPanel');
      manager.setMode('live');

      const state = {
        currentPlayer: null,
        recentBids: [],
        completedAuctions: [],
        isActive: false,
        lastUpdate: Date.now(),
      };

      manager.updateLivePanel(state);

      const currentPlayerCard = document.getElementById('currentPlayerCard');
      expect(currentPlayerCard?.textContent).toContain('No active auction');
    });

    it('should populate activity feed with bids and completions', () => {
      const manager = createLiveModeManager({
        playerLookup: mockPlayerLookup,
        teamLookup: mockTeamLookup,
      });

      manager.initialize('planningContainer', 'liveAuctionPanel');
      manager.setMode('live');

      const now = Date.now() / 1000;
      const state = {
        currentPlayer: null,
        recentBids: [
          {
            playerId: '14835',
            franchise: '0009',
            amount: 7500000,
            timestamp: now - 120, // 2 minutes ago
          },
          {
            playerId: '14104',
            franchise: '0001',
            amount: 8000000,
            timestamp: now - 300, // 5 minutes ago
          },
        ],
        completedAuctions: [
          {
            playerId: '13130',
            franchise: '0005',
            winningBid: 6000000,
            timestamp: now - 600, // 10 minutes ago
          },
        ],
        isActive: true,
        lastUpdate: Date.now(),
      };

      manager.updateLivePanel(state);

      const activityFeed = document.getElementById('activityFeed');
      expect(activityFeed?.textContent).toContain('New Bid');
      expect(activityFeed?.textContent).toContain('Saquon Barkley');
      expect(activityFeed?.textContent).toContain('Fire Ready Aim');
      expect(activityFeed?.textContent).toContain('Auction Won');
      expect(activityFeed?.textContent).toContain('Travis Kelce');
      expect(activityFeed?.textContent).toContain('DMOC');
    });

    it('should calculate price comparison stats correctly', () => {
      const manager = createLiveModeManager({
        playerLookup: mockPlayerLookup,
        teamLookup: mockTeamLookup,
        predictedPrices: mockPredictedPrices,
      });

      manager.initialize('planningContainer', 'liveAuctionPanel');
      manager.setMode('live');

      const state = {
        currentPlayer: null,
        recentBids: [],
        completedAuctions: [
          // Accurate prediction (within 10%)
          {
            playerId: '13130',
            franchise: '0005',
            winningBid: 6000000, // Predicted: $5.8M, +3.4%
            timestamp: Date.now() / 1000,
          },
          // Over prediction
          {
            playerId: '14835',
            franchise: '0009',
            winningBid: 9000000, // Predicted: $7.5M, +20%
            timestamp: Date.now() / 1000,
          },
          // Under prediction
          {
            playerId: '14104',
            franchise: '0001',
            winningBid: 6500000, // Predicted: $8M, -18.75%
            timestamp: Date.now() / 1000,
          },
        ],
        isActive: false,
        lastUpdate: Date.now(),
      };

      manager.updateLivePanel(state);

      const totalAuctions = document.getElementById('totalAuctions');
      const withinRange = document.getElementById('withinRange');

      expect(totalAuctions?.textContent).toBe('3');
      expect(withinRange?.textContent).toBe('1'); // Only Travis Kelce within 10%
    });
  });

  describe('Activity Detector Integration', () => {
    it('should create activity detector with proper config', () => {
      const detector = createActivityDetector({
        year: 2026,
        leagueId: '13522',
        playerLookup: mockPlayerLookup,
        teamLookup: mockTeamLookup,
        predictedPrices: mockPredictedPrices,
      });

      expect(detector).toBeDefined();
      expect(detector.isRunning()).toBe(false);
    });

    it('should start and stop polling', () => {
      const detector = createActivityDetector({
        year: 2026,
        leagueId: '13522',
        playerLookup: mockPlayerLookup,
        teamLookup: mockTeamLookup,
      });

      detector.start();
      expect(detector.isRunning()).toBe(true);

      detector.stop();
      expect(detector.isRunning()).toBe(false);
    });

    it('should add and remove target players', () => {
      const detector = createActivityDetector({
        year: 2026,
        leagueId: '13522',
        playerLookup: mockPlayerLookup,
        teamLookup: mockTeamLookup,
      });

      const highlightManager = detector.getHighlightManager();

      detector.addTargetPlayer('14835');
      expect(highlightManager.isTargetPlayer('14835')).toBe(true);

      detector.removeTargetPlayer('14835');
      expect(highlightManager.isTargetPlayer('14835')).toBe(false);
    });

    it('should get notification manager for preferences', () => {
      const detector = createActivityDetector({
        year: 2026,
        leagueId: '13522',
        playerLookup: mockPlayerLookup,
        teamLookup: mockTeamLookup,
      });

      const notificationManager = detector.getNotificationManager();
      expect(notificationManager).toBeDefined();

      const preferences = notificationManager.getPreferences();
      expect(preferences).toHaveProperty('enabled');
      expect(preferences).toHaveProperty('soundEnabled');
    });
  });

  describe('End-to-End Flow', () => {
    it('should handle complete mode switch and data flow', () => {
      // Create managers
      const liveModeManager = createLiveModeManager({
        playerLookup: mockPlayerLookup,
        teamLookup: mockTeamLookup,
        predictedPrices: mockPredictedPrices,
      });

      liveModeManager.initialize('planningContainer', 'liveAuctionPanel');

      const onStateChange = vi.fn((state) => {
        liveModeManager.updateLivePanel(state);
      });

      const detector = createActivityDetector({
        year: 2026,
        leagueId: '13522',
        playerLookup: mockPlayerLookup,
        teamLookup: mockTeamLookup,
        predictedPrices: mockPredictedPrices,
        onStateChange,
      });

      // Start in planning mode
      expect(liveModeManager.getMode()).toBe('planning');
      expect(detector.isRunning()).toBe(false);

      // Switch to live mode
      liveModeManager.setMode('live');
      detector.start();

      expect(liveModeManager.getMode()).toBe('live');
      expect(detector.isRunning()).toBe(true);

      // Simulate state update
      const mockState = {
        currentPlayer: {
          playerId: '14835',
          startingBid: 425000,
          currentBid: 7500000,
          currentBidder: '0009',
          timeStarted: Date.now() / 1000,
          lastBidTime: Date.now() / 1000,
        },
        recentBids: [],
        completedAuctions: [],
        isActive: true,
        lastUpdate: Date.now(),
      };

      onStateChange(mockState);

      expect(onStateChange).toHaveBeenCalledWith(mockState);

      // Verify UI was updated
      const currentPlayerCard = document.getElementById('currentPlayerCard');
      expect(currentPlayerCard?.textContent).toContain('Saquon Barkley');

      // Switch back to planning mode
      liveModeManager.setMode('planning');
      detector.stop();

      expect(liveModeManager.getMode()).toBe('planning');
      expect(detector.isRunning()).toBe(false);
    });

    it('should persist mode across page reloads', () => {
      // Set live mode
      const manager1 = createLiveModeManager({
        playerLookup: mockPlayerLookup,
        teamLookup: mockTeamLookup,
      });
      manager1.setMode('live');

      // Simulate page reload - create new manager
      const manager2 = createLiveModeManager({
        playerLookup: mockPlayerLookup,
        teamLookup: mockTeamLookup,
      });

      // Should restore live mode
      expect(manager2.getMode()).toBe('live');
    });
  });

  describe('Currency Formatting', () => {
    it('should format large amounts as millions', () => {
      const manager = createLiveModeManager({
        playerLookup: mockPlayerLookup,
        teamLookup: mockTeamLookup,
      });

      manager.initialize('planningContainer', 'liveAuctionPanel');
      manager.setMode('live');

      const state = {
        currentPlayer: {
          playerId: '14835',
          startingBid: 425000,
          currentBid: 7500000,
          currentBidder: null,
          timeStarted: Date.now() / 1000,
          lastBidTime: Date.now() / 1000,
        },
        recentBids: [],
        completedAuctions: [],
        isActive: true,
        lastUpdate: Date.now(),
      };

      manager.updateLivePanel(state);

      const currentPlayerCard = document.getElementById('currentPlayerCard');
      expect(currentPlayerCard?.textContent).toContain('$7.5M');
      expect(currentPlayerCard?.textContent).toContain('$425k');
    });
  });

  describe('Time Formatting', () => {
    it('should format recent times correctly', () => {
      const manager = createLiveModeManager({
        playerLookup: mockPlayerLookup,
        teamLookup: mockTeamLookup,
      });

      manager.initialize('planningContainer', 'liveAuctionPanel');
      manager.setMode('live');

      const now = Date.now() / 1000;
      const state = {
        currentPlayer: null,
        recentBids: [
          {
            playerId: '14835',
            franchise: '0009',
            amount: 7500000,
            timestamp: now - 30, // 30 seconds ago
          },
          {
            playerId: '14104',
            franchise: '0001',
            amount: 8000000,
            timestamp: now - 180, // 3 minutes ago
          },
        ],
        completedAuctions: [],
        isActive: true,
        lastUpdate: Date.now(),
      };

      manager.updateLivePanel(state);

      const activityFeed = document.getElementById('activityFeed');
      expect(activityFeed?.textContent).toContain('Just now');
      expect(activityFeed?.textContent).toContain('3m ago');
    });
  });
});
