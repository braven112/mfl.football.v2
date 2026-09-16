# Auction View — Insights

## 2026-03-20 - Multi-View Page Architecture: Hide-All-Then-Show-Keepers

**Context:** Adding a 4th view (Auction) to the free agents page which already had Stats, Rankings, and Value views.

**Insight:** The page uses a hide-all-then-show-keepers pattern for column visibility. Each view defines a `keepSelectors` array of CSS selectors to preserve, then hides everything else. This scales cleanly to N views without combinatorial explosion of show/hide rules.

**Evidence:** `src/pages/theleague/players.astro` — `applyGroupVisibility()` function. Each view case builds a keepSelectors array like:
```js
const keepSelectors = [
  '.players-table th.col-rank', '.players-table td.cell-rank',
  '.players-table th[data-sort="name"]', '.players-table td.cell-player',
  '.players-table th.col-group--auction', '.players-table td.col-group--auction',
];
```

**Recommendation:** When adding future views, follow this same pattern. Add `col-group--{viewname}` class to all view-specific `<th>` and `<td>` elements, then add a case in `applyGroupVisibility()` with the appropriate keepSelectors.

## 2026-03-20 - MFL Auction Timer Derivation from Transaction Timestamps

**Context:** MFL's email-based auction system does not expose per-player bid timers via API. Needed to show "Time Left" countdown per player.

**Insight:** Derive the deadline from `lastBidTime + 36h` (the league's bid window). The 36-hour timer resets only when the proxy bid is exceeded — not on every bid. The `lastBidTime` comes from AUCTION_BID transaction timestamps. The API endpoint (`/api/live-auction`) does a two-pass parse: first pass collects earliest AUCTION_INIT per player, second pass processes bids/wins with both initTime and lastBidTime.

**Evidence:** `src/pages/api/live-auction.ts` — two-pass transaction parsing. `src/pages/theleague/players.astro` — `getTimeLeftMs()` converts Unix seconds to ms and computes `deadline - Date.now()`.

**Recommendation:** The 36-hour window is defined as `BID_WINDOW_MS = 36 * 60 * 60 * 1000` in client JS. If the league changes its bid window, update this constant. MFL may also change auction rules between seasons.

## 2026-03-20 - Urgency Tiers Must Not Rely Solely on Color (WCAG 1.4.1)

**Context:** Time Left column used color tiers (gray → amber → red → pulsing red) to indicate urgency.

**Insight:** Color-only differentiation fails WCAG 1.4.1 (Use of Color). Adding a warning icon (⚠) to urgent/critical tiers provides a non-color signal. The pulse animation on critical also helps, but `prefers-reduced-motion` disables it.

**Evidence:** UX review flagged that closing (amber) vs urgent (red) was indistinguishable for color-blind users. Fixed by prepending `\u26a0` to urgent and critical formatted text.

**Recommendation:** Any future urgency/status indicators should include text or icon differentiation alongside color. Don't rely on animation as the sole non-color indicator since reduced-motion users won't see it.

## 2026-03-20 - Franchise Name Map via define:vars for Client-Side Resolution

**Context:** Needed to display franchise names (e.g., "Pigskins") instead of raw IDs (e.g., "0001") in the Bidder column.

**Insight:** Import `theleague.config.json` in frontmatter, serialize a minimal `[franchiseId, nameShort]` array to JSON, pass via `define:vars`, and reconstruct as a `Map` client-side. This avoids shipping the full config to the client.

**Evidence:** `src/pages/theleague/players.astro` lines 24-29 (frontmatter), line 903 (define:vars), line 907 (client Map construction). Only 16 entries × ~30 bytes each = ~480 bytes.

**Recommendation:** This pattern works for any small lookup table needed client-side. For larger datasets, consider a dedicated API endpoint instead of define:vars serialization.

## 2026-09-15 - A Results Feed Outlives Its Phase — "We Have Auction Data" Is Not "There Is an Auction"

**Context:** In mid-September, with the auction closed since the third Sunday of
August and waivers running, the Free Agents page still showed the Auction tab —
and it was still the page's live bidding board: a Place Bid column deep-linking
`O=43`, a 60-second poll of `/api/live-auction`, and a 36-hour clock ticking per
player against bids that had settled a month earlier.

**Insight:** The tab was gated on `canShowAuctionView = _hasAuctionData`, and
`hasAuctionData` is built from the auction **results** feed (`auctionResults`),
which keeps its rows for the whole league year. So the condition read as "an
auction is happening" while actually meaning "an auction happened this year" —
true from the first bid in March until the next rollover. This is the same shape
as CLAUDE.md's rule that a completed week in the feeds is not an offseason guard:
**a feed that outlives the phase cannot be the phase's test.** The phase has a
definition (`resolveAuctionWindow`) and the gate has to ask it.

The distinction that decides it is live-vs-archive. A view whose columns merely
*describe* a past auction could stay up year-round; this one *acts* — it opens
auctions, polls, and counts down — so it belongs to the window and nothing else.
`O=43` on an un-nominated player opens a new auction at the league minimum,
which is how an owner started one during a locked waiver week
(`AUCTION_INIT 0006 8851|425000|`, 2026-09-03).

**Evidence:** `src/pages/theleague/players.astro` — `canShowAuctionView`, the
`{isAuctionSeason && …}` gates on the toggle button, bid legend, countdown and
freshness pill, and `if (isAuctionSeason) startAuctionPolling()`. Pinned by
`tests/auction-bid-link-gating.test.ts` ("the Auction view belongs to the
auction window"), now wired into the `free-agents` path-guard domain.

**Recommendation:** Hiding the tab is not enough on its own, and neither is
hiding a column — a `display: none` element still holds a working anchor for
find-in-page and the accessibility tree, and the poll keeps running behind it.
Gate the RENDER on the server (`{isAuctionSeason && …}`), the view state, and
the polling separately. Also check what a stale client preference does: a
`playersViewMode: 'auction'` in localStorage or a `?view=auction` URL will walk
straight back into a view you only hid a button for.

## 2026-09-15 - A Date Literal in Client Script Is a Copy of a Date Formula

**Context:** The auction countdown's target was
`const AUCTION_END = new Date('2026-08-16T20:45:00-07:00').getTime()` in the
page's classic `<script>` — written the same day `auction-window.ts` was
extracted specifically so the window would have one definition.

**Insight:** The extraction moved every *branch* onto `resolveAuctionWindow` and
left the *constant* behind, because a constant does not look like a second copy
of a formula — it looks like data. It was correct for exactly one year and would
have silently pointed the countdown at a past date every year after. A classic
script can't import, which is what makes this trap specific to `.astro` pages:
the frontmatter has the util, the script below it does not, and re-deriving is
the path of least resistance.

**Evidence:** Now `const auctionEndMs = auctionWindow.end ? auctionWindow.end.getTime() : 0;`
in frontmatter, passed through `define:vars` and read as `AUCTION_END`. Resolves
to the same instant the literal held (2026-08-16T20:45 PT), and moves on its own
next year.

**Recommendation:** `define:vars` is the bridge for any server-resolved date a
classic client script needs — the same pattern this file already documents for
the franchise-name map. Grep a page's `<script>` for `new Date('` before
shipping: any date literal there is a value the server almost certainly already
knows.
