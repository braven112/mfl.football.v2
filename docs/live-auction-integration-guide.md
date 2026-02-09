# Live Auction System - Integration Guide

**Date:** 2026-01-04
**Status:** ✅ Complete and Ready for Integration
**Target Page:** `/theleague/auction-predictor.astro`

---

## Overview

The Live Auction System provides real-time tracking of the March 15-21, 2026 auction with:
- Toggleable Live Mode (separate from Planning Mode)
- Real-time bid notifications
- UI highlights for current player, recent bids, and sold players
- Price comparison dashboard (predicted vs actual)
- Activity feed showing recent auction events

---

## Integration Steps

### Step 1: Import Components

Add to `src/pages/theleague/auction-predictor.astro`:

```astro
---
import LiveModeToggle from '@/components/theleague/LiveModeToggle.astro';
import LiveAuctionPanel from '@/components/theleague/LiveAuctionPanel.astro';
import AuctionNotificationSettings from '@/components/theleague/AuctionNotificationSettings.astro';
---
```

### Step 2: Add Components to Page

Place in the page layout (before or after AuctionControlPanel):

```astro
<!-- Mode Toggle Button -->
<LiveModeToggle />

<!-- Notification Settings (optional - can be in a collapsible panel) -->
<AuctionNotificationSettings />

<!-- Planning Mode Container (wrap existing content) -->
<div id="planningContainer">
  <AuctionControlPanel />
  <AuctionPlayerTable />
  <BudgetPlannerPanel />
  <MarketAnalysisDashboard />
</div>

<!-- Live Auction Panel (hidden by default) -->
<LiveAuctionPanel />
```

### Step 3: Initialize JavaScript

Add to `<script>` section at bottom of page:

```typescript
import { createActivityDetector } from '@/utils/live-auction-activity-detector';
import { createLiveModeManager } from '@/utils/live-mode-manager';
import type { PlayerLookup, TeamLookup } from '@/utils/live-auction-activity-detector';

// Build player lookup from your data
const playerLookup: PlayerLookup = {};
for (const player of allPlayers) {
  playerLookup[player.id] = {
    name: player.name,
    position: player.position,
  };
}

// Build team lookup from your data
const teamLookup: TeamLookup = {};
for (const team of teams) {
  teamLookup[team.franchiseId] = {
    name: team.name,
    abbrev: team.abbrev,
  };
}

// Build predicted prices from your calculations
const predictedPrices: { [playerId: string]: number } = {};
for (const player of freeAgents) {
  if (player.estimatedAuctionPrice) {
    predictedPrices[player.id] = player.estimatedAuctionPrice;
  }
}

// Initialize Live Mode Manager
const liveModeManager = createLiveModeManager({
  playerLookup,
  teamLookup,
  predictedPrices,
});

liveModeManager.initialize('planningContainer', 'liveAuctionPanel');

// Initialize Activity Detector
const activityDetector = createActivityDetector({
  year: 2026,
  leagueId: '13522',
  pollInterval: 15000, // 15 seconds
  playerLookup,
  teamLookup,
  predictedPrices,
  onStateChange: (state) => {
    // Update Live Panel when auction state changes
    liveModeManager.updateLivePanel(state);

    // Optional: Update player table highlights in planning mode
    updatePlayerTableHighlights();
  },
});

// Listen for mode changes
window.addEventListener('auction-mode-changed', (e: Event) => {
  const customEvent = e as CustomEvent;
  const mode = customEvent.detail.mode;

  if (mode === 'live') {
    // Switched to Live Mode
    activityDetector.start();
    console.log('Live auction tracking started');
  } else {
    // Switched to Planning Mode
    activityDetector.stop();
    console.log('Live auction tracking stopped');
  }
});

// Add target players from budget planner
function syncTargetPlayers(budgetPlayers: string[]) {
  // Clear existing targets
  const currentTargets = activityDetector.getHighlightManager().getTargetPlayers();
  for (const playerId of currentTargets) {
    activityDetector.removeTargetPlayer(playerId);
  }

  // Add new targets
  for (const playerId of budgetPlayers) {
    activityDetector.addTargetPlayer(playerId);
  }
}

// Update player table highlights (in planning mode)
function updatePlayerTableHighlights() {
  const highlightManager = activityDetector.getHighlightManager();
  const allHighlights = highlightManager.getAllHighlights();

  // Apply CSS classes to player rows
  document.querySelectorAll('.player-row').forEach((row) => {
    const playerId = row.getAttribute('data-player-id');
    if (!playerId) return;

    const highlightClass = highlightManager.getHighlightClass(playerId);

    // Remove all highlight classes
    row.classList.remove(
      'player-row-current-auction',
      'player-row-recent-bid',
      'player-row-sold',
      'player-row-target'
    );

    // Add new highlight class
    if (highlightClass) {
      row.classList.add(highlightClass);
    }
  });
}

// Listen for highlight changes
window.addEventListener('auction-state-changed', () => {
  updatePlayerTableHighlights();
});

// Listen for test notification request
window.addEventListener('test-notification', () => {
  const notificationManager = activityDetector.getNotificationManager();
  notificationManager.notifyPlayerNominated('Test Player (RB)', 425000);
});

// Manual refresh button
const refreshButton = document.getElementById('refreshButton');
refreshButton?.addEventListener('click', async () => {
  await activityDetector.refresh();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  activityDetector.destroy();
});
```

---

## Data Requirements

### Player Lookup

```typescript
interface PlayerLookup {
  [playerId: string]: {
    name: string;      // "Saquon Barkley"
    position: string;  // "RB"
  };
}
```

**Source:** MFL `players.json` feed or your existing player data

### Team Lookup

```typescript
interface TeamLookup {
  [franchiseId: string]: {
    name: string;    // "Fire Ready Arm"
    abbrev: string;  // "FRA"
  };
}
```

**Source:** MFL `league.json` → `franchises.franchise` array

### Predicted Prices (Optional)

```typescript
interface PredictedPrices {
  [playerId: string]: number;  // Amount in dollars (e.g., 7500000 = $7.5M)
}
```

**Source:** Your `calculateAuctionPrice()` results for each free agent

---

## Player Table Integration

Add `data-player-id` attribute to player rows for highlighting:

```astro
{allPlayers.map(player => (
  <tr class="player-row" data-player-id={player.id}>
    <td>{player.name}</td>
    <td>{player.position}</td>
    <td>{formatCurrency(player.estimatedAuctionPrice)}</td>
  </tr>
))}
```

The highlight system will automatically apply CSS classes:
- `.player-row-current-auction` - Player currently on auction block (yellow gradient)
- `.player-row-recent-bid` - Recently bid player (blue, 30s duration)
- `.player-row-sold` - Recently sold player (gray, 2min duration, strikethrough)
- `.player-row-target` - User's target player from budget planner (red)

---

## Budget Planner Integration

Sync target players when budget planner changes:

```typescript
// When user adds player to budget planner
function addToBudgetPlanner(playerId: string) {
  budgetPlayers.push(playerId);
  activityDetector.addTargetPlayer(playerId);
  saveBudgetPlanner();
}

// When user removes player from budget planner
function removeFromBudgetPlanner(playerId: string) {
  budgetPlayers = budgetPlayers.filter(id => id !== playerId);
  activityDetector.removeTargetPlayer(playerId);
  saveBudgetPlanner();
}

// On page load
function loadBudgetPlanner() {
  const saved = localStorage.getItem('budgetPlanner');
  if (saved) {
    const budgetPlayers = JSON.parse(saved);
    syncTargetPlayers(budgetPlayers);
  }
}
```

---

## API Endpoints

The system uses the following API route (already created):

**`/api/live-auction`**
- **Method:** GET
- **Parameters:**
  - `year` (optional): Auction year (default: current year)
  - `L` (optional): League ID (default: 13522)
  - `since` (optional): Unix timestamp to get incremental updates
- **Response:**
```json
{
  "currentPlayer": {
    "playerId": "14835",
    "startingBid": 425000,
    "currentBid": 7500000,
    "currentBidder": "0009",
    "timeStarted": 1746378800,
    "lastBidTime": 1746506076
  },
  "recentBids": [
    {
      "playerId": "14835",
      "franchise": "0009",
      "amount": 7500000,
      "timestamp": 1746506076
    }
  ],
  "completedAuctions": [
    {
      "playerId": "13130",
      "franchise": "0005",
      "winningBid": 6000000,
      "timestamp": 1746500000
    }
  ],
  "isActive": true,
  "lastUpdate": 1735938000000
}
```

---

## Testing

### Manual Testing Checklist

**Before Auction (Now - March 14):**
- [ ] Toggle between Planning and Live modes
- [ ] Verify mode persists on page reload
- [ ] Test notification settings panel
- [ ] Test "Test Notification" button
- [ ] Verify player table highlights work
- [ ] Test adding/removing target players
- [ ] Test with 2024 historical data

**During Auction (March 15-21):**
- [ ] Verify polling starts when entering Live Mode
- [ ] Verify current player display updates
- [ ] Verify activity feed populates
- [ ] Verify price comparison dashboard updates
- [ ] Verify notifications appear for target players
- [ ] Verify sound alerts (if enabled)
- [ ] Test manual refresh button
- [ ] Monitor browser performance (should be smooth)

### Test with Historical Data

Use 2024 auction data for testing:

```typescript
// Change year to 2024 for testing
const activityDetector = createActivityDetector({
  year: 2024, // Use historical data
  leagueId: '13522',
  // ... rest of config
});
```

This will poll 2024 `transactions` data and simulate the UI updates.

---

## Performance Considerations

### Polling Frequency
- **Active Auction:** 15 seconds (default)
- **Inactive:** Can increase to 30-60 seconds
- **Automatic Stop:** Circuit breaker stops after 3 consecutive failures

### Memory Usage
- Activity feed: Limited to last 50 items
- Completed auctions: Limited to last 100 items
- Highlight cleanup: Auto-expires old highlights every 5 seconds

### Caching
- API responses cached for 10 seconds (active) or 60 seconds (inactive)
- Toast notifications rate-limited to max 12 per minute
- Incremental updates using `since` parameter reduce data transfer

---

## User Preferences

All preferences stored in localStorage under `auction_notification_preferences`:

```typescript
interface NotificationPreferences {
  enabled: boolean;                   // Master switch
  soundEnabled: boolean;              // Play beep sound
  notifyAllBids: boolean;            // All bids vs target players only
  notifyCompletions: boolean;        // Notify when auctions complete
  alertThreshold: number;            // Minimum bid amount (dollars)
  maxNotificationsPerMinute: number; // Rate limiting (default: 12)
}
```

Users can customize via AuctionNotificationSettings component.

---

## Troubleshooting

### Issue: No updates in Live Mode
**Solution:** Check browser console for polling errors. Verify MFL API is accessible.

### Issue: Notifications not appearing
**Solution:** Check notification preferences. Verify `enabled: true` in localStorage.

### Issue: Highlights not showing
**Solution:** Verify `data-player-id` attribute exists on player rows. Check highlight manager state.

### Issue: Performance degradation
**Solution:** Check number of players in table. Consider virtual scrolling if >300 players. Verify polling hasn't increased frequency accidentally.

### Issue: Mode doesn't persist
**Solution:** Check localStorage is enabled. Verify `auctionMode` key exists in localStorage.

---

## Production Checklist

Before March 15, 2026:

- [ ] **Verify MFL API access** - Test `transactions` endpoint
- [ ] **Configure environment variables** - `MFL_LEAGUE_ID=13522`, `MFL_YEAR=2026`
- [ ] **Test notification sounds** - Verify Web Audio API works in all browsers
- [ ] **Mobile testing** - Test on iOS Safari and Chrome Android
- [ ] **Performance profiling** - Verify <100MB memory, 60 FPS scrolling
- [ ] **Error handling** - Test with API failures, network errors
- [ ] **User documentation** - Create help section explaining Live Mode

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                   Auction Predictor Page                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  [LiveModeToggle]  ← User clicks to switch modes            │
│         ↓                                                    │
│  ┌──────────────┐              ┌──────────────────┐        │
│  │ Planning Mode│              │   Live Mode      │        │
│  ├──────────────┤              ├──────────────────┤        │
│  │ Player Table │              │ Current Player   │        │
│  │ Budget Plan  │              │ Activity Feed    │        │
│  │ Market Dash  │              │ Price Comparison │        │
│  └──────────────┘              └──────────────────┘        │
│         ↑                              ↑                    │
│         │                              │                    │
│         └──────────────┬───────────────┘                    │
│                        │                                     │
│              [LiveModeManager]                              │
│                        ↓                                     │
│           [ActivityDetector] ← Orchestrates all systems     │
│                   ↓    ↓    ↓                               │
│            ┌──────┴────┴────┴──────┐                        │
│            │                        │                        │
│      [LivePoller]         [NotificationManager]            │
│            │                        │                        │
│     Polls MFL API          Shows toasts                     │
│     every 15s              + sounds                         │
│            │                                                 │
│            ↓                                                 │
│      [HighlightManager]                                     │
│            │                                                 │
│     Updates CSS classes                                     │
│     on player rows                                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Files Created

### Components
- `src/components/theleague/LiveModeToggle.astro` - Mode toggle button
- `src/components/theleague/LiveAuctionPanel.astro` - Live mode UI
- `src/components/theleague/AuctionNotificationSettings.astro` - Preferences panel

### Utilities
- `src/utils/live-auction-poller.ts` - MFL API polling engine
- `src/utils/auction-notifications.ts` - Toast + sound system
- `src/utils/auction-ui-highlights.ts` - Player row highlights
- `src/utils/live-auction-activity-detector.ts` - Orchestration layer
- `src/utils/live-mode-manager.ts` - Mode switching + UI updates

### API Routes
- `src/pages/api/live-auction.ts` - Auction state endpoint

### Tests
- `tests/live-auction-integration.test.ts` - Integration tests (21 tests ✅)

### Documentation
- `docs/mfl-auction-api-research.md` - API research findings
- `docs/live-auction-integration-guide.md` - This guide

---

## Next Steps

1. **Integrate into auction-predictor.astro** following steps above
2. **Test with 2024 data** to verify all functionality
3. **Deploy to staging** for user acceptance testing
4. **Monitor performance** during March 15-21 auction
5. **Collect feedback** and iterate post-auction

---

## Support

For issues or questions:
- Review this integration guide
- Check browser console for errors
- Verify MFL API connectivity
- Test with 2024 historical data first
- Review individual component documentation

**Status:** ✅ Ready for production integration
