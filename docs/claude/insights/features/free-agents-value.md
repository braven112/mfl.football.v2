# Free Agents Value — Insights

## 2026-02-28 - Blend Historical Curves With Position-Tier Benchmarks

**Context:** Estimated cost on `/theleague/players` Value view was collapsing toward minimum-tier prices, making surplus values untrustworthy for top players.

**Insight:** A single global-rank multiplier is not enough for auction pricing. Reliable estimates come from combining:
1. Historical position salary curves (`historical-salary-curves.json`)
2. Current league benchmark bands (`top3Average`, `top5Average`)
3. Position-specific comparable salaries near the same rank

Top 3-5 positional players need explicit benchmark anchoring, while rookie deals must still show actual salary.

**Evidence:** `src/utils/surplus-value.ts` now computes:
- position ranks (WR1, WR2, etc.) from rank signals
- historical-curve modeled costs
- top-tier floors tied to top3/top5 averages
- same-position comparable blending
- rookie-deal exception (`estimatedCost = actual salary`)

Verified in page output: `estimatedCost` now has broad spread (not flat), with top non-rookie players near franchise-level numbers.

**Recommendation:** Keep benchmark anchors and rookie exception in place. If price outputs drift low again, first inspect position-rank assignment and comparable sample windows before changing curve weights.

## 2026-02-28 - Value View Needs Context Columns for Price Calibration

**Context:** Users needed to validate estimated costs against real historical player pricing directly on the Value table.

**Insight:** Showing model output without a historical reference makes tuning subjective. Users preferred per-year visibility over an aggregate metric.

**Evidence:** `src/pages/theleague/players.astro` now adds three sortable Value columns (`2025`, `2024`, `2023` as of league year 2026), sourced from `mfl-player-salaries-*.json` for those exact years (`salaryYear1/2/3` fields in row data).

**Recommendation:** Keep explicit year columns instead of a single historical aggregate. It prevents hidden averaging effects and makes contract-era context obvious.

## 2026-07-08 - Phase-Aware Row Action Lives Outside the View Column-Groups

**Context:** Adding a per-row acquisition action (Bid during the offseason auction, Add the rest of the year → MFL's `add_drop` page, which itself auto-presents blind-bid waivers vs FCFS) to `/theleague/players`.

**Insight:** The players table has four exclusive views (`stats | rankings | value | auction`) toggled by `applyGroupVisibility()`. The `value` and `auction` branches do a blanket `display:none` on every cell then re-show only their keep-list; the `stats`/`rankings` branch resets everything to `''` then hides specific `col-group--*` classes. So a column that must show in the **default (stats) view** but stay hidden in value/auction must NOT carry `col-group--value` or `col-group--auction` — give it a standalone class (e.g. `col-fa-action`). It then renders in stats/rankings by default and is auto-hidden in the two blanket-hide branches (it's not in their keep-lists). The existing `col-place-bid` (value view) and `col-auction-placebid` (auction view) already cover their own views' Bid affordance.

**Evidence:** `src/pages/theleague/players.astro` — new `col-fa-action` header/cell appended after the salary column, gated `!p.rostered`, content branches on `isAuctionSeason`. MFL host/league id come from the registry (`getLeagueBySlug('theleague')`), not the old hardcoded `www49`/`13522`.

**Recommendation:** For any new always-visible-in-default-view column, use a standalone class outside the view groups rather than fighting the keep-lists. Reuse `.place-bid-link` styling for pill actions.

## 2026-07-08 - testDate on an SSR Page Needs the Server-Safe Reader

**Context:** The Bid-vs-Add row action keys off `isAuctionSeason`, computed in the Astro frontmatter from the real clock, so it couldn't be previewed in the browser.

**Insight:** `getTestDateFromUrl()` in `src/utils/league-year.ts` is **browser-only** (`typeof window === 'undefined' → null`) — it reads `window.location.search`, which doesn't exist in SSR frontmatter. Unlike the prerendered What's Next timeline (see `whats-next-timeline.md`, where `?testDate=` can't work at all), `players.astro` is SSR (`getAuthUser(Astro.request)`), so it *can* honor the param — but via the new `getTestDateFromSearchParams(Astro.url.searchParams)`. Drive only the date-dependent toggle with the test date; keep year-keyed data loading (`import.meta.glob` by `currentYear`) on the real clock so a test date can't request a feed year that doesn't exist.

**Evidence:** `src/utils/league-year.ts` now exports `getTestDateFromSearchParams(params)`; `getTestDateFromUrl()` delegates to it. `players.astro` computes the auction window from the test date's league year but loads data from real `currentYear`. Verified: `?testDate=2026-10-15` → Add, `?testDate=2026-04-01` → Bid.

**Recommendation:** For any SSR page that should honor `?testDate=`, read it from `Astro.url.searchParams` via `getTestDateFromSearchParams`, never `getTestDateFromUrl()`. Scope the override to the phase/date logic only, not data-source selection.
