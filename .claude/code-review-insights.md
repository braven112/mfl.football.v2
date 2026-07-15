# Code Review Insights

## Navigation Components Review (2026-01-18)

### Design Token Compliance - EXEMPLARY

All navigation components demonstrate excellent design token usage:

- **_nav-tokens.scss**: Comprehensive token system with light/dark mode support and fallbacks
- All CSS custom properties properly prefixed with `--nav-` convention
- Dark mode handled through both `@media (prefers-color-scheme: dark)` and `.dark` class selectors
- Proper z-index layering (900-970) preventing stacking context issues
- Dimension tokens (spacing, border-radius, sizes) consistently applied
- Transitions use token-based timing functions and durations
- No hardcoded hex colors in components; all use CSS variables with appropriate fallbacks

**Key Pattern**: Design tokens set in SCSS file, consumed via `:root` and `@media`/`.dark` selectors. Components use fallback syntax (`var(--nav-bg, #ffffff)`) for graceful degradation.

### TypeScript Type Safety - EXCELLENT

Navigation types are exceptionally well-structured:

- **src/types/nav.ts**: Comprehensive, well-documented type definitions
- Proper use of discriminated unions via `NavLinkVisibility` type
- Clear separation of concerns: `NavLink`, `NavSection`, `NavFooter*`, `NavDrawerState`, etc.
- Props interfaces properly extend base interfaces when applicable
- Cookie names defined as constants with TypeScript `as const` for type safety
- No `any` types; all properties properly typed
- Good JSDoc comments on every interface explaining purpose

**Key Pattern**: Type files serve as API contracts; components import and extend these types for guaranteed consistency.

### Accessibility - COMPREHENSIVE

Navigation components implement WCAG 2.1 AA compliance:

- **Focus Management**: Focus trap correctly implemented with Tab/Shift+Tab handling
- **ARIA Attributes**:
  - `role="dialog"` + `aria-modal="true"` on drawer
  - `aria-expanded` on toggle buttons
  - `aria-controls` linking buttons to controlled elements
  - `aria-hidden` for decorative elements (SVGs, pseudo-elements)
  - `aria-current="page"` for active links
  - `aria-label` with contextual descriptions
- **Keyboard Navigation**: Escape key closes drawer, Tab navigation trapped
- **Screen Reader Support**: Live region (`#nav-drawer-announcer`) for state announcements
- **Touch Targets**: 44x44px minimum via `--nav-touch-target-min` token
- **Semantic HTML**: Proper use of `<header>`, `<nav>`, `<footer>`, `role="list"` on `<ul>`
- **Tooltips**: Proper `role="tooltip"` attributes

**Key Pattern**: Accessibility is first-class concern, not an afterthought. Every interactive element has aria labels and proper semantic structure.

### Code Organization - EXEMPLARY

Clear separation of concerns across multiple specialized files:

- **Component Hierarchy**:
  - `NavDrawer.astro`: Main container managing state
  - `NavHeader.astro`: Fixed header with league switcher
  - `NavLinks.astro`: Scrollable link section (handles visibility logic)
  - `NavFooter.astro`: Fixed footer with team info/verify prompt
  - `NavToggleButton.astro`: Reusable hamburger button
  - `LeagueSwitcher.astro`: League toggle component

- **Utilities**:
  - `nav-utils.ts`: All visibility, routing, URL building, cookie logic
  - `nav-config.ts`: Type-safe config access with helper functions

- **Types**:
  - `nav.ts`: Complete type definitions with constants

**Key Pattern**: Concerns properly separated; logic extracted to utilities to avoid duplication.

### Reusability - STRONG

Components are well-designed for reuse:

- **NavToggleButton**: Generic hamburger component, can be used in any context (header, breadcrumb)
- **LeagueSwitcher**: Standalone component for league switching with smart routing
- **Utility Functions**: All business logic (visibility, routing, cookies) available for external use
- **Props Interfaces**: Well-defined, extend base interfaces for consistency

**Opportunities for Enhancement**:
- `NavLinks` component handles visibility filtering inline; could extract to utility for testing
- Footer team/verify rendering could be split into separate sub-components
- Collapse/expand button logic duplicated in CSS and JS; consider extracting to utility component

### CSS Architecture - EXCELLENT

SCSS organization is exemplary:

- **BEM Naming Convention**: Consistent use of `.nav-component__element--modifier`
- **Scoped Styles**: Components have their own `<style>` blocks, no global pollution
- **Custom Property Usage**: All values reference tokens with fallbacks
- **Responsive Design**: Proper mobile-first approach with `@media (min-width:...)` breakpoints
- **Reduced Motion**: All animated components have `@media (prefers-reduced-motion: reduce)` rules
- **Scrollbar Styling**: Custom scrollbar implementation using CSS properties
- **State Management**: CSS classes properly manage states (`--open`, `--collapsed`, `--active`)

**Key Pattern**: Separation via `:global(.dark)` selector for dark mode specifics; design tokens handle most styling automatically.

### JavaScript Quality - VERY GOOD

Client-side code is well-structured:

- **NavDrawer Script**:
  - Clear separation of concerns (state management, event handlers, utilities)
  - Good use of helper functions (getFocusableElements, handleFocusTrap, announce)
  - Proper event listener cleanup
  - Cookie handling with SameSite security attributes
  - ResizeObserver for responsive behavior with fallback to resize event
  - API exposed via `window.navDrawer` for external control

- **Potential Improvements**:
  - Cookie setting logic duplicated in NavDrawer script and nav-utils.ts (not DRY)
  - `getCookie`/`setCookie` functions exist in both places; should be unified
  - No error handling for missing DOM elements (defensive checks exist but could be more robust)

### Documentation - EXCELLENT

Each component has comprehensive JSDoc:

- **File Headers**: Purpose, features, related files clearly documented
- **Function Comments**: Purpose, parameters, return types explained
- **Type Comments**: Inline comments on complex types
- **Example Usage**: `@example` blocks show how to use components
- **References**: Links to related files and configuration

### Configuration - SOUND

- **nav-config.ts**: Type-safe wrapper around JSON config
- **Helper Functions**: getAllSections, getSectionById, etc. provide clean API
- **Admin ID Checks**: Centralized via `isAdminFranchise()` function
- **Route Equivalence**: Support for mapping paths between leagues (future-proof)

### Integration Points - WELL-DESIGNED

- **TheLeagueLayout.astro**: Clean integration of NavDrawer
- **myteam URL Parameter**: Properly parsed and set via cookies
- **Team Info Resolution**: Config-based lookup with fallback
- **Visible Sections Calculation**: Server-side filtering before rendering
- **Page Wrapper Sync**: MutationObserver pattern for drawer state sync

## Critical Issues

### NONE FOUND
This is exceptionally well-crafted code. No critical issues detected.

## Important Improvements

### 1. Cookie Utility Duplication (Medium Priority)

**Issue**: Cookie functions exist in both `NavDrawer.astro` script and `nav-utils.ts`

**Current State**:
- `NavDrawer.astro` (lines 557-575): `setCookie`, `getCookie`
- `nav-utils.ts` (lines 386-430): `getCookie`, `setCookie`, `deleteCookie`

**Recommendation**:
- Remove duplicate functions from NavDrawer script
- Import from nav-utils.ts instead
- Ensures single source of truth

**Code Change**:
```typescript
// In NavDrawer.astro script, replace setCookie/getCookie with imports:
import { setCookie, getCookie } from '../../utils/nav-utils';
```

### 2. NavLinks Visibility Logic Could Be Testable Utility

**Issue**: Visibility filtering logic in NavLinks.astro (lines 54-177) is not easily unit testable

**Current Implementation**: Inline component logic

**Recommendation**: Extract to `getVisibleSectionsWithLinks()` utility function similar to what's in nav-utils.ts

**Benefit**: Would enable testing without Astro component context

### 3. LeagueSwitcher Tooltip on Collapsed Button Uses CSS ::after

**Issue**: Line 242-266 in LeagueSwitcher.astro uses CSS `::after` pseudo-element with `attr(title)` for tooltip

**Risk**: `attr()` function in content property has limited browser support and doesn't read HTML attributes reliably

**Better Approach**: Render actual span with role="tooltip" like NavFooter does

```astro
{isCollapsed && (
  <span class="league-switcher__tooltip" role="tooltip">
    {`Switch to ${isTheLeagueActive ? 'AFL Fantasy' : 'TheLeague'}`}
  </span>
)}
```

## Suggestions

### 1. Collapse/Expand Button Positioning

**Current**: Hard-coded `top: 120px` in NavDrawer.astro (line 333)

**Suggestion**: Calculate based on header height and make configurable
```css
top: calc(var(--nav-header-height, 72px) + 24px);
```

### 2. Mobile Breakpoint Consistency

**Current**: Mobile breakpoint defined in multiple places:
- `_nav-tokens.scss` (line 304): `--nav-breakpoint-mobile: 768px`
- `NavDrawer.astro` script (line 487): `const MOBILE_BREAKPOINT = 768`
- Layout media queries (line 1024px for desktop)

**Suggestion**: Use CSS custom property in JavaScript:
```typescript
const MOBILE_BREAKPOINT = parseInt(
  getComputedStyle(document.documentElement).getPropertyValue('--nav-breakpoint-mobile')
);
```

### 3. NavHeader Dark Mode Text Colors

**Current**: Lines 188-194 in NavHeader.astro hardcode colors in dark mode:
```css
:global(.dark) .nav-header__league-name--the {
  color: #60a5fa;
}
```

**Suggestion**: Create tokens for these in _nav-tokens.scss instead of hardcoding

### 4. Reduce Magic Numbers in NavToggleButton

**Current**: Line 128 in NavToggleButton.astro: `top: -8px`

**Suggestion**: Create token `--nav-hamburger-line-gap: 8px` in _nav-tokens.scss

### 5. NavFooter Verify Button Copy Not Externalized

**Current**: Copy strings hardcoded in NavFooter.astro (lines 116-117):
- "Verify Your Team"
- "Link your MFL account"

**Suggestion**: Consider i18n/externalization for future multi-language support

## Design Token Compliance Assessment

### Compliant Areas (GREEN)
- All color usage follows design token pattern
- Spacing consistently uses token scale
- Typography follows token-based sizing
- Border-radius uses defined tokens
- Transitions use token-based durations and timing functions
- Z-index follows defined layer system
- Touch targets respect minimum size token
- Dark mode properly handled through token overrides

### Areas Needing Attention (YELLOW)
- NavHeader hardcodes some dark mode colors instead of using tokens (minor)
- Collapse button position uses magic number instead of token-derived calculation (minor)
- Hamburger line gaps not token-based (very minor)

## Reusability Assessment

### Current Reusable Components
- **NavToggleButton**: Used in Header.astro, could be used anywhere
- **LeagueSwitcher**: Standalone league switching component
- **nav-utils.ts**: All URL building, visibility, routing logic available for reuse

### Could Be More Reusable
- Extract NavFooter team section into separate component
- Extract NavFooter verify section into separate component
- Consider extracting section header/separator rendering to utility

### Auction Price Predictor Readiness
Per CLAUDE.md requirement that "ALL features, utilities, and data structures should be designed with Auction Price Predictor in mind":

- **Visibility Logic**: Well-designed for feature gates, perfect for AuctionPP
- **League Context**: Properly supports multi-league, future-proof
- **URL Building**: Clean template-based system for MFL integration
- **Team Info**: Lightweight struct for personalization in AuctionPP
- **Route Mapping**: Route equivalence allows same page in different leagues

**Recommendation**: These utilities are in good shape for AuctionPP reuse. No additional design changes needed.

## Repository Guidelines Compliance

### Year Rollover System
- Component properly uses `getCurrentLeagueYear()` in Layout (CORRECT)
- Passes year to NavDrawer for MFL links (CORRECT)
- No hardcoded years found (CORRECT)

### Team Name Display
- Not directly used in nav components (N/A)
- Team data handled via `NavTeamInfo` interface (CORRECT)

### Team Personalization
- Cookie-based storage of myteam (CORRECT)
- Server-side parsing of myteam URL parameter (CORRECT)
- Proper use of team preferences pattern (CORRECT)

### League Context
- Dual-league support properly implemented
- LeagueSwitcher handles smart routing between leagues
- All links respect league context (CORRECT)

## Performance Considerations

### Strengths
- Server-side rendering of visible sections (no client-side filtering overhead)
- CSS-based animations use hardware-accelerated properties (transform, opacity)
- ResizeObserver instead of polling for responsive changes
- Lazy loading support on images (NavFooter line 74)
- SVG sprites used for icons (efficient)

### Potential Optimizations
- NavDrawer script uses querySelectorAll repeatedly; could cache selectors
- Focus trap uses getFocusableElements on every keydown; could optimize with memoization

## Key Patterns to Document

1. **Design Token Pattern**: CSS custom properties with fallbacks, overridden for dark mode
2. **Component Composition**: Small, focused components that compose into larger widgets
3. **Visibility Logic**: Separate from rendering, easy to test and reuse
4. **Type-Safe Configuration**: TypeScript wrappers around JSON configs
5. **Accessibility First**: Every component considers a11y from start
6. **Cookie-Based Persistence**: State persisted via cookies with server-side awareness
7. **Smart Routing**: Route equivalence maps allow flexible league switching

## Recommendations for Future Work

1. **Extract Visibility Logic to Utilities**: Make `NavLinks` filtering testable separately
2. **Consolidate Cookie Utilities**: Use nav-utils functions everywhere
3. **Add Storybook Examples**: Components would benefit from visual testing
4. **Create Route Equivalence Config**: Define all route mappings in nav-config.json
5. **Consider Icon Component**: Extract SVG sprite usage to component for consistency
6. **Dark Mode Testing**: Ensure all hard-coded dark mode colors become tokens

---

## View Transitions Support Review (2026-01-18 - NEW SESSION)

### Overview
Recent changes added View Transitions support and refined navigation persistence logic. The implementation demonstrates good understanding of page transition requirements and state management.

### Key Changes Analyzed

#### 1. NavDrawer.astro - `no-transition` Class Implementation
**Status**: CORRECT
- **Lines 113, 253**: `nav-drawer--no-transition` class prevents animation flashing on initial page load
- **Lines 836-838**: Properly removes class after initial render with `requestAnimationFrame`
- **Pattern**: Follows standard View Transitions approach (hide animation on first render, enable afterward)
- **Accessibility**: No impact on screen readers or keyboard navigation

**Code Quality**: Excellent. Proper use of timing to avoid FOUC (Flash of Unstyled Content).

#### 2. NavLinks.astro - Query Parameter Handling
**Status**: EXCELLENT - Well-Implemented
- **Line 244**: `data-astro-reload={true}` correctly applied to links with query params
- **Lines 230, 159**: `hasQueryParams` variable properly detects `?` in href
- **Lines 158-178**: `isActive()` function correctly prioritizes exact match logic

**Active State Logic Review**:
```typescript
// Line 154-156: Exact match (path + query string)
if (currentPath === href) {
  return true;
}

// Line 159-164: If link has query params, require exact match
const linkHasQueryParams = href.includes('?');
if (linkHasQueryParams) {
  return false;
}

// Line 168-177: For links without query params, only match if no query string on current page
const currentHasQueryParams = currentPath.includes('?');
if (currentHasQueryParams) {
  return false;
}
```

**Why This Is Correct**:
1. Prevents `/rosters` from being highlighted when viewing `/rosters?view=nextyear`
2. Requires exact query string match for parameterized links
3. Handles all edge cases properly

**Design Pattern Observation**: This demonstrates understanding of URL state and view routing. Excellent for future Auction Price Predictor usage where parameterized views are common.

#### 3. NavToggleButton.astro - Visibility Handling
**Status**: CRITICAL ISSUE FOUND
- **Line 149**: `visibility: hidden` combined with `opacity: 0`

**The Problem**:
```css
.nav-toggle-btn--open {
  visibility: hidden;  /* Problem: Removes from tab order! */
  opacity: 0;         /* This alone would be sufficient */
}
```

**Impact**:
- The button is removed from the tab order when drawer is open
- Users relying on keyboard navigation cannot access this button
- Creates an WCAG violation (focus management issue)

**Why This Is Wrong**:
- When drawer is open on mobile, the toggle button should remain focused/focusable
- `visibility: hidden` hides from both visual and accessible rendering
- Should use only `opacity: 0` + `pointer-events: none` for keyboard-accessible hiding

**Recommended Fix**:
```css
.nav-toggle-btn--open {
  opacity: 0;
  pointer-events: none;
  /* Remove visibility: hidden */
}
```

#### 4. TheLeagueLayout.astro - currentPath with Query String
**Status**: CORRECT
- **Line 99**: `const currentPath = Astro.url.pathname + Astro.url.search;`
- **Justification**: Allows NavLinks to match exact URLs including query parameters
- **Server-side**: Computed server-side, no client-side overhead
- **Passes correctly to NavDrawer**: Line 143 passes to component

**Design Pattern**: Well-done. This is the correct approach for handling query-parameter-based views in server-rendered Astro components.

#### 5. nav-config.json - my-team Visibility Change
**Status**: CORRECT (Configuration Change)
- **Line 107**: `"visibility": "admin"` on "my-team" section
- **Rationale**: Only admin/franchise owners should see personalized team tools
- **Scope**: Affects lines 108-133 (Coach Tab, Auction Predictor, Team Preview)
- **Impact**: Properly hides section from users without admin access

**Verification**:
- NavLinks.ts (lines 54-63) correctly checks this visibility
- TheLeagueLayout.ts (line 108) calls `getVisibleSections()` before rendering
- No orphaned links remain

---

## New Issues Identified

### CRITICAL - NavToggleButton Accessibility Issue
**Severity**: CRITICAL - WCAG Violation
**File**: `src/components/nav/NavToggleButton.astro`
**Line**: 149
**Issue**: Using `visibility: hidden` removes button from keyboard navigation

**Current Code**:
```css
.nav-toggle-btn--open {
  visibility: hidden;  /* PROBLEM */
  opacity: 0;
}
```

**Impact**:
- Keyboard users lose ability to close drawer when button is "hidden"
- Creates WCAG 2.1 Level A violation
- Focus management broken

**Solution**:
```css
.nav-toggle-btn--open {
  opacity: 0;
  pointer-events: none;
}
```

### IMPORTANT - Cookie Utilities Duplication Persists
**Severity**: IMPORTANT - Maintenance Concern
**File**: `src/components/nav/NavDrawer.astro`
**Lines**: 581-599
**Issue**: `setCookie`/`getCookie` still defined in script block despite utility functions in nav-utils.ts

**Current State**:
- NavDrawer.astro lines 581-599: Local implementation
- nav-utils.ts lines 386-430: Same functions already exist

**Why This Matters**:
- Changes to cookie security requirements require two updates
- Increases debugging difficulty
- Violates DRY principle

**Recommendation**:
Extract to utility imports (as originally documented in insights, but still not implemented)

---

## Positive Findings

### 1. View Transitions Integration - Excellent
- `<ViewTransitions />` properly imported in TheLeagueLayout (line 18, 122)
- `astro:page-load` event listener correctly reinitializes NavDrawer (line 885)
- Page wrapper sync also reinitialized (line 362)
- No race conditions detected

### 2. Query Parameter Handling - Industry Standard
The implementation of exact-match logic for parameterized links (NavLinks.astro lines 145-178) is how modern SPAs handle URL-based view routing. Perfect for scaling to Auction Price Predictor.

### 3. Mobile/Desktop Persistence - Well-Designed
- Server-side cookie reading (NavDrawer lines 72-77)
- Client-side initialization properly respects viewport (lines 828-853)
- No hardcoded assumptions about device state

### 4. Server-Side Rendering Optimization
- Visibility filtering happens server-side before component render (TheLeagueLayout line 108)
- Reduces client-side processing
- Better performance than client-side filtering

---

## Summary for Current Session

### What's Working Well
1. View Transitions integration is properly implemented
2. Query parameter handling is correct and follows modern patterns
3. Server-side rendering optimizations are in place
4. Cookie persistence logic is sound (despite duplication)
5. Configuration changes to nav-config.json are properly applied

### What Needs Fixing
1. **CRITICAL**: NavToggleButton accessibility issue (visibility: hidden)
2. **IMPORTANT**: Consolidate cookie utilities to avoid duplication

### What's Ready for Auction Price Predictor
- Query parameter routing system is production-ready
- Server-side visibility logic is flexible for feature gates
- URL building templates in nav-config.json support parameterized links
- No architectural changes needed before AuctionPP integration

The navigation system is substantially complete and ready for feature expansion.

---

## DraftViewSelector button-to-link refactor (2026-06-24, PR #274)

### Pattern: button-to-anchor migration checklist

When converting `<button>` elements to `<a>` links (e.g. for view-transition compatibility):

1. **Add `text-decoration: none; color: inherit;`** — browsers apply link styling by default.
2. **Add `focus-visible` ring** — `<button>` gets a browser default focus ring; `<a>` does not. Always add:
   ```css
   .component:focus-visible {
     outline: 2px solid var(--color-primary, #1c497c);
     outline-offset: 2px;
   }
   ```
3. **Switch `aria-pressed` → `aria-current="page"`** — for page-navigation links, `aria-current="page"` is the correct semantic attribute (not `aria-selected` which belongs to `role="tab"` patterns).
4. **Keep `title` attribute** — preserved correctly in this PR; tooltip is valuable for icon-only tabs at small viewports.

### Root cause pattern: Astro ClientRouter + `DOMContentLoaded` / `astro:after-swap`

Event handlers registered inside `DOMContentLoaded` do NOT re-bind after ClientRouter navigations because the script block itself doesn't re-execute — only `astro:after-swap` fires. However, if the component is re-rendered fresh by ClientRouter, the new DOM elements exist but the script from the *previous* page's component is the one running. The correct fix is to eliminate the JS dependency entirely (server-render the URLs as `<a href>`) rather than adding more lifecycle events.

### Design Token Violations in DraftViewSelector (pre-existing, flagged in review)

These hardcoded colors exist in `src/components/theleague/DraftViewSelector.astro` and should be converted:

| Hardcoded value | Suggested token |
|---|---|
| `#f8fafc` (default bg) | `var(--color-gray-50, #f8fafc)` |
| `#e2e8f0` (hover bg) | `var(--color-gray-100, #e2e8f0)` |
| `#cbd5e1` (hover border) | `var(--primary-content-border-color, #cbd5e1)` |
| `#dbeafe` (active bg) | `var(--view-tab-active-bg, rgba(28,73,124,0.1))` |
| `#3b82f6` (active border/label) | `var(--color-primary, #1c497c)` |
| `#64748b` (label color) | `var(--color-gray-500, #64748b)` |

The active-state color mismatch (blue-500 vs site primary `#1c497c`) is the most impactful — it creates an inconsistency with every other interactive element on the site.

### VALID_VIEWS / Props type divergence pattern

`draft-predictor.astro` defines `VALID_VIEWS = ['projected', 'final', 'history'] as const` which is a parallel source of truth to the `Props` union type in `DraftViewSelector.astro`. When view names are stable this is low risk, but it is a known pattern to watch for. If a view is added, both must be updated. Consider exporting the view type or constant from the component file for external consumers.

---

## Per-League `<head>` Metadata — TheLeagueLayout Favicon Gate (2026-06-25, PR #277)

### Pattern: Registry-based slug comparison in Astro frontmatter

When gating `<head>` content on league identity, compare against `leagueContext.slug` (the canonical slug from the registry, e.g. `'afl-fantasy'`) rather than the derived `league` nav-slug (`'afl'`). The nav-slug is a UI concern; the canonical slug is the stable identity.

**Violation pattern found:** `league === 'afl'` in `TheLeagueLayout.astro:178` hardcodes the `navSlug` string rather than importing from the registry. The correct form:
```ts
import { LEAGUES } from '../config/leagues';
const league: LeagueSlug = leagueContext.slug === LEAGUES['afl-fantasy'].slug
  ? (LEAGUES['afl-fantasy'].navSlug as LeagueSlug)
  : (LEAGUES.theleague.navSlug as LeagueSlug);
```

### PWA Manifest `scope` gotcha

`site.webmanifest` must include `start_url` and `scope` pointing to the league's actual URL path (e.g. `"/afl-fantasy/"`). When the manifest is served from a subdirectory like `/assets/afl/favicons/site.webmanifest`, browsers default the PWA scope to that directory — meaning no AFL page falls in-scope for standalone mode. This is a silent correctness bug that CI won't catch.

**Rule:** For any manifest not at the root, always set `scope` and `start_url` explicitly.

### Dark-mode favicon wiring

Adding a `favicon-dark.svg` asset without a `<link rel="icon" media="(prefers-color-scheme: dark)">` tag ships dead weight. The full pattern:
```html
<link rel="icon" type="image/svg+xml" href="/assets/afl/favicons/favicon.svg" />
<link rel="icon" type="image/svg+xml" href="/assets/afl/favicons/favicon-dark.svg" media="(prefers-color-scheme: dark)" />
```

### Hardcoded theme-color hex in `<meta>`

`<meta name="theme-color">` cannot use CSS custom properties — the value must be a literal string. When the same hex appears in both the layout `<meta>` and a JSON manifest, extract to a named constant in the Astro frontmatter to keep the value DRY:
```ts
const AFL_THEME_COLOR = '#002244';
// then: content={AFL_THEME_COLOR}
```

## Phase 1 shared-infra extraction (July 2026)

### Canonical shared modules — use these, don't re-inline

- **`src/utils/redis-client.ts`** — `getRedis()` + `RedisClient` superset
  type. Never write an inline `new Redis({url, token})` block in app code
  again; the triple env fallback (UPSTASH → KV → STORAGE) lives here.
- **`src/utils/api-response.ts`** — `JSON_HEADERS`, `JSON_HEADERS_NO_STORE`,
  `json()`, `unauthorized()`, `requireAuth()`. When migrating a route,
  match its original cache-control exactly (`JSON_HEADERS_NO_STORE as
  JSON_HEADERS` alias keeps diffs minimal).
- **`src/utils/mfl-url.ts`** — `buildMflExportUrl()`. Only for `/export`
  URLs; `/import` (write) URLs stay hand-built. Note it always sets `L=`,
  so a no-league URL (login flow's `TYPE=myleagues`) cannot use it.
- **`scripts/lib/{redis,mfl-api,fetch-retry,groupme,pt-date,env}.mjs`** —
  node-script equivalents. `mfl-api.mjs#fetchExport` takes options
  (retries/sleepMs/userAgent/onFetch/formatError) so each caller keeps its
  original politeness/backoff behavior.

### Source-grep invariant tests break on extraction

Several tests pin invariants by regexing script source
(`tests/schefter-rumor-topic-focus.test.ts`, `tests/schefter-quiet-day.test.ts`).
Moving a function to `scripts/lib/` breaks the regex even when behavior is
identical — update the test to assert the import + the shared module's
source, mirroring the existing pattern for `schefter-bucket-logic.mjs`.

### Worktree + background agents: commit early, commit often

A background agent running `git stash`/`reset` in the same worktree can
wipe sibling uncommitted work. Land shared-module scaffolding as its own
commit before fanning out call-site migrations.
