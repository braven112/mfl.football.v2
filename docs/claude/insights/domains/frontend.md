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

## 2026-06-24 - Owner Activity's Third Transaction Stat Is League-Configurable (Auctions ≠ AFL)

**Context:** The Owner Activity "Transaction Activity" leaderboard (`OwnerActivityReport.astro`, shared by both leagues) hardcoded a third stat column = **Auctions** (`auctionWins`, counting `AUCTION_WON`). AFL is a keeper league with a 9-round NFL-style draft and **no auction** (`docs/claude/afl-rules.md`) — so the AFL page fabricated fake auction wins in its mock generator and surfaced a column that never reflects real activity.

**Insight:** The shared component's third stat is now generic — `counts.thirdStat` plus `thirdStatLabel`/`txSubtitle` props (default `"Auctions"`/auction-wins copy so TheLeague is unchanged). TheLeague keeps counting `AUCTION_WON`; AFL passes `thirdStatLabel="Waivers"` and counts `WAIVER` / `BBID_WAIVER` (its rolling "Yahoo-style" waiver adds — a real type in `data/afl-fantasy/mfl-feeds/*/transactions.json`). Note: historical AFL feeds (pre-2026) *do* contain `AUCTION_WON` from an older format, so "AFL never produces it" is only true going forward — don't rely on the type's absence to detect league.

**Recommendation:** When reusing a TheLeague component for AFL, audit every TheLeague-specific domain assumption baked in (auctions, contracts, salary cap, keepers) — not just colors/names. Gate league-specific concepts behind props or `leagueHasFeature(slug, ...)` rather than hardcoding. Any leaderboard/total math must re-derive `total` from the parts after swapping a stat (`total = trades + freeAgents + thirdStat`).

---

## 2026-06-24 - Absolutely-Positioned First Child Breaks `:not(:first-child)` Margin Spacing

**Context:** The AFL homepage grid (`src/pages/afl-fantasy/index.astro`) showed a ~2rem empty band above BOTH columns — the hero and the Schefter Report sidebar floated below the grid top instead of sitting flush.

**Insight:** The left column spaced its blocks with `.afl-hp__main > :global(:not(:first-child)) { margin-top: 2rem }` (the `:global()` is required to pierce Astro's scoped styles and reach the hydrated component children). But the column's real first child is a `visually-hidden` `<h2>` accessibility landmark. Because that h2 is `position: absolute` (visually-hidden pattern) it occupies the `:first-child` slot in the selector even though it has no layout box — so the hero, the first *visible* element, matches `:not(:first-child)` and wrongly gets the 2rem top margin. The sidebar then carried a matching `margin-top: 2rem` purely to stay vertically aligned with the displaced hero, doubling the visible gap.

**Evidence:** Switching `.afl-hp__main` to `display: flex; flex-direction: column; gap: 2rem` fixed it: an absolutely-positioned flex item is removed from flex flow and is NOT spaced by `gap`, so the gap only applies between the visible blocks — no leading gap — and the inter-section 2rem is preserved. The sidebar's compensating `margin-top` was removed from the desktop rule (it only existed to offset the displaced hero) but re-added inside the single-column `@container (max-width: 880px)` breakpoint, where the sidebar stacks below the main column and the 2rem is purely visual separation, not column alignment. Verified both columns at `offsetFromGrid: 0` on desktop.

**Recommendation:** When a flow container leads with a `visually-hidden` heading (a common a11y landmark pattern), do NOT space siblings with `:not(:first-child)` margins — the hidden-but-present first child throws the selector off by one. Prefer `display: flex; flex-direction: column; gap: …` (or `display: grid; gap: …`): absolutely-positioned children drop out of flex/grid flow, so `gap` naturally ignores them and spaces only the visible items. This also removes the need for compensating margins on sibling columns.

---

## 2026-06-24 - View-Switcher Tabs: Use Server-Rendered `<a>`, Not JS Click Handlers

**Context:** The standings page tabs (Division / Playoff / All-Play, `src/components/theleague/StandingsViewSelector.astro`) were dead — clicking did nothing. The component rendered `<button>`s and attached `click` listeners in a `<script>` that ran on `DOMContentLoaded` and re-ran on `astro:after-swap`.

**Insight:** Under the layout's `ClientRouter` (View Transitions), those click listeners never bound on the navigation paths users actually took, so the buttons were inert (verified: a programmatic `.click()` did nothing, while setting `window.location.href` directly navigated fine — proving the nav logic was right and only the listener binding was broken). Astro module `<script>`s execute once per session and are NOT re-run on swapped navigations; the `astro:after-swap` re-init is fragile and easy to get wrong. For pure navigation controls this whole machinery is unnecessary.

**Evidence:** Replacing the `<button>` + script with plain `<a href>` links built server-side from `Astro.url` (`url.searchParams.set('view', key)` → `pathname + search`) fixed it instantly, works without JS, survives View Transitions, and preserves other query params (e.g. `?year=`) for free. Keep `data-active`/`aria-current` for styling and a11y; style the `<a>` like the old button (`text-decoration:none; color:inherit`).

**Recommendation:** Any tab/segmented control whose only job is to switch a URL param should render real `<a href>` anchors computed in the component frontmatter from `Astro.url` — never `<button>` + a JS click→`location` handler. Reserve client `<script>` for genuinely interactive state that can't be a link. Related: a page that reads `?view=` (or any enum param) must validate it against the known set and fall back, or an unrecognized value (stale link, typo) renders a blank page — see `src/pages/afl-fantasy/standings.astro`.

---

## 2026-06-27 - `@astrojs/react` Major Must Match Astro Major (Dev-Only Hydration Crash)

**Context:** React islands that use hooks (e.g. `SuggestionBox.tsx`, which calls `useState`) crashed in local `astro dev` with `Invalid hook call. Hooks can only be called inside the body of a function component` followed by `Uncaught TypeError: Cannot read properties of null (reading 'useState')`. Hook-*less* islands hydrated fine; only hook-*using* ones failed.

**Insight:** The cause was a major-version mismatch between the integration and the framework: `@astrojs/react@^5` (Astro 5 era) was still pinned while the app ran `astro@^6.0.8`. There was exactly ONE `react@19.2.4` / `react-dom` on disk, yet the mismatched integration made Vite split React into two instances during dev, so hooks ran against a null dispatcher. Production bundling masked the bug entirely — only `astro dev` broke, which is why CI and Vercel previews stayed green.

**Evidence:** Bumping `@astrojs/react` to `^6.0.0` and re-running `pnpm install` fully restored hydration (island sheds its `ssr` attribute, console clean, `pnpm build` passes). Known dead ends that waste time: Vite `resolve.dedupe` (only recovers hook-less islands), `optimizeDeps.include`/`force` (no effect), and `resolve.alias` of react/react-dom (actively BREAKS SSR with "module is not defined" — aliasing React's CJS entry is incompatible with Astro's ESM SSR module-runner).

**Recommendation:** When React islands fail to hydrate in dev with "Invalid hook call / more than one copy of React," check the `@astrojs/react`↔`astro` major versions FIRST — before reaching for any Vite dedupe/alias config. Keep the integration major locked to the Astro major on every Astro upgrade.

---

## 2026-06-27 - Consuming the Shared Loading System from a React Component

**Context:** Migrating the rules-chat "Ask Roger" button spinner (`src/components/shared/rules-chat/AskInput.tsx`) onto the shared loading system. The Astro `<Spinner>` primitive in `src/components/shared/loading/` can't be imported into a `.tsx` file — Astro components aren't React components.

**Insight:** The shared loading system is class-based by design precisely so non-Astro contexts can use it. From React, render the same class markup directly (`<span className="loading-spinner loading-spinner--compact" role="status" aria-live="polite" aria-label="..." />`) instead of importing a component — identical to what `src/utils/loading-html.ts` does for client-side string builders. The CSS only applies if `src/styles/loading.css` is in scope: a React island doesn't carry styles, so import `'../../styles/loading.css'` in the **host Astro page's** frontmatter (the global-scope / PlayerCell trick), not in the `.tsx`. Accent is automatic via `var(--league-accent)` (resolves blue/AFL-red by `html[data-league]`) — never branch on league.

**Evidence:** `AskInput.tsx` renders the span when `isLoading`; both `src/pages/theleague/rules-chat.astro` and `src/pages/afl-fantasy/rules-chat.astro` import `loading.css` and dropped their duplicated `.rqa-input__spinner` CSS. Verified computed `border-top-color` resolved to `rgb(28,73,124)` on TheLeague and `rgb(196,30,58)` on AFL from the one shared class. Gotcha worth remembering: the old per-screen spinner CSS was **duplicated in both league pages** — migrations like this are a 3-file change (the React component + both league host pages), not one.

**Recommendation:** When pulling a React/`.tsx` loader onto the shared system, render the shared class names directly and import `loading.css` into every Astro page that hosts the island. Grep both `theleague/` and `afl-fantasy/` for the old class — bespoke loaders are frequently copy-pasted across both leagues.

---

## 2026-06-27 - Genuinely-Interactive `<script>` Must Re-Init on `astro:page-load` — With Two Traps

**Context:** The AFL Keeper Planner (`src/components/afl-fantasy/KeeperPlanner.astro`) and the AFL roster page's view-switch script (`src/pages/afl-fantasy/rosters.astro`) did all their DOM wiring at module-eval time. Symptom: drag-and-drop, the keep/cut arrow buttons, and the Roster/Analytics/Planner tabs worked on a hard refresh but went completely dead when you reached the page via in-site (ClientRouter) navigation. A hard refresh fixed it every time — the tell-tale signature of "module script ran once, never re-ran on swap."

**Insight:** This is the same root cause as the 2026-03-13 and 2026-06-24 insights, but the fix is different because these controls *can't* be plain `<a>` links — they toggle in-page view containers instantly (no reload) and do native drag-drop. So the right move is to keep the `<script>` but move all setup into a named `init()` and register it with `document.addEventListener('astro:page-load', init)` (fires on first load AND every swap). Two non-obvious traps when doing this:
1. **Element-scoped listeners are free to re-bind; document-scoped ones are not.** Listeners attached to elements inside the swapped page (the planner root, tab buttons, selects) are safe to re-attach every `page-load` because the old DOM — and its listeners — is discarded on swap. But a listener on `document` (e.g. a delegated action-modal click handler, or a global `keydown` Escape handler) *stacks* on every navigation, so it fires N times and double-opens modals. Guard those with a module-scoped boolean (`let bound = false; if (!bound) { bound = true; document.addEventListener(...) }`) so they bind exactly once for the session.
2. **Config captured at module-eval goes stale across navigations.** The roster script read a `<script type="application/json" id="afl-roster-config">` blob once into a `const config`. After a client-side nav to a different franchise, that snapshot is wrong (stale `selectedFranchiseId`). Fix: read the JSON fresh inside the handler each time (`const config = readConfig()`), since the SSR blob in the DOM is always current for the page you're on.

**Evidence:** After wrapping both scripts in `init()` + `astro:page-load` (with the document-level delegations guarded and config re-read per click), verified via Playwright with a minted owner session: non-owner page → SPA-nav to owner planner wired up correctly (arrow 0→1, drag 1→2, tabs switch); away-to-standings-and-back re-wired with no double-binding; direct hard-load still worked; zero `pageerror`s across all paths.

**Recommendation:** For any interactive `<script>` on a page under `ClientRouter` that is NOT a pure URL-switch (those should be `<a>` links per the 2026-06-24 insight): name your setup `init()`, register it on `astro:page-load`, re-query/re-bind element-scoped listeners freely, guard every `document`-level listener behind a module-scoped once-flag, and re-read any SSR config blob inside handlers instead of capturing it at module-eval.

---

## 2026-06-28 - Forcing N Columns Over Fixed-Width Children Needs `minmax(0, 1fr)`, Not `1fr`

**Context:** The AFL franchise trophy wall (`src/pages/afl-fantasy/franchises/[id].astro`) used `grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))` for its title badges. Below ~400px only one 200px track fit, so on phones the badges stacked one-per-row. The ask was two-across down to 320px while leaving tablet/desktop untouched. First fix pinned the mobile grid to `repeat(2, 1fr)` — and the second column overflowed clean off the right edge of the viewport.

**Insight:** `1fr` is shorthand for `minmax(auto, 1fr)`, and that `auto` *minimum* resolves to the track content's min-content size. The `.badge-card` carried an explicit `width: 200px`, so each track's floor was 200px — two of them demanded 400px, well past the ~288px a 320px phone has after container padding, hence the overflow. Two independent things both had to change: (1) `repeat(2, minmax(0, 1fr))` so the tracks may shrink *below* their content's intrinsic width, and (2) reset the card's fixed width to `width: 100%` inside the mobile query so the badge fills its half instead of forcing the old 200px floor back in. Fixing only one leaves the bug. `max-width: 100%` on the card is NOT enough on its own — it caps growth but doesn't lower the track's min-content floor.

**Evidence:** With `grid-template-columns: repeat(2, minmax(0, 1fr))` + `.badge-card { width: 100%; }` under `@media (max-width: 640px)`, Playwright shots of franchise `0002` (16 trophies) at 320px and 375px showed two badges side-by-side fully inside the viewport, no horizontal overflow. 640px is the codebase's dominant phone breakpoint (85 uses vs. 41 for 767px) — scope mobile-only grid overrides there so tablet/desktop `auto-fill` behavior is untouched.

**Recommendation:** Any time you force a fixed column count (`repeat(N, …)`) over children that carry an explicit `width` (or large min-content), use `minmax(0, 1fr)` and drop/override the child's fixed width in the same breakpoint — `1fr` alone silently overflows because its `auto` floor honors the child's intrinsic size. Verify the narrowest target (320px) in a real browser, not by reasoning about it.

## 2026-06-28 - `TheLeagueLayout` Already Provides the `<main>` — Pages Must Not Add Their Own

**Context:** The AFL franchise/trophy-wall page (`src/pages/afl-fantasy/franchises/[id].astro`) wrapped its content in `<main class="franchise-detail">` with `max-width: 960px; margin: 0 auto`. The content rendered visibly narrower than the rest of the site, and the page shipped two nested `<main>` elements. A grep showed this was widespread: **35 pages** across both leagues opened their own `<main>` inside the layout.

**Insight:** `TheLeagueLayout.astro` (the shared layout for every page in both leagues) already wraps `<slot />` in `<main>` and styles that element with `max-width: 1232px; margin-inline: auto; padding-inline: var(--padding-sm); container-type: inline-size`. So a page that adds its own `<main class="...">` creates two problems at once: (1) a **duplicate landmark** — invalid HTML and an a11y violation (exactly one `<main>` per page), and (2) a **redundant/competing width constraint** — the page's own `max-width` (here 960px) further narrows content that the layout already capped at 1232px. The layout's `main { … }` block is Astro-scoped, so it does NOT cascade onto a page's inner `<main>`; the inner element only ever picked up the page's own narrower rule, which is why the trophy wall looked boxed-in.

**Evidence:** Converting `<main class="franchise-detail">` → `<div class="franchise-detail">` and deleting `max-width: 960px; margin: 0 auto` let the page fill the layout's 1232px container (hero banner full-width, trophy grid +1 badge per row). Keep the wrapper's horizontal padding at `var(--spacing-md, 16px)` — sibling AFL pages (`keepers.astro`, `calendar.astro`) add that gutter on top of the layout `<main>`'s `padding-inline` (`--padding-sm` 8px mobile / `--padding-md` 16px desktop), so zeroing it makes the trophy wall hug the screen edges more than every other AFL page (most visible at 320–375px). The franchise wrapper is the only one of the 35 pages with its own width/padding rules; the other 34 are a pure `<main>`→`<div>` swap that's visually inert. A bare-`main`-selector grep across all 35 pages returned zero CSS targeting the element, so the swap (keeping the class) was safe everywhere; those 34 pages were pixel-identical before/after.

**Recommendation:** Pages rendered inside `TheLeagueLayout` should use a plain `<div>` (or `<section>`) as their top-level wrapper, never `<main>` — the layout owns the one main landmark and the 1232px content width. If a page needs to be narrower than 1232px, scope a `max-width` to an inner wrapper, not a second `<main>`. When auditing for this, grep `src/pages` for `<main` among files importing the layout; a child `<main>` is the tell.

---

## 2026-06-29 - Historical Team Identities Carry Dead Remote Asset URLs

**Superseded 2026-07-03:** the workaround below (fall back to the franchise's present-day identity for images) is no longer the recommended fix. The root cause — dead `theleague.us`/`dynastytheleague.com`/`afl-fantasy.com` URLs in `history[]` entries — was fixed by recovering the actual historical banner/icon art (Wayback Machine + still-live mirrors) into `public/assets/{theleague,afl}/history/` and pointing the config at those local files. Year-resolved `icon`/`banner` now load correctly for the vast majority of historical entries; see the 2026-07-02 entry in `mfl-api.md` ("Pre-2016 Feeds Fetched With L=13522...") for the recovery method, and the "Asset Library" entry below for how the recovered art surfaces in the UI. The still-true parts of this entry: the general warning to never assume a year-resolved image loads without checking `naturalWidth > 0`, and — for the handful of identities where no art was ever recoverable — a text-name fallback (not the present-day-identity swap) is now the pattern, guarded by comparing against `HISTORICAL_TEAM_BANNER_FALLBACK`/`HISTORICAL_TEAM_ICON_FALLBACK` from `team-names.ts`.

**Context:** The branded division-standings header shows the defending champion's logo, and historical season views (`?year=2024` etc.) show each team's banner. Both broke: the images pointed at `https://theleague.us/images/team_banners/…` URLs that no longer resolve.

**Insight:** The `history[]` entries in `theleague.config.json` (resolved by `resolveConfigForYear()` / `getTeamIdentityForYear()`) store their `icon`/`banner` fields as **remote theleague.us URLs, which are dead** — unlike current-year entries, which use working local `/assets/theleague/…` paths. The earlier "Franchise History System" insight above says `identity.icon` and `identity.banner` "resolve correctly" — they resolve to the historically-accurate *value*, but the URL itself 404s for most teams. So year-resolving a config is correct for **names** but currently unsafe for **images**.

Corollary gotcha: "current identity" must come from the **base config** (`leagueConfig.teams`, keyed by `franchiseId`), not from `resolveConfigForYear(config, selectedYear)` — when the user is *viewing* a past year, the selected-year resolution IS the historical one, and you inherit the dead URLs. This exact bug shipped twice in one session before being caught. This specific corollary still applies to non-image identity fields (e.g. a "defending champion" medallion is deliberately the CURRENT logo, not the historical one) — only the image-fallback strategy above changed.

**Evidence:** `src/pages/theleague/standings.astro` — `currentIdentityById` is built from `leagueConfig.teams` directly with a comment explaining why; on `?year=2024`, 9 of 16 row banners and 4 of 4 champion icons 404'd when using year-resolved assets, 0 after switching.

**Recommendation (superseded — see note above):** ~~When displaying a logo/banner for historical data, either (a) use the franchise's present-day identity from the base config keyed by franchise id, or (b) fix the history entries to point at local assets if the historical artwork actually exists locally.~~ Prefer (b) — go recover the real art — over (a) whenever the artwork can be found; only fall back to text/placeholder when it's genuinely unrecoverable. Never assume a year-resolved `icon`/`banner` loads without checking `naturalWidth > 0` in a real browser.

---

## 2026-07-03 - Asset Library "Former Team" Cards: Merge by Name, Not by Franchise ID

**Context:** `src/pages/theleague/assets.astro` and `afl-fantasy/assets.astro` render a card per historical team identity, sourced from `theleague.config.json` / `afl.config.json` `teams[].history[]` entries. Naively emitting one card per history entry produced duplicates: a franchise slot that changed hands (e.g. CSKA Sofia moving from franchise 0016 to 0004 in a conference realignment) showed as two separate cards, and a team whose recovered art happened to be byte-identical under two different labels (e.g. "ATF" / "Alcohol, Tobacco and Firearms") also duplicated.

**Insight:** The fix lives entirely in `scripts/sync-{theleague,afl}-assets.mjs`, not the page templates — the sync scripts build `theleague.assets.json` / `afl.assets.json`, and three merge passes run there before cards ever reach Astro:
1. **Group by identity name** (not by `franchiseId`) when building "former" cards, so the same team name across two franchise slots collapses into one card with a unioned `ids` set and all art variants pooled.
2. **Merge groups whose art is byte-identical** (compare the *set* of asset relativePaths, not filenames) — same team, two labels. The fuller/longer name wins the card title; the shorter one becomes a parenthetical and a searchable alias, e.g. `"Alcohol, Tobacco and Firearms (ATF)"`.
3. **Coalesce eras and fold into an active card when the name matches a current team** — a historical era whose name equals a live team's current name (owner kept the identity through a slot move) folds its art into that Active-Teams card instead of spawning a separate Former-Teams entry; the card then shows a "Formerly: <years> · <conference> (slot <id>)" line built from the coalesced era list.

Each merge pass is driven by the config data alone (`history[].name`, `history[].conference`, the resolved asset paths) — no page-level special-casing per team was needed once the sync script did this correctly.

**Recommendation:** When a franchise's identity should be modeled as *continuous* across a slot swap (same owner, moved franchise IDs), add an `ownerHistory` entry on the current team (same mechanism as TheLeague's Midwestside 0010→0011) rather than trying to fake continuity in the asset-library layer — `ownerHistory` is the source of truth other owner-aware features (preferred-team highlighting) will eventually read, while the asset-library merge is purely presentational and re-derives from whatever the config says. Never assume franchise-ID continuity implies owner continuity, or that a name repeating on two slots implies the *same* owner — verify against the per-year MFL `league.json` franchise list (and ask, if it's not obvious from the data) before wiring an `ownerHistory` link.

**Follow-up gotchas found fixing bad merges (2026-07-03):**

- **The byte-identical-art merge (pass 2) is a genuine identity-equality check ONLY if the underlying art is actually a match, not a stand-in.** TheLeague's franchise 0004 had "Las Vegas Elite" split into two `history[]` entries (2007–2016, 2017) where the 2017 entry's `icon`/`banner` had been pointed at "The Art of War"'s recovered art as a placeholder (no unique 2017-specific art existed at recovery time) — the SAME art also legitimately backed a separate 2018 "The Art of War" entry. Pass 2 correctly saw identical relativePaths and merged "Las Vegas Elite" and "The Art of War" into one card, but MFL's own per-year `league.json` records show these were genuinely different identities in sequence (2007–2017 Las Vegas Elite, then 2018 The Art of War) — the placeholder-art choice, not the merge logic, was the bug. **Never point one identity's art at another identity's recovered art as a stand-in** — leave the field absent (falls back to the placeholder SVG + text) rather than borrowing a sibling era's real art, or the byte-identical merge pass will conflate them later.
- **`entry.icon`/`entry.banner` paths not under `/history/` are silently dropped from the `historyCards` pipeline** (the `assetPairs` filter requires `.includes('/history/')`). This is intentional for cases where the path IS the current active team's own icon (avoids a redundant "former" card duplicating the active card's art) — the generic per-league folder scan at the top of the sync script independently discovers and attaches those files to the matching active/former card by filename-slug, so nothing is lost. But that generic scan only walks its OWN league's asset directory (`sync-theleague-assets.mjs` never reads `public/assets/afl/**` or vice versa) — pointing a history entry's icon at the OTHER league's asset path (e.g. reusing an AFL team's icon for a TheLeague historical identity) resolves fine at request-time (same Vercel domain serves both) but produces zero pickup in either league's generated `assets.json`, silently losing the Icons bucket on that card. Fix: copy the file locally into the consuming league's own `public/assets/<league>/history/` directory and point the config at that local copy — never reference the other league's folder directly in a history entry.

---

## 2026-07-03 - `set:html` Content Escapes Astro Scoped Styles — Target It via `:global()` Descendants

**Context:** Adding copy-to-clipboard buttons to the Asset Library pages (`src/pages/{theleague,afl-fantasy}/assets.astro`), the two SVG icons (copy + check) were defined once in frontmatter as a template string and injected into each button with `set:html={copyIcons}` to avoid repeating the markup 4× per page.

**Insight:** HTML injected via `set:html` does NOT receive the page's `data-astro-cid-*` scoping attribute, so scoped rules like `.icon--check { display: none }` compile to `.icon--check[data-astro-cid-xxx]` and never match the injected SVGs. The buttons themselves ARE scoped (they're real template elements), so the fix is to anchor on the scoped parent and pierce with `:global()` for the injected children: `.copy-btn :global(.icon--check) { display: none }` and state variants like `.copy-btn.copied :global(.icon--copy)`. Same rule applies to any dynamically-inserted DOM (`innerHTML`, `insertAdjacentHTML`, client-side row builders like `buildPlayerCellHTML`).

**Recommendation:** Whenever a scoped `<style>` needs to style markup that arrives via `set:html` or client-side injection, write the selector as `<scoped-parent> :global(<injected-class>)`. If it needs to win against another scoped rule, remember the earlier specificity insight: combine scoped class + `:global()` on the same element.

**Addendum (2026-07-03, KeeperPlanner arrows):** The `<scoped-parent> :global(child)` pattern assumes a stable scoped parent. When a component's script rebuilds *entire subtrees* with `document.createElement`/`innerHTML` (AFL `KeeperPlanner.astro`'s `renderSlots()` recreates the slot number, player wrapper, and demote arrow on every state change), per-selector `:global()` wrapping degrades into wrapping nearly the whole stylesheet. In that case flip the whole block to `<style is:global>` instead — safe when every selector is anchored under the component's own namespace (here the `.keeper-planner`/`.kp-finalize` roots plus `kp-*` classes; descendant references to shared classes like `.kp-slot__player .player-cell` are fine because they stay anchored on a namespaced ancestor), and it immunizes the component against the next JS-created element someone adds. Symptom that this bug is present: the JS-created twin of a template-rendered element (e.g. the demote arrow vs. the promote arrow) renders as an unstyled default browser button while its sibling looks correct.

---

## 2026-07-03 - Preview-Tool Verification: a 0×0 Viewport Tab Silently Swallows Clicks and Freezes Screenshots

**Context:** Verifying the Asset Library copy buttons with the `preview_*` MCP tools, `preview_click` reported "Successfully clicked" repeatedly while a capture-phase `document.addEventListener('click', …, true)` probe recorded zero events, and `preview_screenshot` returned byte-identical stale images across different scroll positions.

**Insight:** The headless preview tab can end up with `window.innerWidth === 0 && window.innerHeight === 0` (backgrounded/unsized tab). In that state coordinate-based clicks never land on the page (elementFromPoint is null everywhere) and the compositor stops repainting, but the tools still report success — so "click then assert" verification silently proves nothing. `preview_resize` to explicit dimensions (e.g. 1280×800) restores `elementFromPoint` hit-testing, but input dispatch and screenshots may STAY broken for the session. Reliable fallbacks: (1) verify handlers via `preview_eval` with programmatic `el.click()` — delegation and handler logic run fine, but note `navigator.clipboard.writeText` rejects without user activation, so instrument it (monkey-patch to log calls) instead of asserting on its success; (2) verify visual states by toggling the state class directly and reading `getComputedStyle`; (3) verify truncation/overflow with `scrollWidth > clientWidth` + `getBoundingClientRect` comparisons rather than screenshots.

**Recommendation:** Before trusting any `preview_click`/`preview_screenshot` result, sanity-check `preview_eval → ({vw: innerWidth, vh: innerHeight})`. If it's 0×0, resize first, and if clicks still don't reach a probe listener, switch to DOM/CSSOM assertions via `preview_eval` — don't burn turns fighting scroll/coordinate races (this page's lazy-loaded images with no fixed dimensions make coordinates go stale in milliseconds anyway).

---

## 2026-07-03 - Year-Selectable Pages Must Pass `resolveConfigForYear()` Output — AFL Feeds Have No Fallback Names

**Context:** `/afl-fantasy/standings?year=2013` showed every team with its 2026 name and icon ("Get off my Ditka" instead of "The Dude that Abides"). The page passed raw `afl.config.json` into `getDivisionStandings`/`getTierAllPlayStandings`, whose `enrichTeamStanding` uses the config's current `name`/`icon`.

**Insight:** This is a recurring bug *class*, not a one-off: any page with a `?year=` selector that feeds a raw league config into the standings utilities shows present-day branding for historical seasons. TheLeague standings was fixed earlier (PR #253-era), AFL standings this session; AFL playoffs (`src/pages/afl-fantasy/playoffs.astro`) had the same bug and was spun off as its own task. Two AFL-specific facts make this worse than on TheLeague:

1. **AFL per-year `standings.json` feeds carry NO franchise names** (`fname`/`name` are null), so `enrichTeamStanding`'s feed-name fallback never engages — the config is the *only* name source, and a stale config is invisible except by knowing the history.
2. Per-year `data/afl-fantasy/mfl-feeds/{year}/league.json` DOES carry that year's names+icons — it's the ground-truth for auditing config `history` completeness. As of 2026-07-03 the config resolution (history era → current fallback) was verified to match every year 2003–2026 exactly (only diff: MFL's "(Open Team)" prefix on two 2009 entries). Unlike TheLeague's dead `theleague.us` history URLs (see 2026-07-02 insight above), **all AFL history icons/banners are local files that exist** — year-resolved AFL images are safe to render directly.

Also pair the config swap with `resolvePreferredTeamIdForYear()` for the my-team highlight — the 2016→2017 AFL conference realignment moved owners between franchise slots, so highlighting the current slot ID in a pre-2017 season highlights someone else's team.

**Evidence:** `src/pages/afl-fantasy/standings.astro` (`yearResolvedConfig`, `yearPreferredTeamId`); audit script comparing resolved names to every year's `league.json` came back clean; `src/pages/theleague/standings.astro` is the reference pattern.

**Recommendation:** When touching or reviewing ANY page that reads `Astro.url.searchParams.get('year')`, grep for `resolveConfigForYear` — if the raw config reaches a standings/enrichment call, it's the bug above. Note the historical `nameMedium`/`nameShort` values on AFL `history[]` entries (added 2026-07-03) are **owner-approved by Brandon, not auto-generated** — don't regenerate or "improve" them mechanically.

---

## 2026-07-03 - Historical Season Structure Comes From Per-Year `league.json` Feeds — Identity Resolution Alone Is Not Enough

**Context:** After the identity fix above, `/afl-fantasy/standings?year=2003` still grouped teams into today's four divisions. The AFL ran SIX divisions 2003-2012 (AL North/Central/South, NL East/West/Pacific — "Pacific" was "Atlantic" in 2006) with four teams each; the four-division layout began in 2013. The AL/NL conferences themselves have existed since 2003 — a misleading comment in `afl-awards.ts` ("before the conference format") had spread the belief the conferences began ~2018, when only the conference-championship *brackets* did.

**Insight:** Year-aware pages need THREE per-year resolutions, each with its own source of truth: (1) team identity → config `history[]` via `resolveConfigForYear`; (2) tier membership → `tier-history.json` via `getTierMembership`; (3) division/conference structure → `data/afl-fantasy/mfl-feeds/{year}/league.json` via `extractSeasonStructure` + `applySeasonStructure` (`src/utils/afl-structure.ts`). The structure overlay rewrites `teams[].division/conference`, `divisions`, `conferences`, and `divisionToConference` on the already-identity-resolved config, so the standings utilities need no signature changes. Related hardening this required: `getLeagueStandings` had `seed: idx + 5` hardcoded for non-division-winners (wrong with 6 divisions — use `sortedDivWinners.length + idx + 1`), `ConferenceLeagueStandingsTable` hardcoded 2 division winners per conference for row tiers (now a `divisionWinnerCount` prop), and pre-2004 standings feeds lack the combined `divwlt`/`h2hwlt` strings while pre-2017 feeds lack `all_play_*`/`vp`/`pa` entirely — `enrichTeamStanding` now normalizes all of these so tiebreaker comparators never see `undefined` (the 2003 page crashed on `parseWLT(undefined)`, and missing all-play used to render a fabricated "0-240-0").

**Evidence:** Page-rendered 2012 division winners match `awards-history.json`'s independently computed `standings:divpct` winners for all six divisions (Drunk Indians, Vitside Mafia, Whitman's Wonders, Cliffside Killer Clowns, Delirium Tremens, No Frills). The 2003 playoff bracket feed confirms top-4-per-conference (8-team championship) + 16-team NIT — the same shape as today, so the two-conference league view is valid for ALL years, with 3 winners + 1 wild card per conference pre-2013.

**Recommendation:** Any page grouping a historical AFL season by division or conference must pass its config through `applySeasonStructure(resolveConfigForYear(config, year), extractSeasonStructure(leagueFeed))`. Candidates to check when touched: `afl-fantasy/playoffs.astro`, `AflConferencePlayoffPreview` (current-season only today, safe). Never hardcode "N division winners" or "seed N+1 starts wildcards" — derive from `conference.divisions.length` / `sortedDivWinners.length`.

---

## 2026-07-04 - Matching a Page's Content Width to the Header Requires Accounting for `<main>`'s Own Gutter Twice

**Context:** `OwnerActivityReport.astro`'s top-level `.activity-page` used `max-width: 52rem; padding: 1.5rem 1rem 3rem` (later widened to a plain `75rem`/`1180px`), but at every viewport its left/right edges sat visibly inset from `Header.astro`'s logo/nav (`.theleague-header .container`, `max-width: 1180px; padding: 0 1rem`) — never flush, off by a constant amount at any given breakpoint.

**Insight:** `TheLeagueLayout`'s `<main>` (see the entry above) is not just a width cap — it *also* carries its own horizontal padding (`padding-inline: var(--padding-sm)` i.e. `0.5rem` below 768px, then a `padding` shorthand override to `var(--padding-md)` i.e. `1rem` at ≥768px). The header lives *outside* `<main>` (a sibling in `page-wrapper`), so it has no such ancestor padding — its `1rem` gutter is the only inset it ever gets. Any page wrapper that adds its own horizontal `padding` (or a `max-width` sized without subtracting `<main>`'s padding) stacks on top of `<main>`'s gutter, insetting further than the header by whatever the page's own padding is. Because `<main>`'s gutter itself changes at the 768px breakpoint while the header's stays constant, a *single* fixed compensation only fixes one side of that breakpoint — you need the mobile case handled separately.

**Evidence:** Measured via `preview_inspect` bounding boxes (not screenshots — screenshots can't give sub-pixel offsets or isolate which ancestor owns which inset). At 1100px viewport, header content box was `x:18.3, width:1048.4`; the page section was `x:45.7, width:993.5` — a 27.4px inset on both sides, tracing exactly to a `1.5rem` vs `1rem` padding difference in a `min-width:640px` media query. Fix: drop the page's own horizontal padding entirely (rely on `<main>`'s), and size `max-width` as `calc(1180px - 2rem)` (the header's box width minus its own padding) so the two align regardless of which side of `<main>`'s 768px breakpoint you're on — except below 768px, where `<main>`'s gutter drops to `0.5rem` while the header's stays `1rem`, requiring a `max-width: 767px` override that adds the missing `0.5rem` back (`padding-left/right: 0.5rem`) to match.

**Recommendation:** To align a page's content edges with the header, never just eyeball a `max-width`/`padding` pair — get the header's real box (`preview_inspect` on `.theleague-header .container`, note its `padding` and whether it sits inside or outside `<main>`), then work out the page wrapper's own effective inset (its `max-width`/`padding` PLUS whatever ancestor padding `<main>` contributes at the current breakpoint) and reconcile the two algebraically. Verify with `preview_inspect` bounding boxes at both a sub-768px and a wide (>1180px) viewport — a screenshot alone won't reveal a few-pixel mismatch, and checking only one viewport misses a breakpoint-dependent regression.

**Also relevant — stale dev-server SSR after CSS edits:** After editing this file, `preview_inspect` in an *already-open* preview tab showed the corrected layout immediately (Vite HMR patched the live `<style>` tag), but `curl`-ing the same route fresh returned HTML with an *older* padding value — not just the previous edit, but one from **two edits prior**, i.e. the dev server's SSR output can lag behind the source by more than one change. Don't trust an open preview tab as proof the fix is live for a *new* page load (e.g. the user's own fresh browser tab) — `preview_stop` + `preview_start` (a real server restart) and re-`curl` the route to confirm the served HTML actually contains the latest values before telling the user to refresh.

**Also relevant — overlapping media queries + shorthand `padding` silently clobber each other:** The mobile fix above added `@media (max-width: 767px) { .activity-page { padding-left/right: 0.5rem } }` earlier in the file, and an existing `@media (min-width: 640px) { .activity-page { padding: 2rem 1.5rem 3rem } }` (a shorthand, reset to `2rem 0 3rem` by the main fix) appeared later. Both queries are simultaneously true for viewports 640-767px, same specificity, so **source order** decides — the later `min-width:640px` rule's shorthand reset `padding-left/right` back to `0`, silently overriding the mobile compensation for that entire 100px range. None of the viewports actually tested (390, 1100, 1273, 1400) happened to fall in the 640-767px gap, so the regression shipped invisibly. Fix: never use a shorthand `padding` in one breakpoint rule when another overlapping breakpoint rule owns just one axis (horizontal here) — use `padding-top`/`padding-bottom` longhand so the two rules don't fight over properties neither should touch. When two `@media` blocks in the same file can both match at once, test a viewport *inside the overlap*, not just outside it on both sides.
