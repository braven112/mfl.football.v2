import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiveAuctionPoller, createAuctionPoller } from '../src/utils/live-auction-poller';
import type { AuctionState } from '../src/utils/live-auction-poller';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// Mock setTimeout/clearTimeout
vi.useFakeTimers();

describe('LiveAuctionPoller', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('should create poller with default config', () => {
    const poller = createAuctionPoller();
    expect(poller).toBeInstanceOf(LiveAuctionPoller);
  });

  it('should start polling and fetch auction state', async () => {
    const mockState: AuctionState = {
      currentPlayer: {
        playerId: '14835',
        startingBid: 425000,
        currentBid: 2000000,
        currentBidder: '0009',
        timeStarted: 1746378800,
        lastBidTime: 1746506076,
      },
      recentBids: [
        {
          playerId: '14835',
          franchise: '0009',
          amount: 2000000,
          timestamp: 1746506076,
        },
      ],
      completedAuctions: [],
      isActive: true,
      lastUpdate: Date.now(),
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockState,
    });

    const onStateUpdate = vi.fn();
    const poller = createAuctionPoller({
      pollInterval: 1000,
      callbacks: { onStateUpdate },
    });

    poller.start();

    // Wait for initial poll to complete
    await vi.advanceTimersToNextTimerAsync();
    await Promise.resolve(); // Let promise resolve

    expect(mockFetch).toHaveBeenCalled();
    expect(onStateUpdate).toHaveBeenCalledWith(expect.objectContaining({
      isActive: true,
    }));

    poller.stop();
  });

  it('should trigger onPlayerNominated when new player is on block', async () => {
    const initialState: AuctionState = {
      currentPlayer: null,
      recentBids: [],
      completedAuctions: [],
      isActive: false,
      lastUpdate: Date.now(),
    };

    const newPlayerState: AuctionState = {
      currentPlayer: {
        playerId: '14835',
        startingBid: 425000,
        currentBid: 425000,
        currentBidder: null,
        timeStarted: 1746378800,
        lastBidTime: 1746378800,
      },
      recentBids: [],
      completedAuctions: [],
      isActive: true,
      lastUpdate: Date.now(),
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => initialState,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => newPlayerState,
      });

    const onPlayerNominated = vi.fn();
    const poller = createAuctionPoller({
      pollInterval: 1000,
      callbacks: { onPlayerNominated },
    });

    poller.start();

    // First poll
    await vi.runOnlyPendingTimersAsync();
    expect(onPlayerNominated).not.toHaveBeenCalled();

    // Second poll - new player
    await vi.runOnlyPendingTimersAsync();
    expect(onPlayerNominated).toHaveBeenCalledWith(newPlayerState.currentPlayer);

    poller.stop();
  });

  it('should trigger onNewBid when bid is placed', async () => {
    const initialState: AuctionState = {
      currentPlayer: {
        playerId: '14835',
        startingBid: 425000,
        currentBid: 425000,
        currentBidder: null,
        timeStarted: 1746378800,
        lastBidTime: 1746378800,
      },
      recentBids: [],
      completedAuctions: [],
      isActive: true,
      lastUpdate: Date.now(),
    };

    const newBidState: AuctionState = {
      ...initialState,
      currentPlayer: {
        ...initialState.currentPlayer!,
        currentBid: 1000000,
        currentBidder: '0005',
        lastBidTime: 1746378900,
      },
      recentBids: [
        {
          playerId: '14835',
          franchise: '0005',
          amount: 1000000,
          timestamp: 1746378900,
        },
      ],
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => initialState,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => newBidState,
      });

    const onNewBid = vi.fn();
    const poller = createAuctionPoller({
      pollInterval: 1000,
      callbacks: { onNewBid },
    });

    poller.start();

    // First poll
    await vi.runOnlyPendingTimersAsync();

    // Second poll - new bid
    await vi.runOnlyPendingTimersAsync();
    expect(onNewBid).toHaveBeenCalledWith(newBidState.recentBids[0]);

    poller.stop();
  });

  it('should trigger onAuctionWon when auction completes', async () => {
    const initialState: AuctionState = {
      currentPlayer: {
        playerId: '14835',
        startingBid: 425000,
        currentBid: 2000000,
        currentBidder: '0009',
        timeStarted: 1746378800,
        lastBidTime: 1746506076,
      },
      recentBids: [],
      completedAuctions: [],
      isActive: true,
      lastUpdate: Date.now(),
    };

    const completedState: AuctionState = {
      currentPlayer: null,
      recentBids: [],
      completedAuctions: [
        {
          playerId: '14835',
          franchise: '0009',
          winningBid: 2000000,
          timestamp: 1746506100,
        },
      ],
      isActive: false,
      lastUpdate: Date.now(),
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => initialState,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => completedState,
      });

    const onAuctionWon = vi.fn();
    const poller = createAuctionPoller({
      pollInterval: 1000,
      callbacks: { onAuctionWon },
    });

    poller.start();

    // First poll
    await vi.runOnlyPendingTimersAsync();

    // Second poll - auction won
    await vi.runOnlyPendingTimersAsync();
    expect(onAuctionWon).toHaveBeenCalledWith(completedState.completedAuctions[0]);

    poller.stop();
  });

  it('should handle API errors with circuit breaker', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const onError = vi.fn();
    const poller = createAuctionPoller({
      pollInterval: 1000,
      maxFailures: 3,
      callbacks: { onError },
    });

    poller.start();

    // First failure
    await vi.runOnlyPendingTimersAsync();
    expect(onError).toHaveBeenCalledTimes(1);

    // Second failure
    await vi.runOnlyPendingTimersAsync();
    expect(onError).toHaveBeenCalledTimes(2);

    // Third failure - circuit breaker triggers
    await vi.runOnlyPendingTimersAsync();
    expect(onError).toHaveBeenCalledTimes(3);

    // Polling should have stopped
    await vi.runOnlyPendingTimersAsync();
    expect(onError).toHaveBeenCalledTimes(3); // No more calls

    poller.stop();
  });

  it('should use exponential backoff on errors', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Error 1'))
      .mockRejectedValueOnce(new Error('Error 2'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          currentPlayer: null,
          recentBids: [],
          completedAuctions: [],
          isActive: false,
          lastUpdate: Date.now(),
        }),
      });

    const poller = createAuctionPoller({
      pollInterval: 1000,
      maxFailures: 3,
    });

    poller.start();

    // First error - should retry after 1s (1000ms * 2^0)
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second error - should retry after 2s (1000ms * 2^1)
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Success - should reset to normal interval
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    poller.stop();
  });

  it('should stop polling when stop() is called', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        currentPlayer: null,
        recentBids: [],
        completedAuctions: [],
        isActive: false,
        lastUpdate: Date.now(),
      }),
    });

    const poller = createAuctionPoller({
      pollInterval: 1000,
    });

    poller.start();

    // First poll
    await vi.runOnlyPendingTimersAsync();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Stop polling
    poller.stop();

    // Should not poll again
    await vi.runOnlyPendingTimersAsync();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should use "since" parameter for incremental updates', async () => {
    const state: AuctionState = {
      currentPlayer: null,
      recentBids: [
        {
          playerId: '14835',
          franchise: '0009',
          amount: 2000000,
          timestamp: 1746506076,
        },
      ],
      completedAuctions: [],
      isActive: true,
      lastUpdate: Date.now(),
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => state,
    });

    const poller = createAuctionPoller({
      pollInterval: 1000,
      year: 2024,
      leagueId: '13522',
    });

    poller.start();

    // First poll - no "since" parameter
    await vi.runOnlyPendingTimersAsync();
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/\/api\/live-auction\?year=2024&L=13522$/)
    );

    // Second poll - should include "since" parameter
    await vi.runOnlyPendingTimersAsync();
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/\/api\/live-auction\?year=2024&L=13522&since=1746506076/)
    );

    poller.stop();
  });
});
