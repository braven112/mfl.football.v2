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

## 2026-03-21 - rosters.astro Serialized Config Architecture and Data Payload

**Context:** Performance review of `src/pages/theleague/rosters.astro` (~9,888 lines, ~370KB).

**Insight:** The page uses a "config blob" pattern: all roster data for all 20 seasons is assembled server-side into `rostersBySeason`, then the entire structure (plus `collegeLogosNormalized`, `eligibilityByTeam`, `adjustmentsBySeason`, `salaryAverages`, etc.) is JSON-serialized into a `<script type="application/json" id="roster-config">` tag. A second blob, `weeklyPlayerResults`, is serialized into its own tag. The client then reads both tags on load and drives all interactivity from that config.

Key data sizes discovered:
- `import.meta.glob` loads all 20 salary JSON files eagerly at SSR time (4.4MB total raw JSON on disk); this entire dataset is processed into `rostersBySeason` — but only 1-2 seasons are used per request.
- `college-logos.json` is 79KB; it is imported server-side, normalized, and then embedded in its entirety inside `serializedConfig` (under `collegeLogos:`), which ships that entire lookup table to every client.
- The `weeklyPlayerResults` blob covers all 17 weeks of per-player fantasy data from the MFL API, cross-referenced with the NFL schedule and FPA data.
- The `players` MFL feed is fetched for `feedYears` (up to 2 years) and loaded into `playersFeedBySeason`. The full players feed contains thousands of NFL players with `DETAILS=1`. This is only used to enrich roster players; the rest is discarded during processing but still fetched over the network.
- There is no prewarming mechanism — the 2-minute in-memory cache starts cold on every Vercel function cold start, meaning the first visitor after a deploy or idle period triggers all MFL API calls in series (ESPN odds + up to 17 weekly results fetches + 5 parallel MFL feed calls × 2 years = up to ~45 network calls on a cold start).

**Evidence:**
- `src/pages/theleague/rosters.astro` lines 437–441: `import.meta.glob('../../data/mfl-player-salaries-*.json', { eager: true })` — loads all 20 files at module evaluation time.
- Lines 2072–2105: `serializedConfig` includes `collegeLogos: collegeLogosNormalized` (the full 79KB dictionary).
- Lines 4984–4988: `weeklyPlayerResults` serialized as second JSON blob.
- Lines 457–475: Two sequential `await Promise.all` calls (5 feeds + 2 feeds), each for up to 2 years = up to 14 MFL API calls.
- Lines 479–482: `getWeeklyResultsRaw` calls `getMflAllWeeklyResults` which fires weeks 1–17 in parallel = up to 17 more MFL calls.
- `src/lib/mfl-feeds.ts` line 247: `getMflAllWeeklyResults` uses 10-minute TTL but each week is its own cache key — 17 separate cold-start fetches.

**Recommendation:**
1. Filter `import.meta.glob` to current and previous year only (not all 20 years) — the UI only shows a season switcher for recent seasons.
2. Remove `collegeLogos` from `serializedConfig`. Load it lazily via `fetch('/api/college-logos')` only when the player details modal opens — this field is only needed for the modal headshot fallback chain.
3. Add a Vercel cron job (`vercel.json` `crons` field) or a `POST /api/warm-cache` route called from the deploy hook that pings the rosters page to prime the in-memory cache after every deploy.
4. Introduce a `GET /api/rosters/[season]` API route that returns pre-processed roster data for a given season as JSON, so the client can lazy-load non-default seasons on team/season switch rather than serializing all seasons upfront.
5. Evaluate splitting `weeklyPlayerResults` out of the inline blob — it is only read when the player details modal is opened, so it could be fetched on-demand from `GET /api/player-results/[season]`.
