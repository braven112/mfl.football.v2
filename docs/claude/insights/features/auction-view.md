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

**Insight:** Derive the deadline from `lastBidTime + 36h` (the league's bid window). The `lastBidTime` comes from AUCTION_BID transaction timestamps. The API endpoint (`/api/live-auction`) does a two-pass parse: first pass collects earliest AUCTION_INIT per player, second pass processes bids/wins with both initTime and lastBidTime.

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
