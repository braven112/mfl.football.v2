# Story: Custom Auction Tracker

## User Story
As a league member, I want a real-time auction tracker page on our site so that I can monitor all bidding activity, see top available players I should bid on next, place bids directly, track my team's bids, and check other teams' spending — without navigating to MFL's clunky interface.

## Acceptance Criteria

### Core Auction Tracking
- [ ] Page displays all players currently up for bid with: player lockup, current bid amount, high bidder team, time on block, and estimated expiration
- [ ] Page displays completed auctions with: player, winning team, winning bid amount
- [ ] Auction state is derived correctly: active = AUCTION_INIT without matching AUCTION_WON; current bid = latest AUCTION_BID for that player
- [ ] Bid amounts display in salary format ($X.XXM or $XXXk)
- [ ] Timestamps display as relative time ("2h ago", "1d ago") with full date on hover

### Available Players Board (NEW — Critical Feature)
- [ ] "Available Players" panel shows top free agents NOT currently up for bid, grouped/filterable by position (QB, RB, WR, TE, DEF)
- [ ] Players are ranked by the user's **custom rankings** (from the existing Custom Rankings system stored in Vercel KV) OR by **average imported ranking** as fallback
- [ ] Ranking source toggle: user can switch between "My Rankings" and "Average Rankings"
- [ ] **Split View**: Side-by-side panels — Active Auctions on left, Available Players board on right — so the owner can see both simultaneously
- [ ] **Combined View**: Single merged list ranking ALL players (active auction + available) by the selected ranking source, with active auction players visually tagged so the owner can see their full board with auction context
- [ ] Available players that are higher-ranked than any active auction player are visually highlighted (e.g., "Higher on your board" indicator) — this prevents distraction by active auctions when better players are still available
- [ ] Available = not on any roster AND not currently up for auction (derived from rosters.json + auction state)

### Bid Placement (Write Operation)
- [ ] Authenticated owners can place bids directly from the page (MFL write operation)
- [ ] Bid form pre-fills minimum bid (current bid + increment or starting bid for nominations)
- [ ] Bid confirmation step before submitting to MFL
- [ ] After successful bid, auction state refreshes immediately
- [ ] Bid placement uses existing MFL auth flow (MFL_USER_ID cookie from session)

### Team Tracking & Cap
- [ ] "My Team" filter highlights or isolates the authenticated user's auction activity (bids placed, nominations, wins)
- [ ] Team selector allows viewing any team's bidding activity and total spending
- [ ] Key metrics strip shows: Budget Remaining, Players Won, Active Bids, Total Spent — following MFL's salary cap ($45M `auctionStartAmount`)
- [ ] Per-team cap tracking: sum of AUCTION_WON amounts + existing roster salary = spent; auctionStartAmount - spent = remaining

### Notifications
- [ ] When a player the user is high bidder on receives a new bid (user is outbid), show a visual notification banner
- [ ] When the user is no longer the high bidder, the notification clearly states which player and the new bid amount
- [ ] Notification persists until dismissed (not auto-fade for outbid alerts)
- [ ] Notification sound (optional, toggleable) for outbid alerts

### Real-Time Polling
- [ ] Page auto-polls MFL `transactions` API every 30 seconds for new auction events
- [ ] New bid activity triggers a visual update indicator (subtle flash/highlight on changed rows)
- [ ] Auto-refresh indicator shows countdown to next poll and last updated timestamp
- [ ] Polling pauses when browser tab is hidden (Page Visibility API), resumes on focus

### States & Responsive
- [ ] Empty state when no auction is active ("Auction has not started yet" or "All auctions complete")
- [ ] Loading state with skeleton/shimmer while first fetch completes
- [ ] Error state if MFL API is unreachable, with retry button
- [ ] Mobile responsive: card layout on small screens, table on desktop; split view collapses to tabbed on mobile
- [ ] `pnpm test` passes
- [ ] `pnpm build` succeeds

## Technical Context

### Files to Create
- `src/pages/theleague/auction-tracker.astro` — Main auction tracker page (SSR, needs auth for "my team" + custom rankings)
- `src/pages/api/auction.ts` — Internal API route: proxies MFL `transactions` endpoint, filters to AUCTION_* types, returns structured JSON
- `src/pages/api/auction-bid.ts` — Internal API route: write operation to place a bid via MFL import endpoint
- `src/utils/auction-utils.ts` — Pure functions: deriveAuctionState(), parseAuctionTransaction(), formatBidAmount(), getTeamAuctionSummary(), getAvailablePlayers(), mergeRankingsWithAuctions()

### Files to Modify
- `src/config/nav-config.json` — Add "Auction Tracker" link to appropriate section (icon: `gavel`)
- `src/components/theleague/AuctionStrip.astro` — Add link to our auction tracker page alongside existing MFL links

### Data Sources
- **MFL `transactions` API** (live, via polling): `GET /export?TYPE=transactions&L=13522&JSON=1` — contains AUCTION_INIT, AUCTION_BID, AUCTION_WON events
- **MFL `auctionResults` API** (cached daily): `GET /export?TYPE=auctionResults&L=13522&JSON=1` — completed auctions with final prices
- **Cached player data**: `data/theleague/mfl-feeds/{year}/players.json` — player names, positions, NFL teams for display
- **Cached rosters**: `data/theleague/mfl-feeds/{year}/rosters.json` — which players are on rosters (to derive free agents)
- **Custom rankings**: Vercel KV via `/api/cr` endpoint — user's personalized player rankings (ordered player IDs + tiers)
- **Imported rankings**: `localStorage` via `rankings-storage.ts` → `getAllImports()`, `getAveragePosition()` — average rank across imported sources
- **League config**: `src/data/theleague.config.json` — team names, icons, auction budget
- **League feed**: `data/theleague/mfl-feeds/{year}/league.json` — `draftLimitHours: "12:00"`, `draftTimerSusp: "03 07"`, `auction_kind: "email"`, `auctionStartAmount: "45000000"`, `salaryCapAmount: "45000000"`
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
- Salary cap: $45,000,000 (`salaryCapAmount`)
- Bid timer: 12 hours (`draftLimitHours: "12:00"`)
- Timer suspended: 3am–7am (`draftTimerSusp: "03 07"`)
- Auction kind: email (`auction_kind: "email"`)
- Minimum bid: $425,000 (observed from AUCTION_INIT starting bids)

### Bid Placement — MFL Write Operation
Based on MFL API research, placing a bid likely uses one of:
- `POST /import?TYPE=auctionBid` (needs auth testing to confirm exact endpoint and params)
- The MFL "Place Bid" UI at `options?O=52` submits a form — we need to reverse-engineer the POST params
- Auth: requires `MFL_USER_ID` cookie (owner-level, from session)
- **IMPORTANT**: Must use `mflFetch()` from `src/utils/mfl-fetch.ts` to handle redirect cookie stripping (see MFL API insights)
- **Research needed during implementation**: Exact endpoint, required parameters, response format for bid placement

### Custom Rankings Integration
The existing custom rankings system provides:
- **`CustomRankingsState`** (type: `src/types/custom-rankings.ts`) — ordered `rankings: string[]` (player IDs), `tiers: TierBreak[]`
- **`loadCustomRankings()`** (`src/utils/custom-rankings-storage.ts`) — loads from `/api/cr` (Vercel KV), falls back to localStorage
- **`buildRankingLookup()`** (`src/utils/rankings-lookup.ts`) — builds lookup maps for imported rankings with `AVERAGE_IMPORT_ID` for average rank
- **`getAllImports()`** / **`getAveragePosition()`** (`src/utils/rankings-storage.ts`) — imported rankings from multiple sources (FantasyPros, ESPN, CBS, Sleeper, etc.)

For the Available Players Board:
1. Load user's custom rankings (ordered player IDs)
2. Load roster data to determine which players are free agents
3. Load auction state to determine which free agents are currently up for bid
4. Available = free agent AND not currently in an active auction
5. Rank available players by custom ranking order (or average imported rank as fallback)
6. In Combined View, interleave active auction players into the ranked list at their ranking position

### Existing Patterns to Reuse
- `src/components/theleague/PlayerCell.astro` — Player display lockup (headshot + name + position + NFL team)
- `src/utils/team-names.ts` → `chooseTeamName()` — Team name overflow prevention
- `src/pages/api/live-scoring.ts` — Pattern for internal API route that proxies MFL with no-cache headers
- `src/components/theleague/AuctionStrip.astro` — Existing auction UI strip (link to it / from it)
- `src/utils/salary-calculations.ts` — Cap/salary formatting patterns
- `src/utils/league-year.ts` → `getCurrentLeagueYear()` — Year resolution
- `src/utils/custom-rankings-storage.ts` → `loadCustomRankings()` — Load user's custom player rankings
- `src/utils/rankings-lookup.ts` → `buildRankingLookup()` — Average rankings from imported sources
- `src/utils/mfl-fetch.ts` → `mflFetch()` — Redirect-safe MFL fetch for write operations
- `src/pages/api/trades/submit.ts` — Pattern for authenticated MFL write operations

### Key Architectural Decisions
1. **SSR page** (not prerendered) — needs auth context for "my team" filtering, bid placement, and custom rankings
2. **Internal API routes** — `/api/auction` (read, proxies transactions) and `/api/auction-bid` (write, submits bids to MFL)
3. **Client-side polling** — `setInterval` every 30s calling `/api/auction`, updating DOM. NOT React — use vanilla JS with `astro:page-load` lifecycle. Pauses when tab is hidden.
4. **State derivation** — No MFL endpoint gives "active auctions." Must compute: collect all AUCTION_WON player IDs, then find AUCTION_INIT records whose player IDs don't appear in WON set. Latest AUCTION_BID per active player = current high bid.
5. **Build-time player + roster data** — Player names/positions and roster assignments loaded via `import.meta.glob` at build time, serialized to `<script type="application/json">` tags. Only auction transactions are fetched live.
6. **Custom rankings loaded client-side** — Rankings are per-user (stored in Vercel KV by franchise ID), so loaded via `loadCustomRankings()` after page load. Average rankings from `buildRankingLookup()` as fallback.
7. **Split/Combined view state** — Stored in localStorage for persistence. Split = two-panel layout (auctions | available). Combined = single merged ranked list.
8. **Outbid notifications** — Client tracks which players the user is high bidder on. On each poll, if any of those players now have a different high bidder, trigger notification banner + optional sound.

## Design Requirements

### Layout
- **Desktop — Split View (default):**
  - Top: Metrics strip (4 cards: Budget Remaining, Players Won, Active Bids, Total Spent)
  - Middle: Toolbar (section title + team filter dropdown + view toggle [Split|Combined] + auto-refresh indicator)
  - Left panel (60%): Active Auctions table + Completed tab
  - Right panel (40%): Available Players board (ranked list with position filter)
- **Desktop — Combined View:**
  - Same metrics + toolbar
  - Single full-width ranked list with all players, active auction players tagged with bid info inline
- **Mobile (≤640px):** Metrics in 2x2 grid → Split view collapses to tabbed navigation (Auctions | Available | My Activity) → Card layout instead of tables

### Editorial Patterns
- [x] Section titles (uppercase + left-border accent)
- [x] Key metrics strip (4-column grid, gray-50 bg cards)
- [x] Data table (sticky headers, hover rows, tabular-nums)
- [x] Player lockup (PlayerCell.astro or buildPlayerCellHTML for client-rendered rows)
- [x] Team name display (chooseTeamName)
- [x] Pill/badge pattern (for bid status: "Active", "Won", "Outbid", "Higher on Board")
- [x] Detail rows for mobile card layout
- [x] Selected state pattern (left-border accent for "my bids")

### Status Badges
| Status | Style | Condition |
|--------|-------|-----------|
| **Active** | green pill (`--cat-free-agency`) | Player has INIT but no WON |
| **Won** | primary pill (`--color-primary`) | AUCTION_WON exists |
| **Outbid** | error pill (`--color-error`) | User's bid is not the latest for an active auction |
| **High Bidder** | green text accent | User holds the current highest bid |
| **Higher on Board** | amber/warning pill | Available player ranked higher than any active auction player on user's board |
| **On Block** | gray pill | Player is currently in an active auction (used in Combined View) |

### Notification Banner
- Fixed position below metrics strip (not blocking content)
- Red/error accent left-border (outbid is urgent)
- Shows: "You've been outbid on [Player Name] — [New Team] bid $X.XXM"
- Dismiss button (X) on right
- Optional toggle for notification sound (stored in localStorage)

### Rendering Strategy
- [x] SSR (`prerender = false`) — needs auth context and fresh data
- [x] No React hydration — vanilla JS polling + DOM updates via `astro:page-load`
- [x] Player + roster lookup maps serialized in `<script type="application/json">` tags at build time
- [x] Custom rankings loaded client-side via `loadCustomRankings()` after initial render

## Agent Sequence

### Phase 1: Design
- **frontend-ux-architect** — Design split/combined view layout, available players board, notification UX, bid form, responsive collapse pattern

### Phase 2: Implement
- **main session** — Build from approved design spec
- **mfl-api-expert** — Research exact bid placement endpoint and params (may need during implementation)

### Phase 3: QA
- **qa-investigator** — Trace: page load → data loading → API route → MFL fetch → polling → DOM update → bid submission → notification flow
- **qa-api-debugger** — Test `/api/auction` (read) and `/api/auction-bid` (write) endpoints

### Phase 4: Review
- **code-reviewer** — Tokens, DRY, guidelines compliance
- **astro-performance-expert** — SSR strategy, inline script size, player data serialization, polling efficiency
- **frontend-ux-architect** — A11y audit (live region for bid updates, keyboard nav for tabs/panels, screen reader for notifications)

## Prompt Context Per Agent

### frontend-ux-architect (Phase 1)
- Read: `docs/claude/insights/domains/design-system.md` (editorial patterns, metrics strip, table styling, toolbar pattern)
- Read: `src/components/theleague/AuctionStrip.astro` (existing auction UI for visual consistency)
- Read: `src/pages/theleague/players.astro` lines 1-150 (reference for toolbar + table page structure)
- Read: `src/components/theleague/custom-rankings/RankingList.tsx` (how rankings are displayed — adapt pattern for available players board)
- Reference: `src/pages/theleague/standings.astro` (tab switching pattern with view selectors)
- Focus: Split/combined view toggle UX, available players board design, outbid notification placement and behavior, bid form inline vs modal, mobile collapse strategy

### qa-investigator (Phase 3)
- Trace: `auction-tracker.astro` (page load) → `/api/auction` (read) → MFL transactions → client polling → DOM updates
- Trace: bid button click → bid form → `/api/auction-bid` (write) → MFL import → response → state refresh
- Trace: poll detects outbid → notification banner render → dismiss handler
- Key files: `src/pages/theleague/auction-tracker.astro`, `src/pages/api/auction.ts`, `src/pages/api/auction-bid.ts`, `src/utils/auction-utils.ts`

### qa-api-debugger (Phase 3)
- Test: `GET /api/auction` — verify structured auction data with active/completed separation
- Test: `GET /api/auction?franchise=0001` — verify team filtering
- Test: `POST /api/auction-bid` — verify bid placement (may need MFL auth credentials)
- Test: Error handling when MFL is unreachable

### astro-performance-expert (Phase 4)
- Check: SSR is necessary (auth + real-time + write ops), no React hydration used
- Verify: Player + roster data serialization size (should filter to relevant players, not all 15k+)
- Verify: Rankings loading doesn't block initial render (loaded async after page)
- Verify: Polling interval cleanup on View Transitions navigation (no ghost intervals)
- Verify: Page Visibility API integration (pause polling when tab hidden)

## Done Definition
- [ ] All acceptance criteria met
- [ ] pnpm test passes
- [ ] pnpm build succeeds
- [ ] No Critical review findings remain
- [ ] Insights documented in `docs/claude/insights/`
- [ ] What's New entry added (new page)
