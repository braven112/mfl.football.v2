# Story: Custom Auction Tracker

## User Story
As a league member, I want a real-time auction tracker page on our site so that I can monitor all bidding activity, track my team's bids, and check other teams' spending — without navigating to MFL's clunky interface.

## Acceptance Criteria
- [ ] Page displays all players currently up for bid with: player lockup, current bid amount, high bidder team, time on block, and estimated expiration
- [ ] Page displays completed auctions with: player, winning team, winning bid amount
- [ ] "My Team" filter highlights or isolates the authenticated user's auction activity (bids placed, nominations, wins)
- [ ] Team selector allows viewing any team's bidding activity and total spending
- [ ] Key metrics strip shows: total auction spending, remaining budget, players won, active bids
- [ ] Page auto-polls MFL `transactions` API every 30 seconds for new auction events (AUCTION_INIT, AUCTION_BID, AUCTION_WON)
- [ ] New bid activity triggers a visual update indicator (subtle flash/highlight on changed rows)
- [ ] Auction state is derived correctly: active = AUCTION_INIT without matching AUCTION_WON; current bid = latest AUCTION_BID for that player
- [ ] Bid amounts display in salary format ($X.XXM or $XXXk)
- [ ] Timestamps display as relative time ("2h ago", "1d ago") with full date on hover
- [ ] Empty state when no auction is active ("Auction has not started yet" or "All auctions complete")
- [ ] Loading state with skeleton/shimmer while first fetch completes
- [ ] Error state if MFL API is unreachable, with retry button
- [ ] Mobile responsive: card layout on small screens, table on desktop
- [ ] `pnpm test` passes
- [ ] `pnpm build` succeeds

## Technical Context

### Files to Create
- `src/pages/theleague/auction-tracker.astro` — Main auction tracker page (SSR, needs auth for "my team" context)
- `src/pages/api/auction.ts` — Internal API route that proxies MFL `transactions` endpoint, filters to AUCTION_* types, and returns structured JSON
- `src/utils/auction-utils.ts` — Pure functions: deriveAuctionState(), parseAuctionTransaction(), formatBidAmount(), getTeamAuctionSummary()

### Files to Modify
- `src/config/nav-config.json` — Add "Auction Tracker" link to appropriate section (icon: `gavel`)
- `src/components/theleague/AuctionStrip.astro` — Add link to our auction tracker page alongside existing MFL links

### Data Sources
- **MFL `transactions` API** (live, via polling): `GET /export?TYPE=transactions&L=13522&JSON=1` — contains AUCTION_INIT, AUCTION_BID, AUCTION_WON events
- **MFL `auctionResults` API** (cached daily): `GET /export?TYPE=auctionResults&L=13522&JSON=1` — completed auctions with final prices
- **Cached player data**: `data/theleague/mfl-feeds/{year}/players.json` — player names, positions, NFL teams for display
- **League config**: `src/data/theleague.config.json` — team names, icons, auction budget (`auctionStartAmount: 45000000`)
- **League feed**: `data/theleague/mfl-feeds/{year}/league.json` — `draftLimitHours: "12:00"`, `draftTimerSusp: "03 07"`, `auction_kind: "email"`
- **Year utility**: `getCurrentLeagueYear()` for auction year context

### Transaction Data Format (confirmed from 2025 production data)
```json
// AUCTION_INIT — player nominated
{ "type": "AUCTION_INIT", "franchise": "0006", "transaction": "12263|425000|", "timestamp": "1756748673" }

// AUCTION_BID — bid placed
{ "type": "AUCTION_BID", "franchise": "0010", "transaction": "12263|475000|", "timestamp": "1756748700" }

// AUCTION_WON — auction closed
{ "type": "AUCTION_WON", "franchise": "0010", "transaction": "12263|475000|", "timestamp": "1756800000" }
```
Transaction string: `{playerId}|{bidAmount}|` — always split on `|`, index 0 = player ID, index 1 = bid amount in dollars.

### Auction Results Data Format (confirmed from 2025 production data)
```json
{
  "player": "11150",
  "franchise": "0011",
  "winningBid": "6000000",
  "timeStarted": "1742479270",
  "lastBidTime": "1742479270"
}
```
Note: No `timeToLive` or `status` fields exist in real data (earlier docs were incorrect).

### League Auction Config
- Starting budget per team: $45,000,000 (`auctionStartAmount`)
- Bid timer: 12 hours (`draftLimitHours: "12:00"`)
- Timer suspended: 3am–7am (`draftTimerSusp: "03 07"`)
- Auction kind: email (`auction_kind: "email"`)
- Minimum bid: $425,000 (observed from AUCTION_INIT starting bids)

### Existing Patterns to Reuse
- `src/components/theleague/PlayerCell.astro` — Player display lockup (headshot + name + position + NFL team)
- `src/utils/team-names.ts` → `chooseTeamName()` — Team name overflow prevention
- `src/pages/api/live-scoring.ts` — Pattern for internal API route that proxies MFL with no-cache headers
- `src/components/theleague/AuctionStrip.astro` — Existing auction UI strip (link to it / from it)
- `src/utils/salary-calculations.ts` — Cap/salary formatting patterns
- `src/utils/league-year.ts` → `getCurrentLeagueYear()` — Year resolution

### Key Architectural Decisions
1. **SSR page** (not prerendered) — needs auth context for "my team" filtering, and real-time data
2. **Internal API route** (`/api/auction`) — proxy MFL transactions to avoid CORS and allow server-side filtering of AUCTION_* types only
3. **Client-side polling** — `setInterval` every 30s calling `/api/auction`, updating DOM. NOT React — use vanilla JS with `astro:page-load` lifecycle
4. **State derivation** — No MFL endpoint gives "active auctions." Must compute: collect all AUCTION_WON player IDs, then find AUCTION_INIT records whose player IDs don't appear in WON set. Latest AUCTION_BID per active player = current high bid.
5. **Build-time player data** — Player names/positions loaded via `import.meta.glob` at build time and serialized to a `<script>` tag as a lookup map. Only auction data is fetched live.

## Design Requirements

### Layout
- **Desktop:** Hero metrics strip (4 cards: Budget Remaining, Players Won, Active Bids, Total Spent) → Toolbar (section title + team filter dropdown + auto-refresh indicator) → Tab bar (Active Auctions | Completed | My Activity) → Data table with sticky headers
- **Mobile (≤640px):** Metrics in 2x2 grid → Stacked cards instead of table rows → Tab bar scrolls horizontally

### Editorial Patterns
- [x] Section titles (uppercase + left-border accent)
- [x] Key metrics strip (4-column grid, gray-50 bg cards)
- [x] Data table (sticky headers, hover rows, tabular-nums)
- [x] Player lockup (PlayerCell.astro or buildPlayerCellHTML for client-rendered rows)
- [x] Team name display (chooseTeamName)
- [x] Pill/badge pattern (for bid status: "Active", "Won", "Outbid")
- [x] Detail rows for mobile card layout

### Status Badges
| Status | Style | Condition |
|--------|-------|-----------|
| **Active** | green pill (`--cat-free-agency`) | Player has INIT but no WON |
| **Won** | primary pill (`--color-primary`) | AUCTION_WON exists |
| **Outbid** | gray pill (`--color-gray-500`) | Team's bid is not the latest for an active auction |
| **High Bidder** | green text accent | Team holds the current highest bid |

### Rendering Strategy
- [x] SSR (`prerender = false`) — needs auth context and fresh data
- [x] No React hydration — vanilla JS polling + DOM updates via `astro:page-load`
- [x] Player lookup map serialized in `<script type="application/json">` tag at build time

## Agent Sequence

### Phase 1: Design
- **frontend-ux-architect** — Design component structure, token usage, a11y, responsive, tab switching pattern

### Phase 2: Implement
- **main session** — Build from approved design spec

### Phase 3: QA
- **qa-investigator** — Trace: page load → frontmatter data loading → API route → MFL transactions fetch → client polling → DOM update
- **qa-api-debugger** — Test `/api/auction` endpoint: response format, AUCTION_* filtering, error handling

### Phase 4: Review
- **code-reviewer** — Tokens, DRY, guidelines compliance
- **astro-performance-expert** — SSR strategy, inline script size, player data serialization approach
- **frontend-ux-architect** — A11y audit (live region for bid updates, keyboard nav for tabs, screen reader for status changes)

## Prompt Context Per Agent

### frontend-ux-architect (Phase 1)
- Read: `docs/claude/insights/domains/design-system.md` (editorial patterns, metrics strip, table styling, toolbar pattern)
- Read: `src/components/theleague/AuctionStrip.astro` (existing auction UI for visual consistency)
- Read: `src/pages/theleague/players.astro` lines 1-150 (reference for toolbar + table page structure)
- Reference: `src/pages/theleague/standings.astro` (tab switching pattern with view selectors)
- Focus: Real-time update UX (how to visually indicate new/changed bids without jarring the user), mobile card layout for auction items, team filter interaction

### qa-investigator (Phase 3)
- Trace: `auction-tracker.astro` (page load, frontmatter) → `/api/auction` (API route) → MFL transactions endpoint → client `<script>` (polling, DOM updates)
- Key files: `src/pages/theleague/auction-tracker.astro`, `src/pages/api/auction.ts`, `src/utils/auction-utils.ts`
- Verify: Auction state derivation logic (INIT without WON = active), bid amount parsing, team filtering

### qa-api-debugger (Phase 3)
- Test: `GET /api/auction` — verify it returns structured auction data with active/completed separation
- Test: `GET /api/auction?franchise=0001` — verify team filtering works
- Test: Error handling when MFL is unreachable

### astro-performance-expert (Phase 4)
- Check: SSR is necessary (auth + real-time), no React hydration used
- Verify: Player data serialization size (should only include players referenced in auction, not all 15k+ players)
- Verify: Polling interval cleanup on View Transitions navigation (no ghost intervals)

## Done Definition
- [ ] All acceptance criteria met
- [ ] pnpm test passes
- [ ] pnpm build succeeds
- [ ] No Critical review findings remain
- [ ] Insights documented in `docs/claude/insights/`
- [ ] What's New entry added (new page)
