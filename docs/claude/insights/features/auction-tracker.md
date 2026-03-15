# Auction Tracker Feature — Future Implementation Guide

**Status:** Planned (not yet implemented)
**Story:** `docs/claude/stories/auction-tracker.md`
**Date:** 2026-03-15

---

## Overview

A fully custom auction tracker page at `/theleague/auction-tracker` that replaces MFL's native auction UI. Provides real-time bid monitoring, an available players board ranked by custom rankings, direct bid placement, outbid notifications, and per-team cap tracking — all in one page.

This is for TheLeague's **slow email auction** format where bids happen over hours/days (not a live draft room). The page polls MFL every 30 seconds for state changes.

---

## MFL Auction API — Confirmed Production Data (2025 Season)

### Two Endpoints, No "Active Auctions" API

There is **no dedicated endpoint for active auctions**. Active state must be derived from two sources:

**1. `transactions` endpoint (live polling target)**
```
GET https://api.myfantasyleague.com/{YEAR}/export?TYPE=transactions&L=13522&JSON=1
Auth: Public (no auth required)
```

Three auction-specific transaction types:

| Type | 2025 Count | Purpose |
|------|-----------|---------|
| `AUCTION_INIT` | 125 | Player nominated — who nominated + starting bid |
| `AUCTION_BID` | 416 | Bid placed — who bid + amount |
| `AUCTION_WON` | 122 | Auction closed — winner + final price |

All three share this exact structure (4 fields only):
```json
{
  "type": "AUCTION_BID",
  "franchise": "0010",
  "transaction": "12263|475000|",
  "timestamp": "1756748673"
}
```

The `transaction` string is always `{playerId}|{bidAmount}|`:
- Split on `|`
- Index 0 = player ID (string, e.g., `"12263"`)
- Index 1 = bid amount in **whole dollars** (string, e.g., `"475000"` = $475,000)
- Index 2 = always empty (trailing pipe)

**2. `auctionResults` endpoint (completed auctions only)**
```
GET https://api.myfantasyleague.com/{YEAR}/export?TYPE=auctionResults&L=13522&JSON=1
Auth: Public (no auth required)
```

Returns only closed/won auctions:
```json
{
  "auctionResults": {
    "auctionUnit": {
      "unit": "LEAGUE",
      "auction": [
        {
          "player": "11150",
          "franchise": "0011",
          "winningBid": "6000000",
          "timeStarted": "1742479270",
          "lastBidTime": "1742479270"
        }
      ]
    }
  }
}
```

**IMPORTANT:** The `timeToLive` field referenced in `docs/mfl-auction-api-research.md` and `docs/live-auction-integration-guide.md` does **NOT exist** in real production data. Every entry in the actual 2025 `auctionResults.json` (83+ completed auctions) has exactly 5 fields: `player`, `franchise`, `winningBid`, `timeStarted`, `lastBidTime`. No `timeToLive`, no `status`. Those earlier docs contained speculative/mock data.

### State Derivation Algorithm

To reconstruct current auction state from `transactions`:

```
1. Collect all AUCTION_WON player IDs into a Set (wonPlayerIds)
2. For each AUCTION_INIT:
   - If player ID is NOT in wonPlayerIds → player is ACTIVE (still on block)
   - If player ID IS in wonPlayerIds → auction is COMPLETE
3. For each ACTIVE player, find the most recent AUCTION_BID:
   - That bid's franchise = current high bidder
   - That bid's amount = current price
   - If no AUCTION_BID exists, the AUCTION_INIT amount = current price, INIT franchise = nominator (not necessarily high bidder — in email auctions the nominator places the opening bid)
4. Estimated expiration = last bid timestamp + draftLimitHours (12h), adjusted for draftTimerSusp (3am-7am pause)
```

### Per-Team Filtering

No dedicated per-franchise auction endpoint. Filter options:
- Server-side: `&FRANCHISE=0005` param on transactions endpoint (reduces payload)
- Client-side: filter by `franchise` field on full transaction set

### No Real-Time Push

MFL has **no WebSocket, no SSE, no push notifications**. Polling is the only mechanism.

Auction timing context from 2025 data:
- Auction durations: min 36 hours, max 263 hours, average 53 hours
- Bid timer: 12 hours (`draftLimitHours: "12:00"`)
- Timer suspended 3am-7am (`draftTimerSusp: "03 07"`)
- Polling every 30 seconds is more than sufficient for a slow email auction

### Monetary Values

All amounts are **strings in whole dollars** (not cents, not salary units):
- `"475000"` = $475,000 = $0.475M
- `"6000000"` = $6,000,000 = $6.00M
- `"45000000"` = $45,000,000 = $45.00M (full cap)
- Always `parseInt()` before math

### Timestamps

Unix epoch **seconds** as strings. Convert: `new Date(parseInt(ts) * 1000)`.

---

## League Auction Configuration

Sourced from `data/theleague/mfl-feeds/{year}/league.json`:

| Setting | Field | Value | Notes |
|---------|-------|-------|-------|
| Starting budget | `auctionStartAmount` | `"45000000"` | $45M per team |
| Salary cap | `salaryCapAmount` | `"45000000"` | Same as auction budget |
| Bid timer | `draftLimitHours` | `"12:00"` | 12 hours to respond |
| Timer suspension | `draftTimerSusp` | `"03 07"` | Paused 3am–7am |
| Auction type | `auction_kind` | `"email"` | Slow email auction |
| Draft/roster method | `loadRosters` | `"email_draft_email_auction"` | Combined draft + auction |
| Minimum bid | (observed) | `$425,000` | From AUCTION_INIT starting bids |

---

## Existing Code to Reuse

### Already Cached Data
The daily feed sync (`scripts/fetch-mfl-feeds.mjs`) already fetches and caches:
- `data/theleague/mfl-feeds/{year}/auctionResults.json` (line 284)
- `data/theleague/mfl-feeds/{year}/transactions.json` (includes AUCTION_* events)
- `data/theleague/mfl-feeds/{year}/players.json` (player names, positions, NFL teams)
- `data/theleague/mfl-feeds/{year}/rosters.json` (who is on each team's roster)
- `data/theleague/mfl-feeds/{year}/league.json` (auction config, team identities)

### Existing Auction UI
- `src/components/theleague/AuctionStrip.astro` — Compact strip linking to MFL's native auction pages (`O=52` place bid, `O=44` summary, `O=43` completed). Should be updated to also link to our custom tracker.

### Custom Rankings System (Critical Integration)
The project has a complete custom rankings system:

| File | Purpose |
|------|---------|
| `src/types/custom-rankings.ts` | Types: `CustomRankingsState` (ordered `rankings: string[]`, `tiers: TierBreak[]`) |
| `src/utils/custom-rankings-storage.ts` | `loadCustomRankings()` — loads from Vercel KV via `/api/cr`, localStorage fallback |
| `src/utils/rankings-lookup.ts` | `buildRankingLookup()` — lookup maps for imported rankings; `AVERAGE_IMPORT_ID` for average rank |
| `src/utils/rankings-storage.ts` | `getAllImports()`, `getAveragePosition()` — imported rankings from FantasyPros, ESPN, CBS, Sleeper, etc. |
| `src/components/theleague/custom-rankings/` | React components for ranking list UI (PlayerRow, TierDivider, PositionFilter, etc.) |
| `src/pages/theleague/cr.astro` | Custom Rankings page |
| `src/pages/api/cr.ts` | API route for rankings CRUD (Vercel KV) |

**Integration plan:** The Available Players Board should load the user's custom rankings and use them to rank free agents not currently up for auction. Average imported rankings serve as fallback when no custom rankings exist.

### MFL Auth & Write Operations
| File | Purpose |
|------|---------|
| `src/utils/mfl-fetch.ts` | `mflFetch()` — redirect-safe fetch that preserves cookies on cross-origin redirects. **MUST** use this for all authenticated MFL calls |
| `src/utils/mfl-login.ts` | Login flow: POST credentials → get MFL_USER_ID cookie → resolve franchise_id via `export?TYPE=myleagues` |
| `src/pages/api/trades/submit.ts` | Reference pattern for authenticated MFL write operations (POST to import endpoint with cookie forwarding) |
| `src/pages/api/auth/me.ts` | `getAuthUser(request)` — extracts authenticated user from session JWT |

### Player Display
| File | Purpose |
|------|---------|
| `src/components/theleague/PlayerCell.astro` | Server-rendered player lockup (headshot + name + pos + NFL team). Use for initial page render |
| `buildPlayerCellHTML()` | Client-side player HTML builder. Use for dynamically inserted rows during polling |
| `src/utils/team-names.ts` | `chooseTeamName()` for team name overflow prevention; `getTeamIdentityForYear()` for historical names |

### API Route Pattern
| File | Purpose |
|------|---------|
| `src/pages/api/live-scoring.ts` | Reference for MFL proxy API route: params parsing, parallel MFL fetches, `Cache-Control: no-cache`, error handling |

---

## Bid Placement — MFL Write Operation (Needs Research)

**This is the biggest unknown.** The exact MFL endpoint for placing auction bids in an email auction has not been confirmed. Research needed:

### What We Know
- MFL's "Place Bid" web UI lives at `options?O=52` and submits a form
- The MFL API docs list import endpoints including auction-related ones
- Commissioner write operations require `www49` host + both `MFL_USER_ID` and `MFL_IS_COMMISH` cookies (see `docs/claude/insights/domains/mfl-api.md`)
- Owner-level writes only need `MFL_USER_ID` cookie
- Bid placement should be an **owner-level** operation (not commissioner)

### What Needs Research
1. **Exact endpoint**: Is it `POST /import?TYPE=auctionBid`? Or `POST /import?TYPE=auction`? Or something else?
2. **Required parameters**: Player ID, bid amount — what are the exact param names?
3. **Nominating a player**: Is nomination (AUCTION_INIT) a separate endpoint from bidding?
4. **Response format**: What does MFL return on success/failure?
5. **Minimum bid rules**: Does MFL enforce a minimum increment, or just minimum starting bid?

### Research Approach
Use the `mfl-api-expert` agent to:
1. Check `https://www49.myfantasyleague.com/{YEAR}/api_info?STATE=details&L=13522` for auction import endpoints
2. Inspect MFL's `options?O=52` page to see what form it submits
3. Test with auth credentials against the test league or production

---

## Architecture Decisions

### Page Rendering: SSR (prerender = false)
- Needs auth context for "my team" filtering and bid placement
- Needs real-time data (no static build caching)
- Custom rankings are per-user (loaded client-side from Vercel KV)

### No React Hydration
- All interactivity via vanilla JS + `astro:page-load` lifecycle
- Polling with `setInterval`, DOM updates with `innerHTML` / classList
- Rankings loaded async after initial page render (not blocking)
- This keeps bundle size minimal — no React shipped to client

### Internal API Route (/api/auction)
- Proxies MFL `transactions` endpoint to avoid CORS
- Server-side filters to AUCTION_* types only (reduces client payload)
- Returns pre-structured JSON with `active`, `completed`, and `teamSummaries` sections
- `Cache-Control: no-cache, no-store, must-revalidate`

### Client-Side Polling Strategy
```
- setInterval every 30 seconds
- Page Visibility API: pause when tab hidden, resume + immediate fetch on focus
- On each poll: compare new state to previous state
  - If any player's high bidder changed, flash that row
  - If user was high bidder and is now outbid, trigger notification
- On View Transitions navigation: clear interval (prevent ghost intervals)
  - Use astro:before-swap or astro:page-load cleanup pattern
```

### Available Players Board — Data Flow
```
Build time:
  1. import.meta.glob loads players.json → all player data
  2. import.meta.glob loads rosters.json → rostered player IDs
  3. Serialize both as <script type="application/json"> tags

Client runtime:
  1. Parse serialized player + roster data
  2. loadCustomRankings() → user's ordered player IDs (or null)
  3. buildRankingLookup() → average rankings as fallback
  4. On each poll:
     a. Get active auction player IDs from auction state
     b. Available = allPlayers - rosteredPlayers - activeAuctionPlayers
     c. Sort available by custom rank (or average rank)
     d. In combined view: interleave active auction players at their rank position
```

### Split View vs Combined View
- **Split View** (default): Two-panel layout. Left 60% = Active Auctions table. Right 40% = Available Players ranked board.
- **Combined View**: Single merged list ranking ALL players by selected ranking source. Active auction players have inline bid info (current bid, high bidder, time remaining). Available players show ranking position only.
- Toggle stored in `localStorage` for persistence across sessions.
- Mobile: Split view collapses to tabbed navigation (Auctions | Available | My Activity).

---

## Notification System

### Outbid Detection
On each 30s poll:
1. Track which player IDs the user is currently high bidder on (from previous state)
2. Compare with new state — if any of those players now have a different high bidder, user was outbid
3. Trigger notification for each outbid event

### Notification UI
- Fixed banner below metrics strip (not blocking table content)
- Red/error accent left-border (outbid is urgent — this follows the editorial pattern from `docs/claude/insights/domains/design-system.md` "Negative/Warning State Pattern")
- Content: "You've been outbid on [Player Name] — [Team Name] bid $X.XXM"
- Dismiss button (X) on right
- Does NOT auto-fade — persists until user dismisses (outbid is actionable)
- Multiple outbid events stack vertically

### Optional Sound
- Toggle stored in `localStorage` (key: `auction-notification-sound`)
- Short, non-intrusive notification sound
- Respects browser autoplay policies (only after user interaction)

---

## Key Metrics Strip

4-column grid (2x2 on mobile) showing per-team auction stats:

| Metric | Calculation | Format |
|--------|-------------|--------|
| **Budget Remaining** | `auctionStartAmount` - sum of all AUCTION_WON amounts for team - existing roster salary commitments | `$XX.XXM` |
| **Players Won** | Count of AUCTION_WON where `franchise === myTeam` | Integer |
| **Active Bids** | Count of active auctions where user's team placed the most recent bid | Integer |
| **Total Spent** | Sum of AUCTION_WON amounts for team | `$XX.XXM` |

When viewing another team (team selector), these metrics update to show that team's numbers.

---

## Status Badges

| Badge | Token/Color | When Shown |
|-------|-------------|------------|
| **Active** | Green pill (`--cat-free-agency`, `#2e8743`) | Player is in an active auction |
| **Won** | Primary pill (`--color-primary`, `#1c497c`) | Player's auction is closed, winner determined |
| **Outbid** | Error pill (`--color-error`, `#dc2626`) | User placed a bid but is no longer high bidder |
| **High Bidder** | Green text accent | User is the current high bidder |
| **Higher on Board** | Amber/warning pill (`--color-warning`, `#f59e0b`) | Available player ranked higher than active auction players on user's board |
| **On Block** | Gray pill (`--color-gray-500`) | In Combined View: marks a player currently in an active auction |

---

## Files That Don't Exist Yet (Referenced in Earlier Docs)

The integration guide at `docs/live-auction-integration-guide.md` references several files that were **planned but never implemented**:
- `src/utils/live-auction-poller.ts` — does NOT exist
- `src/utils/auction-notifications.ts` — does NOT exist
- `src/utils/live-auction-activity-detector.ts` — does NOT exist
- `src/utils/live-mode-manager.ts` — does NOT exist
- `src/pages/api/live-auction.ts` — does NOT exist
- `LiveModeToggle.astro`, `LiveAuctionPanel.astro`, `AuctionNotificationSettings.astro` — do NOT exist

These were a different (more complex) design. The current story takes a simpler approach: one page, vanilla JS polling, no "live mode" toggle. Do NOT reference those non-existent files.

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/pages/theleague/auction-tracker.astro` | Main page — SSR, auth-aware, serializes player/roster data, tab/view switching, polling script |
| `src/pages/api/auction.ts` | Read API — proxies MFL transactions, filters to AUCTION_* types, returns structured JSON |
| `src/pages/api/auction-bid.ts` | Write API — places bid via MFL import endpoint (exact endpoint TBD — needs research) |
| `src/utils/auction-utils.ts` | Pure functions: `deriveAuctionState()`, `parseAuctionTransaction()`, `formatBidAmount()`, `getTeamAuctionSummary()`, `getAvailablePlayers()`, `mergeRankingsWithAuctions()`, `calculateBudgetRemaining()` |

## Files to Modify

| File | Change |
|------|--------|
| `src/config/nav-config.json` | Add `"auction-tracker"` link with `icon: "gavel"` |
| `src/components/theleague/AuctionStrip.astro` | Add internal link to `/theleague/auction-tracker` alongside existing MFL external links |

---

## Testing with Real Data

### 2025 Historical Data (Available Now)
- `data/theleague/mfl-feeds/2025/auctionResults.json` — 83+ completed auctions
- `data/theleague/mfl-feeds/2025/transactions.json` — 663 auction events (125 INIT, 416 BID, 122 WON)
- Use this data for development and testing: load the transactions, derive state, verify the algorithm produces correct active/completed/per-team breakdowns

### 2026 Data
- `data/theleague/mfl-feeds/2026/auctionResults.json` — currently empty (auction not started)
- The page must handle the empty state gracefully
- When the 2026 auction begins, the polling will start picking up events

### Verifying State Derivation
Cross-check: the number of AUCTION_INIT events minus AUCTION_WON events should equal the number of active auctions at any point. In the complete 2025 data: 125 INIT - 122 WON = 3 auctions that were initiated but never completed (edge case to handle — possibly cancelled or timed out).

---

## Edge Cases to Handle

1. **Auction not started**: No AUCTION_* events in transactions → show "Auction has not started yet"
2. **All auctions complete**: All INIT players have matching WON → show "All auctions complete" with results table
3. **INIT without WON and no bids**: Player nominated but nobody bid yet (or only the nominator's opening bid) — show starting bid as current price
4. **Multiple bids on same player in same poll**: Sort by timestamp to find the truly latest bid
5. **User not authenticated**: Show auction data read-only, hide bid buttons and "My Activity" tab
6. **User has no custom rankings**: Fall back to average imported rankings; if no imports either, show players in alphabetical or MFL default order
7. **Timer suspension calculation**: Estimated expiration must account for 3am-7am suspension window (4 hours added if timer crosses that window)
8. **MFL API down**: Show last known state with "Last updated X minutes ago" warning + retry button
9. **View Transitions cleanup**: Clear polling interval on `astro:before-swap` to prevent ghost intervals accumulating
10. **Large transaction set**: 2025 had 663 auction events. Future years could have more. The `/api/auction` route should do the filtering and state derivation server-side, sending only the derived state to the client (not raw transactions).
