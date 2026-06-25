# Frontend Insights

Domain knowledge about UI/UX patterns, component architecture, and frontend development.

---

## 2026-03-01 - ESPN Headshot URL Patterns and College Fallback

**Context:** Adding college headshots as a fallback for rookies without NFL photos.

**Insight:** ESPN uses consistent URL patterns for headshots across NFL and college:
- NFL: `https://a.espncdn.com/i/headshots/nfl/players/full/{espnId}.png`
- College: `https://a.espncdn.com/i/headshots/college-football/players/full/{espnId}.png`
- The `espnId` for college and NFL are different IDs — a player's college athlete ID is NOT the same as their NFL player ID.

**Key findings:**
- ESPN draft prospects API: `sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{year}/draft/athletes`
- Each prospect's `athlete.$ref` link contains the college athlete ID
- College roster API returns position groups (`{ position: "offense", items: [...] }`), NOT a flat player array
- MFL stores ESPN NFL IDs as `espn_id` on player records, but 2026 draft prospects have none
- Supplementary mapping lives in `data/theleague/espn-college-ids.json`

**Headshot fallback chain (implemented in `buildHeadshotOnerror()`):**
```
ESPN NFL headshot → ESPN College headshot → MFL headshot → default placeholder
```

**Name matching gotchas:**
- MFL uses "Last, First" format; ESPN uses "First Last"
- Strip suffixes (Jr., III, Sr.) before comparing
- College names differ between MFL and ESPN (e.g., "Colordado State" typo in MFL, "UCONN" vs "Connecticut")
- `src/data/college-logos.json` maps college names → ESPN team IDs for roster lookups

---

## 2026-01-18 - Team Icons Are Stored in Config Files

**Context:** Need to display team logos in nav footer

**Insight:** Team icons are defined in the league config files, not as separate asset lookups.

**Evidence:**
- TheLeague: `src/data/theleague.config.json` → `teams[franchiseId].icon`
- AFL: `data/afl-fantasy/afl.config.json` → `teams[franchiseId].icon`
- Path pattern: `/assets/theleague/icons/{team-name}.png`

**Recommendation:** Access team icons via config, not by constructing paths manually:
```typescript
const teamConfig = config.teams[franchiseId];
const iconUrl = teamConfig?.icon;
```

---

## 2026-01-18 - Existing Navigation Has Two Header Components

**Context:** Planning nav drawer redesign

**Insight:** The codebase has two separate header/nav systems:
1. `src/components/Header.astro` - Main site header with hamburger drawer
2. `src/components/theleague/Header.astro` - League-specific with breadcrumb + icon nav + drawer

Both slide from the right and share similar patterns but have different link structures.

**Evidence:**
- Main Header: 8 links across Tools/Leagues sections
- TheLeague Header: Desktop icon nav (6 icons) + mobile drawer with 4 sections (Tools, Advanced Reports, Community, Leagues)

**Recommendation:** The new unified nav component should replace both, using config to determine which links/sections to show based on context.

---

## 2026-01-18 - Dark Mode Should Be Supported Going Forward

**Context:** Nav redesign planning

**Insight:** All future work should support dark mode. Use CSS custom properties that adapt via `prefers-color-scheme` media query AND manual `.dark` class toggle.

**Evidence:** Design decision made during nav redesign planning session.

**Recommendation:** Pattern for dark mode support:
```css
:root {
  --component-bg: #ffffff;
  --component-text: #333333;
}

@media (prefers-color-scheme: dark) {
  :root {
    --component-bg: #1e293b;
    --component-text: #f1f5f9;
  }
}

/* Manual toggle support */
.dark {
  --component-bg: #1e293b;
  --component-text: #f1f5f9;
}
```

---

## 2026-02-12 - Franchise History System for Name/Logo Changes

**Context:** Heavy Chevy (franchise 0004) rebranded to Dead Cap Walking for the 2026 season. Need historical views (standings, playoffs, salary history) to show the old name/logo while current views show the new one.

**Insight:** Added a `history` array to team config entries in `theleague.config.json`. Each entry has `yearStart`/`yearEnd` plus all identity fields (name, nameMedium, nameShort, abbrev, aliases, icon, banner, groupMe). The `getTeamIdentityForYear()` function in `src/utils/team-names.ts` resolves the correct identity for any given year.

**Evidence:**
- Config: `src/data/theleague.config.json` → franchise 0004 has `history[]` with Heavy Chevy 2007-2025
- Utility: `src/utils/team-names.ts` → `getTeamIdentityForYear(team, year)`
- Tests: `tests/franchise-history.test.ts`
- MFL API: No dedicated history endpoint. Year-scoped `league` exports return names as they were that year.

**Recommendation:** For pages showing historical data, use `getTeamIdentityForYear()` to resolve team identity:
```typescript
import { getTeamIdentityForYear, type TeamConfig } from '../utils/team-names';

const identity = getTeamIdentityForYear(team as TeamConfig, year);
const displayName = chooseTeamName({
  fullName: identity.name,
  nameMedium: identity.nameMedium,
  nameShort: identity.nameShort,
  abbrev: identity.abbrev,
});
// identity.icon and identity.banner also resolve correctly
```
Future franchise rebrandings just need a new history entry added to the config.

---

## 2026-02-23 - Player Lockup Standard

**Context:** Multiple components displayed players with slightly different patterns — some missed DEF handling, some skipped `normalizeTeamCode()`, causing broken logos for KC, JAX, NE, NO.

**Insight:** A single "Player Lockup" pattern was established as a CLAUDE.md-level standard. All player displays must use `PlayerCell.astro` with proper DEF detection and team code normalization.

**Evidence:** FreeAgentNeedsCard.astro had broken Kansas City Chiefs logo (KCC.svg not found — file is KC.svg). DEF players showed generic silhouette instead of team logo.

**Recommendation:** Before building any new player list/card/table, check CLAUDE.md > Player Display for the required pattern. Use `normalizeTeamCode()` for ALL NFL logo URLs. Test with JAC, KCC, NEP, NOS teams.

---

## 2026-03-13 - Conditional `<script>` Tags Break Astro Deduplication

**Context:** Performance review of the commissioner toggle feature in `src/components/nav/NavFooter.astro`.

**Insight:** Wrapping an Astro `<script>` block inside a JSX-style conditional (`{condition && (<script>...</script>)}`) defeats Astro's module deduplication. Astro deduplicates scripts by content hash, but only for unconditionally rendered scripts. A conditionally rendered `<script>` is treated as a dynamic expression and may be injected multiple times across View Transitions navigations. Additionally, `astro:page-load` listeners registered inside such a conditional accumulate without being removed on subsequent navigations, creating ghost listeners.

**Evidence:** `src/components/nav/NavFooter.astro` lines 209–344. The `initCommishToggle` function registers a new `astro:page-load` listener on every call without removing the previous one.

**Recommendation:** Always place `<script>` blocks unconditionally and guard initialization logic inside the function body instead:
```astro
<!-- DO NOT do this -->
{isCommissioner && (
  <script>
    document.addEventListener('astro:page-load', init);
  </script>
)}

<!-- DO this instead -->
<script>
  function init() {
    const el = document.querySelector('[data-my-trigger]');
    if (!el) return; // Guard here, not at the script level
    // ...
  }
  document.addEventListener('astro:page-load', init);
</script>
```

---

## 2026-03-13 - Admin Visibility Filtering Is Commissioner-Safe

**Context:** Performance review of commissioner toggle — verifying admin nav links aren't stripped before NavLinks sees them.

**Insight:** The layout-level `getVisibleSections(league, myteam, adminFranchiseIds)` does NOT strip admin sections for commissioners, because `isCommissioner` requires `adminFranchiseIds.includes(myteam)` — the same check `isSectionVisible()` uses. So admin sections always survive the layout filter for commissioner users. NavLinks then adds its own override to render admin links as hidden (toggleable) rather than omitted.

**Evidence:** `TheLeagueLayout.astro` line 147–151, `nav-utils.ts` line 237–239. Both use `adminFranchiseIds.includes(franchiseId)` as the gate.

**Recommendation:** This two-pass pattern is safe but could be simplified in a future refactor. If a non-commissioner admin role is ever added (where `isCommissioner` differs from `isAdmin`), the filtering would need revisiting.

---

## 2026-03-13 - Client-Side Admin Link Toggle Pattern

**Context:** Commissioner toggle needs to show/hide admin-only nav links without a page reload.

**Insight:** Admin links are always rendered in the DOM for commissioners but hidden with `style="display: none;"` when not in commish mode. The toggle uses `data-visibility="admin"` and `data-section-visibility="admin"` attributes as selectors, flipping display on/off. This avoids re-fetching or re-rendering sections.

**Evidence:** `NavLinks.astro` lines 262–298 (data attributes), `NavFooter.astro` `updateAdminNavLinks()` function.

**Recommendation:** For any future client-side visibility toggle, follow this pattern:
1. Server-render all possible content with data attributes for toggling
2. Set initial visibility via inline `style` (no FOUC)
3. Toggle via `el.style.display = showAdmin ? '' : 'none'`
4. Store state in a cookie for SSR consistency on next page load

---

## 2026-03-14 - Astro Scoped CSS Specificity with Dynamic Classes

**Context:** League Summary page used `:global(.league-summary__th--sorted)` to style dynamically-added classes, but the styles were losing to scoped rules.

**Insight:** Astro adds `[data-astro-cid-xxx]` attribute selectors to scoped CSS rules. A `:global(.dynamic-class)` rule has lower specificity than a scoped `.base-class[data-astro-cid-xxx]` rule. To win, combine the scoped class with the global class: `.base-class:global(.dynamic-class)`.

**Pattern:**
```css
/* ❌ Loses to scoped .league-summary__th */
:global(.league-summary__th--sorted) {
  color: var(--color-primary);
}

/* ✅ Wins because it includes the scoped class */
.league-summary__th:global(.league-summary__th--sorted) {
  color: var(--color-primary);
}
```

**Evidence:** `src/components/theleague/LeagueSummaryTable.astro` — sorted column headers and preferred team row both needed this fix.

---

## 2026-03-15 - Editorial Table Pattern for JS-Populated Tables

**Context:** Salary Analytics redesign — tables with server-rendered `<thead>` but client-populated `<tbody>`.

**Insight:** When `<tbody>` rows are created by JavaScript, the editorial table CSS pattern requires:
1. `border-collapse: separate` (not `collapse`) to support rounded corners on `<th>` elements
2. `:global()` wrapper on tbody selectors for Astro scoped style compatibility
3. Explicit `background` on `<th>` (not just `<thead>`) since `border-collapse: separate` isolates cell backgrounds

**Key CSS:**
```css
.editorial-table { border-collapse: separate; border-spacing: 0; }
.editorial-table th { background: var(--color-gray-50, #f9fafb); }
.editorial-table th:first-child { border-radius: var(--radius-sm, 0.25rem) 0 0 0; }
.editorial-table th:last-child { border-radius: 0 var(--radius-sm, 0.25rem) 0 0; }
.editorial-table :global(tbody tr:first-child td) { padding-top: 0.625rem; }
```

**Evidence:** `src/pages/theleague/salary.astro` — editorial table with JS-injected player rows.

---

## 2026-04-30 - Status Pill Source-of-Truth Pattern

**Context:** The Schefter admin dashboard tagged GroupMe messages "picked up" or "ignored" based purely on whether their id was in the *current* tips queue. Tips have a 24h TTL and are removed once consumed, so any message older than 24h showed "ignored" forever — including ones that successfully became published posts.

**Insight:** Status pills derived from transient storage (queues, caches with TTL) only show *current* state, not historical outcome. For pills that need to remain accurate across an item's full lifetime, cross-reference against a durable record (the published feed, the persisted record, the audit log).

**Evidence:** `src/pages/theleague/admin/schefter.astro` four-state pill system (`posted` / `pending` / `expired` / `no-match`). Server builds `postedGmIdToPostId` map from `feed.posts[].tipIds` (durable) and ships it down once per fetch. Client checks the durable lookup BEFORE the queue lookup.

**Recommendation:** When designing status indicators, identify the durable source first. If the durable source requires a server-side join/aggregation, do it once in the API route (in a lookup table, not row-by-row from the client). Document the four states explicitly so future readers don't conflate "not in queue" with "never picked up".

---

## 2026-05-04 - Multi-Section Tables: Mutating Source Arrays Isn't Enough

**Context:** Built a roster-move action button on `src/pages/theleague/rosters.astro`. After a successful MFL write, the local-state-update function moved the player object between `teamData.players` / `teamData.injuredReserve` / `teamData.practiceSquad` arrays and updated the row's CSS class. The user reported: "I moved a guy to practice squad but he's still on the active roster."

**Insight:** The rosters page renders Active / Practice Squad / IR as visually-distinct sections built from the three bucket arrays. The DOM layout — which `<tr>` sits in which section — comes from the rendering pass that walks those arrays in order, not from the row's CSS class. Mutating the bucket arrays without re-running the render keeps the row in its original DOM position, even though the data thinks it has moved.

This is the trade-block flow's blind spot: trade-block adds/removes a small badge inside an existing row, so a class flip is sufficient. Roster moves cross section boundaries, so they aren't.

**Evidence:** `src/pages/theleague/rosters.astro` — `applyLocalRosterMove` (~line 8914) was correctly mutating `teamData.players` / `.practiceSquad` / `.injuredReserve` and toggling `roster-row--{tag}` classes, but the player visually stayed on the active roster until a hard reload.

**Recommendation:** For any state change that re-classifies a row across multi-section table boundaries, call the page's full re-render function (`updateView()` in this codebase) after mutating the source arrays. Don't try to surgically move DOM nodes — the render function already handles section ordering, sort, contract-action overlays, cap math, and re-attaching click handlers. Any DOM-only "move the row" approach skips those side effects.

Pattern:
```js
// 1. POST to server, await success
// 2. Mutate the source-of-truth arrays (teamData.* buckets)
// 3. Update any persistent UI state that survives re-render (e.g. data-attrs on the action button)
// 4. Call updateView() to re-render from the mutated state
```

---

## 2026-05-04 - `player.status` in Rosters Page Is the Bucket, Not MFL Rookie Classification

**Context:** Wiring a UI gate to show "Move to Practice Squad" only for rookies. The naive read of MFL's player record uses `status === 'R'` for rookies. Tried plumbing `player.status` from the action button into the gate.

**Insight:** In `src/pages/theleague/rosters.astro`, `player.status` is the BUCKET status from the rosters API — `'ROSTER'` / `'INJURED_RESERVE'` / `'TAXI_SQUAD'`. The MFL rookie classification (`'R'`) only exists on the players export, NOT on the roster export. The two endpoints share a field name with completely different meanings. A naive `player.status === 'R'` check will NEVER match.

**Evidence:** rosters.astro line ~1029 sets `status: liveData.status ?? salaryPlayer.status ?? 'ROSTER'` from the live rosters data. The same `player.status` field flows through `mapPlayers()` and into the row data passed to the SSR template.

**Recommendation:** For client-side rookie detection on the rosters page, use `contractInfo === 'RC' || contractInfo === 'TO'`. TheLeague's auto-stamp script (`scripts/sync-draft-pick-contracts.mjs`) writes one of those tags onto every drafted rookie within minutes of the pick, so it's a reliable proxy for "is this player a current rookie." For server-side authoritative checks, fetch the players export and check `status === 'R'` — that's MFL's own classification and the right gate for any irreversible action.


---

## 2026-06-24 - `getTeamColor()` Only Knows TheLeague's Colors

**Context:** Ported the Owner Activity page (daily page-views line chart, one color-coded line per franchise) from TheLeague to the AFL site. TheLeague's page resolves each series color via `getTeamColor(franchiseId)` from `src/utils/team-colors.ts`. Reusing that for AFL made every line render the same gray.

**Insight:** `src/utils/team-colors.ts` builds its color map *exclusively* from `theleague.config.json` team entries that carry a `color` field. `getTeamColor()` returns a hardcoded `#6b7280` gray fallback for any franchiseId it doesn't recognize. AFL franchises live in `data/afl-fantasy/afl.config.json` and have **no** `color` field, so every AFL franchise hits the fallback — multi-series charts collapse to one indistinguishable color.

**Evidence:** `src/utils/team-colors.ts` imports `../data/theleague.config.json` directly and only registers `team.color` values. `data/afl-fantasy/afl.config.json` teams (24 of them) carry `icon`/`banner` but no `color`.

**Recommendation:** For any per-franchise chart on a non-TheLeague site, supply your own palette rather than calling `getTeamColor()`. The AFL Owner Activity page (`src/pages/afl-fantasy/activity.astro`) does this with a local 24-entry `CHART_PALETTE` keyed by franchise index. The shared render component (`src/components/theleague/OwnerActivityReport.astro`) stays color-agnostic — it just consumes a pre-resolved `color` on each chart series, so each league page resolves colors its own way. If colored franchise charts become common for AFL, the durable fix is to add a `color` field per team in `afl.config.json` and generalize `team-colors.ts` to load by league.

---

## 2026-06-24 - Absolutely-Positioned First Child Breaks `:not(:first-child)` Margin Spacing

**Context:** The AFL homepage grid (`src/pages/afl-fantasy/index.astro`) showed a ~2rem empty band above BOTH columns — the hero and the Schefter Report sidebar floated below the grid top instead of sitting flush.

**Insight:** The left column spaced its blocks with `.afl-hp__main > :global(:not(:first-child)) { margin-top: 2rem }` (the `:global()` is required to pierce Astro's scoped styles and reach the hydrated component children). But the column's real first child is a `visually-hidden` `<h2>` accessibility landmark. Because that h2 is `position: absolute` (visually-hidden pattern) it occupies the `:first-child` slot in the selector even though it has no layout box — so the hero, the first *visible* element, matches `:not(:first-child)` and wrongly gets the 2rem top margin. The sidebar then carried a matching `margin-top: 2rem` purely to stay vertically aligned with the displaced hero, doubling the visible gap.

**Evidence:** Switching `.afl-hp__main` to `display: flex; flex-direction: column; gap: 2rem` fixed it: an absolutely-positioned flex item is removed from flex flow and is NOT spaced by `gap`, so the gap only applies between the visible blocks — no leading gap — and the inter-section 2rem is preserved. The sidebar's compensating `margin-top` was removed from the desktop rule (it only existed to offset the displaced hero) but re-added inside the single-column `@container (max-width: 880px)` breakpoint, where the sidebar stacks below the main column and the 2rem is purely visual separation, not column alignment. Verified both columns at `offsetFromGrid: 0` on desktop.

**Recommendation:** When a flow container leads with a `visually-hidden` heading (a common a11y landmark pattern), do NOT space siblings with `:not(:first-child)` margins — the hidden-but-present first child throws the selector off by one. Prefer `display: flex; flex-direction: column; gap: …` (or `display: grid; gap: …`): absolutely-positioned children drop out of flex/grid flow, so `gap` naturally ignores them and spaces only the visible items. This also removes the need for compensating margins on sibling columns.
