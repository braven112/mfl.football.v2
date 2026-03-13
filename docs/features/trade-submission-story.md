# Story: Trade Submission & Management

## User Story
As a league member, I want to submit, view, accept, reject, and counter trade proposals directly from the trade builder so that I never have to leave mfl.football to manage trades.

## Acceptance Criteria

### Submit Trade
- [ ] Authenticated users see a "Submit Trade" button in the trade builder when both sides have at least one asset
- [ ] Clicking "Submit Trade" opens a confirmation modal summarizing both sides (players + picks), cap impact, and an optional message field
- [ ] User confirms and the trade is submitted to MFL via `TYPE=tradeProposal`
- [ ] Success/error feedback is shown via toast notification
- [ ] The submit button is disabled when the user's franchise is not one of the two trade sides

### Auth Gate (Inline Login Modal) — DEFERRED
> **NOTE:** The inline login modal (InlineLoginModal.tsx) will be built in a separate session. This feature will integrate with it when ready. For now, unauthenticated users clicking "Submit Trade" will be redirected to `/theleague/login` with a return URL that preserves trade state via URL params.

- [ ] Unauthenticated users who click "Submit Trade" are redirected to login with return URL preserving trade state
- [ ] After login redirect back, the trade builder restores state from URL params (already works)
- [ ] **FUTURE:** Swap redirect with inline login modal when InlineLoginModal.tsx is available

### Pending Trades Sidebar
- [ ] A slide-out sidebar panel shows the user's pending trades (sent and received)
- [ ] Triggered by a "My Trades" button visible to authenticated users
- [ ] Each trade card shows: counterparty team name/icon, players/picks on each side, status (sent/received), timestamp
- [ ] Summary view — enough info to decide without opening the full builder

### Accept / Reject / Counter
- [ ] "Accept" on a received trade sends acceptance to MFL, shows success toast
- [ ] "Reject" on a received trade sends rejection to MFL, shows success toast
- [ ] "Counter" loads the trade into the trade builder with all assets pre-filled, user modifies and re-submits
- [ ] "Withdraw" on a sent trade cancels the proposal on MFL
- [ ] All actions require confirmation before executing

### Edge Cases
- [ ] Trade builder remains fully functional for unauthenticated users as an analysis tool (no submit)
- [ ] If user's session expires mid-action, show inline login modal to re-authenticate
- [ ] Handle MFL API errors gracefully (trade already accepted/rejected, player no longer on roster, etc.)
- [ ] pnpm test passes
- [ ] pnpm build succeeds

## Technical Context

### MFL API Endpoints

**Submit Trade (Write):**
```
POST /import?TYPE=tradeProposal&L=13522
Params: OFFEREDTO, WILL_GIVE_UP, WILL_RECEIVE, COMMENTS (optional), EXPIRES (optional)
Auth: Owner (MFL_USER_ID cookie)
```

**Pending Trades (Read):**
```
GET /export?TYPE=pendingTrades&L=13522&JSON=1
Optional: FRANCHISE_ID
Auth: Owner (MFL_USER_ID cookie)
```

**Accept/Reject Trade (Write):** Needs MFL API research — likely `POST /import?TYPE=tradePending` or similar with ACCEPT/REJECT action.

### Files to Create
- `src/pages/api/trades/submit.ts` — API route: submit trade proposal to MFL
- `src/pages/api/trades/pending.ts` — API route: fetch pending trades from MFL
- `src/pages/api/trades/respond.ts` — API route: accept/reject/withdraw trade on MFL
- `src/components/theleague/trade-builder/TradeConfirmationModal.tsx` — Review & confirm modal
- `src/components/theleague/trade-builder/PendingTradesPanel.tsx` — Slide-out sidebar
- `src/components/theleague/trade-builder/PendingTradeCard.tsx` — Individual trade card
- ~~`src/components/theleague/trade-builder/InlineLoginModal.tsx`~~ — DEFERRED to separate session

### Files to Modify
- `src/components/theleague/trade-builder/TradeBuilder.tsx` — Add submit button, pending panel trigger, auth state, login modal integration
- `src/types/trade-builder.ts` — Add trade submission & pending trade types
- `src/pages/theleague/trade-builder.astro` — Pass auth user data + MFL cookie to React component
- `docs/features/mfl-api.md` — Document tradeProposal and pendingTrades endpoints

### Data Sources
- MFL `tradeProposal` import endpoint (write)
- MFL `pendingTrades` export endpoint (read)
- MFL `login` endpoint (for inline re-auth)
- `getCurrentLeagueYear()` for year parameter
- Existing trade builder state (players, picks, teams) already in React state

### Existing Patterns to Reuse
- `src/components/theleague/ContractDeclarationModal.astro` — Modal overlay pattern (CDM editorial style) for login modal
- `src/pages/api/move-to-ir.ts` — Authenticated MFL write operation pattern (but uses env vars, not user auth)
- `src/utils/mfl-login.ts` — MFL credential authentication (login + franchise resolution)
- `src/pages/api/auth/login.ts` — Session JWT creation after MFL auth
- `src/utils/auth.ts` → `getAuthUser()` — Check auth state server-side
- `src/utils/session.ts` → `createSessionToken()` / `createSessionCookie()` — Session management
- `src/utils/trade-calculations.ts` → `serializeTradeToParams()` — URL state preservation

### Auth Architecture for Trade Submission

**Critical distinction:** The existing `move-to-ir.ts` endpoint uses server-side env vars (`MFL_USER_ID`, `MFL_APIKEY`) — this means ALL IR moves go through the commissioner's account. For trade proposals, we need the **individual user's MFL cookie** because MFL determines the proposing franchise from the auth cookie.

**Approach:**
1. During login, store the MFL_USER_ID cookie in the session JWT (or in a separate httpOnly cookie)
2. When submitting a trade, the API route extracts the user's MFL cookie from the session and forwards it to MFL
3. This ensures MFL sees the correct franchise as the proposer

**Alternative:** Re-authenticate with MFL on each write operation using stored credentials — but this is slower and requires storing passwords (bad).

## Design Requirements

### Layout
- **Submit Button:** Appears in the trade builder action bar (below trade panels), editorial primary button style
- **Confirmation Modal:** Full-screen overlay (mobile) / centered modal (desktop), max-width 480px
- **Pending Trades Panel:** Slide-out from right edge, 400px wide on desktop, full-width on mobile
- **Login Modal:** CDM-style overlay following ContractDeclarationModal pattern

### Editorial Patterns
- [x] Section titles (uppercase + left-border accent) — in pending trades panel
- [x] Detail rows (flex rows with fixed-width labels) — in trade cards
- [x] Key metrics strip (3-column grid, gray-50 bg cards) — cap impact in confirmation modal
- [x] Player lockup (PlayerCell / buildPlayerCellHTML) — in trade cards
- [x] Team name display (chooseTeamName) — in trade cards and panel headers

### Rendering Strategy
- [x] SSR (trade-builder.astro already SSR for auth)
- [x] React hydration via `client:load` (TradeBuilder.tsx already hydrated)
- [x] New components are children of TradeBuilder.tsx — no additional hydration boundaries

## Agent Sequence

### Phase 1: Design
- **frontend-ux-architect** — Design confirmation modal, pending trades panel, login modal, submit button placement

### Phase 2: Implement
- **main session** — Build from approved design spec
- **mfl-api-expert** — Research accept/reject/withdraw MFL API endpoints (exact params, response format)

### Phase 3: QA
- **qa-investigator** — Trace: Submit button click → auth check → login modal (if needed) → confirmation modal → API route → MFL tradeProposal → success toast
- **qa-api-debugger** — Test `/api/trades/submit`, `/api/trades/pending`, `/api/trades/respond` endpoints with live MFL data

### Phase 4: Review
- **code-reviewer** — Tokens, DRY, CLAUDE.md compliance
- **astro-performance-expert** — Hydration, bundle impact of new components
- **frontend-ux-architect** — Final a11y + UX review

## Prompt Context Per Agent

### frontend-ux-architect (Phase 1)
- Read: CLAUDE.md "Editorial Design Standard" section + "Player Display" section
- Reference: `src/components/theleague/ContractDeclarationModal.astro` (lines 1-80) for modal pattern
- Reference: `src/components/theleague/trade-builder/TradeBuilder.tsx` for current layout
- Focus: Confirmation modal layout, pending trades panel UX, inline login modal, submit button placement and states

### mfl-api-expert (Phase 2)
- Research: MFL's accept/reject/withdraw trade API — exact endpoint, params, auth requirements
- Reference: `docs/features/mfl-api.md` for existing MFL endpoint documentation
- Focus: What does `pendingTrades` response look like? How to accept/reject? Player ID format for WILL_GIVE_UP/WILL_RECEIVE?

### qa-investigator (Phase 3)
- Trace: Submit button → TradeBuilder.tsx state → TradeConfirmationModal → fetch('/api/trades/submit') → MFL import endpoint → response → toast
- Trace: My Trades button → fetch('/api/trades/pending') → PendingTradesPanel → PendingTradeCard → accept/reject/counter
- Key files: All new files created + `src/utils/auth.ts`, `src/utils/mfl-login.ts`

### qa-api-debugger (Phase 3)
- Test: POST `/api/trades/submit` with valid trade data
- Test: GET `/api/trades/pending` for authenticated user
- Test: POST `/api/trades/respond` with accept/reject action
- Test: Error cases (unauthenticated, invalid trade, MFL errors)

### astro-performance-expert (Phase 4)
- Check: No new hydration boundaries (all components nested under existing TradeBuilder.tsx)
- Verify: Login modal doesn't load unnecessary JS when user is already authenticated
- Verify: Pending trades data is fetched on-demand (not on page load)

## Done Definition
- [ ] All acceptance criteria met
- [ ] pnpm test passes
- [ ] pnpm build succeeds
- [ ] No Critical review findings remain
- [ ] Insights documented in `docs/claude/insights/`
- [ ] What's New entry added
