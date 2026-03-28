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

## 2026-03-27 - Server-Only Data Files Are Safe from Client Bundle (API Routes)

**Context:** Performance review of the `/driving` Billy chatbot page. Key question: does `wa-driver-guide.ts` (~19KB) or `driving-quiz-bank.ts` (~33KB) land in the client JavaScript bundle?

**Insight:** Files imported exclusively by API routes (`src/pages/api/*.ts`) are compiled as pure server-side Node/Edge functions by Astro + Vercel. They never enter the client bundle regardless of file size. Vite's module graph treats API routes as separate server entry points with no client-side chunk. This can be verified by tracing the import graph: if a module's only importers are `src/pages/api/` files, it is server-only.

**Evidence:** `src/data/wa-driver-guide.ts` is only imported by `src/pages/api/driving-chat.ts`. `src/data/driving-quiz-bank.ts` is only imported by the same file. Neither appears in client chunks.

**Recommendation:** When auditing data file bundle risk, check the importer list. API route imports = server-only, always. The risk pattern to watch for is a data file imported by BOTH an API route AND a React component — in that case, the full file lands in the client bundle even if the component only uses a subset of the data.

---

## 2026-03-27 - Inline CSS Blocks Cannot Be Cached Independently of HTML

**Context:** `/driving` page has 863 lines of CSS in a single `<style is:global>` block inside the `.astro` file.

**Insight:** CSS inside Astro `<style>` tags (including `is:global`) is emitted as a `<style>` tag in the HTML response, not as a separate file. This means it travels with the HTML on every request and cannot be cached independently. Extracting large CSS to a static file (SCSS or `.css` imported in frontmatter) causes Astro to emit a `<link rel="stylesheet" href="/_astro/file.hash.css">` with a content-hashed URL — making it immutable and cacheable for as long as the content doesn't change.

**Rule of thumb:** Any standalone-page `<style>` block over ~100 lines is a candidate for extraction. Pages that could be prerendered benefit especially because the CDN caches the full HTML (CSS included), partially mitigating the issue — but separately-cached CSS still wins on repeat visits.

**Evidence:** `src/pages/driving.astro` lines 36–899 (863-line inline block). Pattern fix: create `src/styles/driving.css`, import in frontmatter.

---

## 2026-03-27 - Static Page Shells Can Be Prerendered Even When API Routes Are SSR

**Context:** `/driving` uses `prerender = false`, but the page shell HTML is 100% static (no auth, no SSR data). All dynamism lives in the `/api/driving-chat` API route.

**Insight:** `prerender = true` on a page shell and a server-rendered API route are fully independent in Astro + Vercel. The page HTML can be served from CDN edge (prerendered) while the API function runs on Node/Edge at request time. A standalone chatbot, tool, or form page that uses `client:load` for all interactivity almost always qualifies for `prerender = true` on the shell — the interactive content is handled by React hydration + API calls, not by SSR.

**Decision rule:** If a page's frontmatter has zero runtime data fetches (no `Astro.request`, no auth checks, no dynamic Astro.props), it should be `prerender = true`. The presence of an API route on the same page is irrelevant.

**Evidence:** `src/pages/driving.astro` — 35 lines of markup, all static. `src/pages/api/driving-chat.ts` — server function, unaffected by page prerender setting.

---

## 2026-03-27 - In-Memory Rate Limiting Is Non-Functional on Vercel Serverless

**Context:** `src/pages/api/driving-chat.ts` uses a module-level `Map<string, { count: number; resetAt: number }>` for IP-based rate limiting.

**Insight:** Vercel serverless functions are stateless — each invocation may run in a fresh instance with no shared memory. Module-level state (Maps, variables set at module scope) persists only within a single warm instance. Under any meaningful traffic, the rate limiting Map will be empty on most requests, making the rate limit effectively non-functional. This is a correctness issue, not a performance issue. Production rate limiting for Vercel deployments requires an external store (Redis via Upstash, KV, or similar) or Vercel's built-in edge middleware rate limiting.

**Recommendation:** Document the limitation with a comment, or implement rate limiting at the edge middleware layer (`middleware.ts`) using `Astro.locals` + an external KV store.

