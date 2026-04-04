## 2026-04-04 - Draft Room Architecture: WebSocket Chat Requires `partysocket` Dependency

**Context:** Building the Draft Room real-time chat panel (Phase C) using PartyKit WebSockets for live communication during drafts.

**Insight:** `DraftChatPanel.tsx` imports `PartySocket` from the `partysocket` npm package, which must be added as a workspace dependency. The package was missing from `package.json` causing a Rollup build failure: `Failed to resolve import "partysocket"`. Even though the import was correct TypeScript syntax and type-checked fine in dev mode (the vite dev server handles unresolved imports differently), the production build caught it. Always verify that new third-party imports exist in `package.json` before pushing.

**Evidence:** `pnpm build` failed with `[vite]: Rollup failed to resolve import "partysocket"`. Fixed by running `pnpm add -w partysocket`.

**Recommendation:** After adding any new `import` from a third-party module, check `package.json` dependencies before committing. The TypeScript compiler and vite dev server won't catch missing packages — only `pnpm build` (Rollup bundling) will surface this reliably.

## 2026-04-04 - Draft Room Layout: 4-Panel Desktop, 4-Tab Mobile With Persistent Timer

**Context:** Designing the layout for the draft room to surface board, player pool, queue, and chat simultaneously on desktop while keeping mobile ergonomic.

**Insight:** The draft room has four distinct contexts that users need at different moments: the board (always visible for situational awareness), the player pool (for browsing and searching), the queue (pre-ranking targets before your pick), and chat (live social layer). On desktop these can coexist as side-by-side panels. On mobile they must be tabs, but the timer and current-pick indicator must always be visible — that's what the `DraftTimerBanner` component handles as a sticky top bar across all mobile tabs.

**Evidence:** `src/components/theleague/draft-room/DraftRoom.tsx` implements the panel grid with CSS custom properties for responsive column widths. `MobileTabBar.tsx` manages tab state. `DraftTimerBanner.tsx` is always rendered regardless of active tab.

**Recommendation:** When adding new draft room panels or widgets, prefer placing contextually-dependent content behind a tab on mobile (not always-visible), and reserve the sticky banner area for time-critical information only (clock, current pick, on-the-clock indicator).

## 2026-04-04 - Draft Room State: Reducer Pattern for Multi-Source Events

**Context:** The draft room receives state from multiple asynchronous sources: MFL API poll (board state), WebSocket messages (chat, pick announcements), and local user actions (queue reordering, pick submission).

**Insight:** Using a React reducer (`useReducer`) in the top-level `DraftRoom.tsx` component centralizes all state transitions. Each source dispatches typed actions (`PICK_MADE`, `CHAT_MESSAGE`, `QUEUE_REORDER`, `BOARD_SYNC`, etc.) and the reducer handles them deterministically. This prevents the race conditions that would arise from multiple `useState` hooks being updated independently from different async callbacks. The chat history, pick queue, and board state are all part of a single `DraftRoomState` object.

**Evidence:** `src/types/draft-room.ts` defines `DraftAction` as a discriminated union. `DraftRoom.tsx` wires the reducer to WebSocket callbacks and the MFL poll interval.

**Recommendation:** Any new draft room feature (auto-pick indicator, trade offers during draft, audio cues) should dispatch a typed action to the central reducer rather than managing local state independently. Keep the reducer pure and side-effect free — effects belong in `useEffect` hooks or event handlers.

## 2026-04-04 - MFL Draft Board Sync: Polling Over WebSockets for Read Operations

**Context:** Keeping the draft board in sync with MFL's authoritative draft state — picks made via the MFL interface, auto-picks, and commissioner overrides.

**Insight:** MFL doesn't provide a WebSocket feed for draft events, so the draft board must be polled. The polling interval during active draft is 15 seconds, balanced between freshness and API rate-limit courtesy. Picks submitted through our own UI are optimistically applied immediately (via reducer dispatch) then confirmed on the next poll cycle. If the poll result contradicts the optimistic state (e.g., pick was rejected), the reducer reconciles to the MFL-authoritative state.

**Evidence:** `src/components/theleague/draft-room/DraftBoardPanel.tsx` and the draft room's `useEffect` interval handle the polling. The `BOARD_SYNC` action replaces the full board state on each successful poll.

**Recommendation:** If MFL ever introduces webhooks or SSE for draft events, the board sync can be upgraded from polling to push without changing the reducer — only the data source for `BOARD_SYNC` dispatch changes. Keep the optimistic-then-reconcile pattern as it gives the UI instant feedback regardless of polling frequency.
