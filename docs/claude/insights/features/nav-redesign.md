# Nav Redesign Insights

Feature-specific learnings for the navigation drawer redesign project.

**Plan Document:** `nav-redesign/NAV_REDESIGN_PLAN.md`
**Design Reference:** `nav-redesign/original-07d321b8d76053754a9296a819f4f727.webp`

---

## 2026-01-18 - Team Verification Flow Uses MFL Custom Page

**Context:** Determining how to identify which team a user owns

**Insight:** MFL's native login redirect doesn't pass user identity. Instead, we use a custom MFL page with embedded JavaScript that:
1. Detects the logged-in user's franchise_id from MFL's DOM
2. Adds `?myteam={franchiseId}` to links back to our site

**Evidence:**
- MFL custom page: `https://www49.myfantasyleague.com/2025/home/13522?MODULE=MESSAGE20`
- We parse `myteam` from URL and store in cookie

**Recommendation:** The "Verify Your Team" link should point to this MFL custom page. On any page load, check for `?myteam` param and set cookie if present.

---

## 2026-01-18 - Admin Detection via Franchise ID

**Context:** Determining how to show admin-only links

**Insight:** Admin access is determined by franchise ID, not a separate auth system. A specific franchise ID (e.g., `0001`) unlocks admin features.

**Evidence:** Design decision from planning session. Store admin IDs in `nav-config.json`:
```json
{
  "adminFranchiseIds": ["0001"]
}
```

**Recommendation:** Check `myteam` cookie value against `adminFranchiseIds` array to determine admin visibility.

---

## 2026-01-18 - Owner-Specific Links

**Context:** Planning what links to show authenticated users

**Insight:** Three owner-specific features were identified:
1. Coach Tab
2. Auction Predictor
3. Team Preview

**Evidence:** User feedback during planning session.

**Recommendation:** These links appear in the "My Team" section when `myteam` cookie is set. They should route to team-specific pages.

---

## 2026-01-18 - Drawer Behavior: Push vs Overlay

**Context:** Determining drawer interaction with page content

**Insight:** Drawer should behave differently based on screen size:
- **Desktop (≥1024px):** Push content left when open
- **Mobile (<1024px):** Overlay with dimmed backdrop

**Evidence:** User preference from planning session.

**Recommendation:** Use CSS to handle both modes:
```css
/* Desktop - push */
@media (min-width: 1024px) {
  .nav-drawer.open ~ .page-content {
    transform: translateX(calc(-1 * var(--nav-width-expanded)));
  }
}

/* Mobile - overlay (default) */
.nav-drawer {
  position: fixed;
  z-index: 1000;
}
```

---

## 2026-01-18 - Collapsed State Behavior

**Context:** Planning icon-only vs full drawer

**Insight:** The collapsed state should:
1. Auto-engage on screens < 768px
2. Allow manual toggle via button
3. Persist preference in `nav-collapsed` cookie
4. Show tooltips on hover when collapsed

**Evidence:** User preference from planning session.

**Recommendation:** Implement ResizeObserver to detect viewport changes and auto-collapse. Use cookie to remember user's manual override.

---

## 2026-01-18 - Smart Routing for League Switching

**Context:** Switching between AFL and TheLeague

**Insight:** When switching leagues, use "smart routing":
1. Get current path (e.g., `/theleague/rosters`)
2. Attempt to map to equivalent in other league (`/afl-fantasy/rosters`)
3. If page exists → navigate there
4. If not → navigate to league home

**Evidence:** User preference from planning session.

**Recommendation:** Create route mapping utility:
```typescript
function getEquivalentRoute(currentPath: string, targetLeague: 'theleague' | 'afl'): string {
  // Extract page from path, prepend target league prefix
  // Return home if equivalent doesn't exist
}
```

---

## 2026-01-18 - Phase 1 Complete: Design Foundation

**Context:** Implementing Phase 1 of the nav redesign

**Insight:** Phase 1 (Design Foundation) is complete with:

1. **Design Tokens** (`src/assets/css/src/_nav-tokens.scss`):
   - Dimensions: expanded (320px), collapsed (64px), header/footer heights
   - Spacing scale: 4px, 8px, 12px, 16px, 24px, 32px
   - Transitions: cubic-bezier(0.4, 0, 0.2, 1) at 0.3s
   - Light mode colors with references to existing global tokens
   - Dark mode via both `@media (prefers-color-scheme: dark)` AND `.dark` class
   - Z-index layers for overlay, drawer, header, close button
   - Touch target minimum (44px) for accessibility
   - Badge, tooltip, league switcher styling tokens

2. **TypeScript Interfaces** (`src/types/nav.ts`):
   - `NavLink` - Individual link with icon, label, visibility, league restrictions
   - `NavSection` - Group of links with section heading
   - `NavConfig` - Full configuration shape for nav-config.json
   - `NavTeamInfo` - Team data for authenticated users
   - `NavDrawerState` - Runtime drawer state
   - Component prop interfaces for all nav components
   - Cookie name constants

3. **SCSS Imports**: Updated both `theleague_main.scss` and `afl_main.scss`

**Evidence:** Files created and integrated into codebase.

**Recommendation:** Phase 2 can now begin with component building. The tokens and types provide the foundation for:
- Consistent styling across all nav components
- Type-safe configuration and props
- Dark mode support from day one

---

## 2026-01-18 - NavHeader and LeagueSwitcher Components Complete

**Context:** Building the header component for the navigation drawer (Phase 2 start)

**Insight:** The NavHeader and LeagueSwitcher components were built with the following patterns:

1. **NavHeader Component** (`src/components/nav/NavHeader.astro`):
   - Fixed at top of drawer using `position: sticky` with `z-index: var(--nav-z-header)`
   - League logo on LEFT, league switcher on RIGHT
   - Supports collapsed mode (icon-only) via `isCollapsed` prop
   - League name display follows existing Header.astro patterns (gradient for AFL, two-tone for TheLeague)
   - Accessible: uses `role="banner"`, proper aria-labels on links

2. **LeagueSwitcher Component** (`src/components/nav/LeagueSwitcher.astro`):
   - Pill-toggle design in expanded mode (TL | AFL)
   - Single swap icon button in collapsed mode
   - Smart routing implemented: extracts page path, swaps league prefix
   - Uses `role="radiogroup"` with `role="radio"` and `aria-checked` for accessibility
   - CSS-only tooltip on collapsed mode button (via `::after` pseudo-element)
   - Touch targets meet 44px minimum requirement

3. **Design Token Usage**:
   - All spacing uses `--nav-spacing-*` tokens
   - All colors use `--nav-*` tokens with fallbacks
   - Transitions use `--nav-hover-transition`
   - Focus states use `--nav-focus-ring`
   - League switcher uses dedicated `--nav-switcher-*` tokens

4. **Dark Mode Support**:
   - Uses `:global(.dark)` selectors for dark mode overrides
   - All color tokens properly swap in dark mode

**Evidence:** Files created:
- `src/components/nav/NavHeader.astro`
- `src/components/nav/LeagueSwitcher.astro`

**Recommendations for future components:**
- Follow the same pattern of extending interfaces from `src/types/nav.ts`
- Use `class:list` for conditional classes in Astro
- Always provide fallback values in CSS custom properties
- Use `:global(.dark)` for dark mode when component styles are scoped

---

## 2026-01-18 - NavFooter Component Implementation

**Context:** Building the footer component for the navigation drawer

**Insight:** The footer component handles two distinct states with different visual treatments:

1. **Authenticated State** (team info):
   - Team logo from config: `/assets/theleague/icons/{franchiseId}.png`
   - Team name (truncated with ellipsis if needed)
   - Optional owner name in muted text
   - Styled like the "Janna" section in reference design

2. **Unauthenticated State** (verify prompt):
   - Dashed border container to stand out visually
   - User icon in a circle badge
   - "Verify Your Team" label with hint text
   - Arrow indicating external navigation
   - Links to MFL custom page: `https://{host}/{year}/home/{leagueId}?MODULE=MESSAGE20`

**Implementation Details:**
- Uses `NavFooterProps` interface from `src/types/nav.ts`
- Tooltip positioning: absolute, to the right of the icon (left: calc(100% + spacing))
- Tooltip arrow implemented with CSS border trick
- Footer links (e.g., "Back to MFL") shown only in expanded mode
- URL templates resolved at render time with host/year/leagueId values

**Key Patterns:**
```astro
<!-- Collapsed mode shows tooltip on hover -->
{isCollapsed && (
  <span class="nav-footer__tooltip" role="tooltip">
    {team.teamName}
  </span>
)}
```

**Accessibility:**
- `role="contentinfo"` on footer element
- `role="tooltip"` on tooltip spans
- Focus-visible states with `var(--nav-focus-ring)`
- Reduced motion support via `@media (prefers-reduced-motion: reduce)`
- External links have `rel="noopener noreferrer"`

**File Created:** `src/components/nav/NavFooter.astro`

---

## 2026-01-18 - NavLinks Component Implementation

**Context:** Building the scrollable links section for the navigation drawer

**Insight:** The NavLinks component is the most complex piece of the drawer, handling:

1. **Visibility Logic:** Three-tier visibility system implemented as pure functions:
   - `isLinkVisible()`: Checks admin/owner/public visibility per link
   - `isSectionVisible()`: Checks section-level visibility AND ensures at least one visible link exists
   - Filters applied at render time, not stored in state

2. **URL Resolution Pattern:**
   ```typescript
   function resolveHref(link: NavLink, league: LeagueSlug): string {
     if (link.url) return link.url;           // External URL
     if (link.urlTemplate) return link.urlTemplate;  // Template (needs substitution)
     if (link.path) return `${prefix}${link.path}`;  // Internal with league prefix
     return '#';
   }
   ```

3. **Active State Detection:**
   - Compares current path to resolved href
   - Ignores query strings for base path matching
   - Never marks external links as active
   - Uses `aria-current="page"` for accessibility

4. **Collapsed Mode Implementation:**
   - Labels get `.visually-hidden` class (accessible but invisible)
   - Tooltips rendered as separate elements with `role="tooltip"`
   - Tooltips show on `:hover` and `:focus-visible` (CSS-only)
   - Icons enlarge slightly (24px -> 28px) in collapsed mode
   - Link container becomes square (44x44px) centered

5. **Styling Architecture:**
   - BEM naming: `.nav-links__section`, `.nav-links__link`, etc.
   - All sizing uses design tokens (`--nav-*`)
   - Active state uses left border accent + background tint
   - Custom scrollbar styling for modern browsers
   - Touch targets enforced at 44px minimum via `min-height`

**Key CSS Pattern for Active State:**
```css
.nav-links__link--active {
  background: var(--nav-active-bg);
  color: var(--nav-active-text);
  border-left-color: var(--nav-active-border-left);
  font-weight: 600;
}
```

**Accessibility Features:**
- `<nav aria-label="Main navigation">` as landmark
- Section titles as `<h2>` with `id` linked via `aria-labelledby`
- `role="list"` on `<ul>` elements for explicit semantics
- `aria-current="page"` on active links
- Badges announce count with `aria-label`
- Focus ring using `:focus-visible` (keyboard only)
- Reduced motion support

**Props Interface:**
```typescript
interface Props extends NavLinksProps {
  adminFranchiseIds?: string[];  // For admin visibility checks
}
```

**File Created:** `src/components/nav/NavLinks.astro`

---

## 2026-01-18 - NavDrawer Container Component Complete

**Context:** Building the main drawer container that assembles all nav sub-components

**Insight:** The NavDrawer component is the orchestrator that:

1. **Layout Structure:**
   ```
   ┌─────────────────────┐
   │ NavHeader (fixed)   │ - League logo + switcher
   ├─────────────────────┤
   │ NavLinks (scroll)   │ - Flex: 1, overflow-y: auto
   ├─────────────────────┤
   │ NavFooter (fixed)   │ - Team info or verify prompt
   └─────────────────────┘
   ```

2. **Drawer Behavior Implementation:**
   - Slides from RIGHT using `transform: translateX(100%)` -> `translateX(0)`
   - Desktop (>=1024px): Push mode (no overlay, border instead of shadow)
   - Mobile (<1024px): Overlay mode with backdrop and scroll lock
   - Uses `100dvh` for proper mobile viewport handling

3. **State Management (Client JS):**
   - `isOpen`: Controls drawer visibility via CSS class toggle
   - `isCollapsed`: Controls icon-only mode, persisted in cookie
   - Focus trap implementation with Tab/Shift+Tab cycling
   - Escape key handler for quick close
   - ResizeObserver for auto-collapse on mobile (<768px)

4. **Collapse/Expand Buttons:**
   - Positioned absolutely at left edge (50% vertical)
   - `transform: translate(-50%, -50%)` for center-left positioning
   - Collapse button shows in expanded mode, expand button in collapsed mode
   - Desktop-only (hidden on mobile via media query)

5. **Focus Trap Pattern:**
   ```typescript
   function handleFocusTrap(e: KeyboardEvent): void {
     if (e.key !== 'Tab') return;
     const focusable = getFocusableElements();
     const first = focusable[0];
     const last = focusable[focusable.length - 1];

     if (e.shiftKey && document.activeElement === first) {
       e.preventDefault();
       last.focus();
     } else if (!e.shiftKey && document.activeElement === last) {
       e.preventDefault();
       first.focus();
     }
   }
   ```

6. **Screen Reader Announcements:**
   - Live region with `role="status"` and `aria-live="polite"`
   - Announces drawer open/close and collapse/expand state changes
   - Clears announcement after 1 second to avoid repetition

7. **Cookie Pattern for Collapsed State:**
   - Read on server: `Astro.cookies.get(NAV_COOKIES.NAV_COLLAPSED)`
   - Write on client: `document.cookie = 'nav-collapsed=true;...'`
   - Initial state passed to sub-components via props
   - Client JS updates `data-collapsed` attribute and CSS classes

8. **Global API Exposed:**
   ```typescript
   window.navDrawer = {
     open, close, toggle,
     collapse, expand, toggleCollapsed,
     isOpen: () => isOpen,
     isCollapsed: () => isCollapsed,
   };
   ```

**Key CSS Patterns:**

```css
/* Drawer positioning */
.nav-drawer {
  position: fixed;
  top: 0;
  right: 0;
  height: 100dvh;
  transform: translateX(100%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* Open state */
.nav-drawer--open { transform: translateX(0); }

/* Desktop push mode */
@media (min-width: 1024px) {
  .nav-drawer--open {
    border-left: 1px solid var(--nav-border);
  }
}
```

**Accessibility Implementation:**
- `role="dialog"` and `aria-modal="true"` on drawer
- `aria-hidden` toggled with open state
- Focus trap cycles within drawer when open
- Focus returns to trigger element on close
- Reduced motion support via `@media (prefers-reduced-motion: reduce)`

**Files Created:**
- `src/components/nav/NavDrawer.astro`
- `src/components/nav/NavToggleButton.astro`

---

## 2026-01-18 - NavToggleButton Component

**Context:** Extracting hamburger button as reusable component

**Insight:** The NavToggleButton component was extracted from Header.astro to enable reuse across layouts:

1. **CSS-Only Hamburger to X Animation:**
   - Three lines using `::before` and `::after` pseudo-elements
   - Middle line rotates 45 degrees
   - Top line fades out (opacity: 0)
   - Bottom line rotates -90 degrees and moves to center
   - All using cubic-bezier(0.4, 0, 0.2, 1) timing

2. **Accessibility Attributes:**
   - `aria-expanded`: Updates with open state
   - `aria-label`: "Toggle menu" (customizable)
   - `aria-controls`: Points to drawer ID
   - `data-nav-toggle`: Data attribute for JS selection

3. **Breadcrumb Bar Variant:**
   - Special styling when used in `.breadcrumb-bar` context
   - Light-colored lines for dark breadcrumb background
   - Uses `:global(.breadcrumb-bar)` selector

**Key CSS Pattern:**
```css
/* Open state transformation */
.nav-toggle-btn--open .nav-toggle-btn__inner {
  transform: rotate(45deg);
}
.nav-toggle-btn--open .nav-toggle-btn__inner::before {
  top: 0;
  opacity: 0;
}
.nav-toggle-btn--open .nav-toggle-btn__inner::after {
  bottom: 0;
  transform: rotate(-90deg);
}
```

**Props Interface:**
```typescript
interface Props extends NavToggleButtonProps {
  controlsId?: string;  // aria-controls target
  class?: string;       // Additional classes
}
```

**File Created:** `src/components/nav/NavToggleButton.astro`

---

## 2026-01-18 - Navigation Configuration and Utilities Complete

**Context:** Creating the JSON configuration and TypeScript utilities for nav links

**Insight:** The configuration layer is now complete with three key files:

### 1. Nav Config JSON (`src/config/nav-config.json`)

Comprehensive navigation link configuration with:

**Sections defined:**
- **Tools** (6 links): Rosters, Next Year Summary, Calculator, Draft Order, Standings, Playoffs
- **Advanced Reports** (3 links): Salary Benchmarks, Salary History, MVPs
- **Community** (TheLeague only): Message Board
- **My Team** (owner visibility): Coach Tab, Auction Predictor, Team Preview
- **Admin** (admin visibility): Feature Flags
- **MFL Actions** (3 external links): Submit Lineup, Add/Drop, Live Scoring
- **Leagues** (2 external links): TheLeague.us, AFL Fantasy

**Key configuration patterns:**
```json
{
  "id": "rosters",
  "label": "Roster/Salary",
  "labelAFL": "Rosters",
  "icon": "banknote",
  "iconAFL": "helmet",
  "path": "/rosters",
  "external": false
}
```

**URL Templates for MFL links:**
```json
{
  "urlTemplate": "https://{host}/{year}/lineup?L={leagueId}",
  "external": true
}
```

**Route Equivalence Map:**
- Pages in both leagues: `/rosters`, `/standings`, `/playoffs`, `/draft-predictor`, `/icons`, `/assets`
- TheLeague-only pages: `/calculator`, `/salary`, `/salary-history`, `/mvp`, `/auction-predictor`, `/contracts`, `/rules`

### 2. Nav Config TypeScript Wrapper (`src/config/nav-config.ts`)

Provides typed access to the JSON configuration:
- `navConfig`: The full typed configuration object
- `getAllSections()`: Get all sections
- `getSectionById()`: Get specific section
- `getLinkById()`: Find a link by ID
- `isAdminFranchise()`: Check if franchise ID is admin
- `getRouteEquivalence()`: Get route mapping
- `getVerifyTeamUrlTemplate()`: Get MFL custom page URL for team verification

### 3. Nav Utils (`src/utils/nav-utils.ts`)

**URL Building:**
- `buildUrlFromTemplate()`: Substitute `{host}`, `{year}`, `{leagueId}`, `{franchiseId}` placeholders
- `getLinkHref()`: Resolve any link type (static URL, template, or internal path)
- `getLinkLabel()`: Get league-appropriate label
- `getLinkIcon()`: Get league-appropriate icon

**Visibility Logic:**
- `isLinkVisible()`: Check admin/owner/public visibility for a link
- `isSectionVisible()`: Check if section should show (league + visibility + has visible links)
- `getVisibleLinks()`: Filter links for a section
- `getVisibleSections()`: Get all visible sections with filtered links

**Smart Routing:**
- `getEquivalentRoute()`: Map current path to target league equivalent
- `isLinkActive()`: Check if link matches current path

**Cookie Utilities:**
- `getNavCollapsedPreference()` / `setNavCollapsedPreference()`: Drawer state
- `getMyTeamCookie()` / `setMyTeamCookie()` / `clearMyTeamCookie()`: Team identity
- `parseMyTeamFromUrl()`: Extract `?myteam=` param from URL
- `getLastViewedLeague()` / `setLastViewedLeague()`: League preference

**Evidence:** Files created:
- `src/config/nav-config.json`
- `src/config/nav-config.ts`
- `src/utils/nav-utils.ts`

**Key Architecture Decisions:**

1. **JSON + TypeScript Wrapper**: Configuration in JSON for easy editing, TypeScript wrapper for type safety
2. **Template-based URLs**: MFL links use templates with placeholders, resolved at runtime
3. **League-specific overrides**: `labelAFL` and `iconAFL` allow per-league customization without duplication
4. **Visibility as pure functions**: No state needed, just pass franchiseId and adminIds
5. **Cookie utilities are client-safe**: Check for `typeof document` before accessing cookies

**Route Equivalence Discovery:**
- TheLeague pages: 25+ pages
- AFL pages: 8 pages
- Common pages (safe for league switching): rosters, standings, playoffs, draft-predictor, icons, assets

---

## 2026-01-18 - Phase 3: Layout Integration Complete

**Context:** Integrating NavDrawer component into TheLeagueLayout and updating Header.astro

**Insight:** The integration followed a clean separation of concerns:

### 1. Header.astro Changes

The header was simplified to focus only on:
- Breadcrumb bar with "Back to MFL" link
- League logo and name
- Desktop navigation icons (quick access)
- NavToggleButton (replaces inline hamburger)

**Removed from Header:**
- Inline nav-menu, nav-overlay, nav-content, nav-links HTML
- Hamburger button CSS animations (now in NavToggleButton)
- All nav-menu related CSS (.nav-menu, .nav-overlay, .nav-content, .nav-links, .nav-close-btn)
- Client-side JavaScript for menu toggle

**Added to Header:**
- Import of NavToggleButton component
- NavToggleButton usage with `controlsId="nav-drawer"`

### 2. TheLeagueLayout.astro Changes

The layout now orchestrates the entire navigation system:

**New Imports:**
```typescript
import NavDrawer from '../components/nav/NavDrawer.astro';
import { getLeagueContext } from '../utils/league-context';
import { getCurrentLeagueYear } from '../utils/league-year';
import { navConfig, getAdminFranchiseIds } from '../config/nav-config';
import { getVisibleSections, parseMyTeamFromUrl } from '../utils/nav-utils';
import type { NavTeamInfo, LeagueSlug } from '../types/nav';
import leagueConfigData from '../data/theleague.config.json';
```

**myteam URL Parameter Handling:**
```typescript
const myteamParam = parseMyTeamFromUrl(Astro.url);
if (myteamParam) {
  Astro.cookies.set('myteam', myteamParam, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: 'lax',
  });
}
```

**Team Info Loading from Config:**
```typescript
const teamData = leagueConfigData.teams.find(
  (t: { franchiseId: string }) => t.franchiseId === myteam
);
if (teamData) {
  teamInfo = {
    franchiseId: myteam,
    teamName: teamData.name,
    iconUrl: teamData.icon || null,
    ownerName: null,
    league: 'theleague' as LeagueSlug,
  };
}
```

### 3. Page Wrapper Pattern

The layout wraps content in a `.page-wrapper` div that responds to drawer state:

```html
<div class="page-wrapper" id="page-wrapper">
  <TheLeagueHeader />
  <main><slot /></main>
  <TheLeagueFooter />
</div>
<NavDrawer ... />
```

**CSS for Push Behavior:**
```css
.page-wrapper {
  transition: margin-right var(--nav-transition, 0.3s cubic-bezier(0.4, 0, 0.2, 1));
  min-height: 100vh;
}

@media (min-width: 1024px) {
  .page-wrapper.nav-open {
    margin-right: var(--nav-width-expanded, 320px);
  }
  .page-wrapper.nav-open.nav-collapsed {
    margin-right: var(--nav-width-collapsed, 64px);
  }
}
```

**MutationObserver for State Sync:**
```typescript
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
      syncPageWrapperClasses();
    }
  }
});
observer.observe(drawer, { attributes: true, attributeFilter: ['class'] });
```

### 4. Key Architecture Decisions

1. **NavDrawer Outside Page Wrapper**: Drawer is placed as a sibling to page-wrapper, not inside it. This allows the drawer to overlay on mobile while the page-wrapper responds with margin changes on desktop.

2. **MutationObserver vs Custom Events**: Used MutationObserver to watch for class changes on the drawer element. This is more robust than custom events since it automatically catches all state changes regardless of how they were triggered.

3. **Server-Side Cookie Setting**: Using `Astro.cookies.set()` for the myteam cookie ensures it's set before the page renders, allowing the navigation to show team-specific links immediately.

4. **Type Safety with Explicit Casts**: Used explicit `LeagueSlug` type casts when building teamInfo to ensure TypeScript correctness.

**Files Modified:**
- `src/components/theleague/Header.astro` - Removed inline nav, added NavToggleButton
- `src/layouts/TheLeagueLayout.astro` - Added NavDrawer integration, page wrapper, and sync script

**Next Steps:**
- Test on various pages to ensure navigation works correctly
- Apply same pattern to AFL layout if needed
- Consider extracting page-wrapper pattern into a shared component

---

## 2026-01-18 - Collapsed State Removed

**Context:** Simplifying the navigation drawer by removing the icon-only collapsed mode

**Insight:** The collapsed state (64px width, icon-only mode) was removed from the navigation drawer. The drawer now only has two states: open (320px) and closed.

**Changes Made:**
1. **NavDrawer.astro**: Removed collapse/expand buttons, collapsed CSS class, and all JavaScript collapse/expand logic
2. **NavHeader.astro**: Removed `isCollapsed` prop, always shows league name and switcher chevron
3. **LeagueSwitcher.astro**: Removed collapsed mode (single swap icon), always renders pill toggle
4. **NavLinks.astro**: Removed collapsed mode (icon-only with tooltips), always shows labels
5. **NavFooter.astro**: Removed collapsed mode, always shows full team info or verify prompt

**Removed Features:**
- Collapse/expand toggle buttons on drawer edge
- `nav-collapsed` cookie persistence
- Auto-collapse on mobile (<768px)
- Tooltips for collapsed mode
- ResizeObserver for responsive collapse

**Recommendation:** If collapsed mode is needed in the future, consider re-implementing as a separate feature branch rather than modifying the current simplified implementation.

---

## 2026-01-18 - Playwright E2E Testing for Nav Drawer

**Context:** Using Playwright to systematically test and validate the nav drawer UI

**Insight:** Playwright testing revealed and helped fix critical UI issues that weren't immediately obvious during development:

### Test Suite Structure

Created `tests/e2e/nav-drawer.spec.ts` with 10 tests covering:
1. Drawer open/close behavior
2. Section visibility and spacing
3. Link touch targets (minimum 40px)
4. Icon sizing (24x24px)
5. Footer visibility
6. Collapsed mode toggle
7. Overlay click to close (mobile)
8. Escape key to close
9. Icon visibility
10. Visual capture for spacing review

### Key Issues Discovered

**1. Link Spacing Too Tight:**
- Test revealed links were only 26.59px height instead of 40px minimum
- Fix: Added explicit CSS values:
```css
.nav-links__link {
  padding: 12px 8px;
  min-height: 44px;
}
.nav-links__item {
  margin-bottom: 4px;
}
.nav-links__section {
  margin-bottom: 20px;
}
```

**2. SVG Icons Rendering Giant:**
- Icons rendered at browser default size instead of 24px
- Root cause: Astro scoped CSS wasn't targeting nested SVGs
- Fix: Added explicit attributes AND `:global()` CSS:
```html
<svg width="24" height="24" viewBox="0 0 24 24">
  <use href={`/assets/icons/sprite.svg#icon-${icon}`} />
</svg>
```
```css
:global(.nav-links__icon svg) {
  width: var(--nav-icon-size, 24px);
  height: var(--nav-icon-size, 24px);
}
```

### Playwright Configuration

`playwright.config.ts` settings:
- Test directory: `./tests/e2e`
- Base URL: `http://localhost:4321`
- Projects: chromium (desktop) + Mobile Chrome (375x667)
- webServer: `pnpm dev` auto-starts before tests
- Screenshots: on-failure only

### Test Patterns Used

**Waiting for Animations:**
```typescript
await page.waitForSelector('.nav-drawer--open');
await page.waitForTimeout(500); // For CSS transitions
```

**Measuring Element Dimensions:**
```typescript
const box = await element.boundingBox();
expect(box?.height).toBeGreaterThanOrEqual(40);
```

**Capturing Screenshots for Review:**
```typescript
await drawer.screenshot({
  path: 'tests/e2e/screenshots/nav-drawer-full.png',
});
```

### Recommendations for Future Testing

1. **Run Playwright after any CSS changes** to catch spacing/sizing regressions
2. **Use `boundingBox()` for touch target validation** - ensures accessibility compliance
3. **Create dedicated test viewport** for mobile (375x667) vs desktop
4. **Screenshot capture** is valuable for visual QA review
5. **Test drawer state transitions** (open/close, collapse/expand) with proper waits

**Files Created:**
- `playwright.config.ts`
- `tests/e2e/nav-drawer.spec.ts`

**All 10 tests passing** after spacing fixes

## 2026-02-24 - Clean URL Rewrites Break on Prerendered TheLeague Drawer Pages

**Context:** Investigated drawer links that stopped working on `theleague.us`, specifically `Trade Builder` and `Import Rankings`.

**Insight:** The host-level clean URL flow (`/trade-builder` -> internal `/theleague/trade-builder`) depends on runtime route resolution in `src/middleware.ts`. When a target page is `prerender = true`, it may exist only as static output under `/theleague/...` and not as a runtime route entry, so the middleware rewrite cannot resolve it.

**Evidence:**
- Broken links were all drawer targets with `export const prerender = true`: `calendar`, `league-summary`, `trade-builder`, `import-rankings`.
- Before fix, `.vercel/output/config.json` had no runtime `src` route entries for those `/theleague/*` paths.
- After setting those pages to `prerender = false`, route entries were present and link integrity checks passed.

**Recommendation:** Any TheLeague page linked from the drawer should remain server-rendered (`prerender = false`) while clean URL rewriting is handled in middleware. If prerendering is required later, add explicit edge rewrites for each clean URL path.

## 2026-06-27 - NavFooter Login Chip Must Use JWT, Not the Preference Cookie

**Context:** The nav drawer footer showed a "logged-in" team chip for users who never signed in. Repro: visit an AFL page with `?myteam=<id>` (no login) → open the drawer → footer shows that team as authenticated, while `getAuthUser`-gated features (Ask Roger) correctly show "Sign in."

**Root cause:** `TheLeagueLayout.astro` populated the nav `teamInfo` from the league **preference cookie** (`afl_team_pref` / `theleague_team_pref`) first, falling back to the JWT. `NavFooter` treats `teamInfo`/`team` as proof of login via `isAuthenticated = !!team`. The preference cookie is **not** auth: it is `httpOnly: false`, unsigned, and `setAFLPreference`/`setTheLeaguePreference` write it from any `?myteam=` param across many pages (rosters, standings, playoffs, draft-predictor, index). Trivially spoofable.

**Fix:** Drive the nav `teamInfo` from the signed JWT session only — `navTeamId = <league>JwtFranchiseId`, where the JWT franchise is taken only when `layoutAuthUser.leagueId` matches that league's MFL id (from `getLeagueBySlug(...).id`, never hardcoded). The page-level `myteam` variable still falls back to the preference cookie, so browse-as personalization is unchanged; the AFL competition nav override reads the cookie directly in `NavLinks.astro`, so it is also unaffected.

**Key takeaways for future sessions:**
- The preference cookie is a *personalization* signal, never an *auth* signal. Anything that gates "logged-in" UI (the footer chip, owner/admin nav-link visibility via `teamInfo.franchiseId`) must key off `getAuthUser` (the signed JWT), not the cookie.
- Both AFL and TheLeague logins mint a JWT with `leagueId` + `franchiseId` (`src/pages/api/auth/login.ts`) — TheLeague is **not** cookie-only, so JWT-gating is safe for both.
- `getLeagueBySlug('afl-fantasy'|'theleague').id` gives the MFL id; don't hardcode `19621`/`13522` (per CLAUDE.md league registry rule).

## 2026-07-04 - Closed Drawer Exposed by Page-Level Horizontal Overflow

**Context:** On /theleague/activity (and the AFL twin) at 375px, QA screenshots showed the nav drawer apparently pinned open along the right edge, in both themes.

**Root cause:** Two bugs compounding. (1) The activity tables (`.activity-table`, 449px/401px min-content width) had no `overflow-x: auto` wrapper, so the document itself scrolled horizontally (scrollWidth 465 at a 375 viewport). (2) The drawer's closed state hid it only via `transform: translateX(100%)` — still `visibility: visible` — so once the page had horizontal overflow, full-page screenshots (and sideways scroll / mobile zoom-out) revealed the "closed" drawer sitting past the right edge. Its links were also still tab-focusable while `aria-hidden="true"`.

**Fix:**
- Wrapped both activity tables in the existing global `.table-wrapper` (`overflow-x: auto`, defined in `TheLeagueLayout.astro`) — the repo's standard for wide tables.
- Hardened `NavDrawer.astro`: closed state now also gets `visibility: hidden`, with `transition: ..., visibility 0s linear var(--nav-transition-duration, 0.3s)` so it hides only after the slide-out finishes; the `--open` state resets the delay to 0s so it's visible during slide-in.

**Key takeaways:**
- Off-canvas panels hidden only by transform are one page-overflow away from being visible. Pair the transform with delayed `visibility: hidden` (also fixes the tab-order leak behind `aria-hidden`).
- Any table that can exceed ~360px min-content width needs the `.table-wrapper` scroll container (Editorial Design Standard: the page body must never scroll horizontally).
- Headless preview tabs throttle CSS transitions — mid-transition `getComputedStyle` reads can look like a broken rule. Verify end states with an active Playwright page instead.

## 2026-07-06 - Hamburger Has No Background Fill (Owner Preference) + phpBB Embed Must Be Synced

**Context:** Brandon asked to remove the "glossy" pill behind the breadcrumb-bar hamburger. The visible plate was the dark-mode resting background (`html.dark .breadcrumb-bar .nav-toggle-btn { background: rgba(255,255,255,0.08) }`) plus `:hover` fills that stick after a tap on touch devices.

**Fix:** Removed all background fills from `NavToggleButton.astro` (resting plate, base hover, breadcrumb hover). The three lines are the whole affordance; line-color hover feedback and the `:focus-visible` ring stay.

**Key takeaways:**
- **Owner preference, don't re-add:** the hamburger toggle gets *no* background fill in any state or theme — future dark-mode passes should resist giving it a "button plate."
- `public/embed/phpbb-nav.html` is a hand-synced copy of the nav CSS with a `.tl-` prefix (used on the phpBB forum). It is not generated — any visual change to `NavToggleButton.astro` / drawer styles must be manually mirrored there, and there's a "Last synced from source" date in its header comment worth bumping.
- On touch devices `:hover` backgrounds persist after a tap until the next touch, so a hover-only background reads as a stuck highlight on mobile — prefer color shifts on the glyph itself for hover feedback on icon buttons.

## 2026-07-20 - League Switch Links Must Be Absolute Cross-Domain URLs on Apex Hosts

**Context:** The drawer's league-switch chevron silently reloaded the same league on theleague.us / afl-fantasy.com. Root cause: the switch URL was passed through `resolveLeaguePath`, which strips ANY league prefix — including the *target* league's — so "Switch to AFL" linked to `/rosters`, which the middleware rewrote back to the current host's league.

**Insight — two traps, one rule:**
1. Never run a cross-league URL through `resolveLeaguePath`. Its job is stripping the *current host's* prefix for clean links; on a target-league path it destroys the routing information.
2. A same-host cross-league path (`theleague.us/afl-fantasy/rosters`) is also wrong even though the middleware serves it: `Astro.locals.hideLeaguePrefix` is **host-wide**, so every link the landed AFL page generates gets de-prefixed and resolves back to TheLeague. The only correct cross-league target on an apex host is an **absolute URL to the other league's own domain**, built from the registry's `domains` (prefer the `www.` entry — matches the canonical bases in `AdminDashboard.astro`).

The rule lives in `nav-utils#getLeagueSwitchUrl` / `#getLeagueSwitchTargets`; `tests/nav-equivalent-route.test.ts` locks it (switch URLs on an apex host must be absolute, never a bare de-prefixed path).

**Also decided:**
- The switcher renders for **every** visitor, not just dual-league owners: sessions don't cross the apex domains, so a login-gated switcher vanishes the moment you switch — a one-way door.
- With 3+ leagues in the registry the chevron becomes a dropdown (`NavHeader`), automatic because `LEAGUE_PREFIXES` and the switch targets are now registry-derived. It's a **disclosure pattern** (button + `aria-expanded` + plain links), deliberately NOT `role="menu"` — a menu role promises arrow-key navigation we don't implement. Its Escape handler runs in the capture phase and calls `stopPropagation` **only when focus is inside the switcher** (so it doesn't also close the drawer, but doesn't hijack Escape from other UI either); focus leaving the switcher closes the list. To test 3-league mode, temporarily add a fake entry to `leagues-data.mjs` — the dev server picks it up without type errors blocking render (only `astro check` complains).
- Canonical absolute origins come from the registry: `canonicalDomain` + `leagueOrigin()` in `leagues-data.mjs`/`leagues.ts` (www hosts — session cookies are host-only, so all absolute-URL producers must agree). `getLeagueByNavSlug` replaces the hand-rolled `ALL_LEAGUES.find(l => l.navSlug === x)` scans.

## 2026-09-05 - No Section Is "First": Phase Order Means a Top Link Needs `pinnedLinks`

**Context:** Notifications had no drawer link at all (site search or a What's New
anchor were the only ways in), and the ask was to make it the very first link.

**Insight — the drawer has no stable first position inside sections.** Every
section carries `phaseOrder: { inSeason, offSeason }` and `NavLinks` re-sorts on
`getLeaguePhase()` at render, so **This Week** leads in-season and **News &
Updates** leads off-season. "First link in the drawer" is therefore not a
property any section link can hold — putting it at the top of one section
silently demotes it for half the calendar, and putting it in both renders it
twice.

`nav-config.json#pinnedLinks` is the place for that: a flat `<ul>` rendered
**above** the section list, outside the disclosure pattern, with a bottom rule
(`--nav-border`, defined in both `tokens.css` and `tokens-dark.css`) separating
it from the first section header.

Three things that are load-bearing:
- **Pinned links go through the same filters as section links.**
  `getVisiblePinnedLinks` (nav-utils) reuses `linkMatchesLeague` +
  `isLinkVisible`, so an untagged pinned link reaches TheLeague and the AFL and
  stays out of the best-ball drawer — which does not have most of these pages.
  Bypassing that filter is how a pinned link 404s an entire league's nav.
- **The pinned markup is deliberately simpler than a section link's** — no AFL
  tier-crest override, no admin gating. Those belong to specific section links
  (`premier-league`, the commissioner section); a pinned link that needs one
  should get the branch, not inherit a copy of the whole block.
- **The guards walk pinned links too.** `tests/nav-drawer-links.test.ts` and
  `tests/nav-config-icons.test.ts` iterate `pinnedLinks` alongside the sections,
  so a pinned link to a missing page, a prerendered page, or a sprite glyph that
  does not exist fails the same way a section link does.
  `tests/nav-pinned-links.test.ts` pins the ordering itself: Notifications first,
  no pinned id duplicated inside a section, and the pinned `<ul>` rendered before
  `nav-links__list` in the component.

**Also:** the Add/Drop link was removed in the same pass — it handed the owner
off to MFL's own `add_drop` screen, and adds and drops already live on the
site's player pages. The same guard test fails if any nav link points at
`add_drop` again.

---

## 2026-09-07 - "The Footer" Is Two Different Registries; Only One Is a Site Directory

**Context:** Asked to drop the Owners link from the side nav because "the footer
is good enough for it." Confirming that claim meant finding which footer, and
the word points at two unrelated things in this repo.

**The two footers:**

| Thing | Rendered by | Fed by | Holds |
|---|---|---|---|
| The nav drawer's bottom strip | `src/components/nav/NavFooter.astro` | `nav-config.json` → `footerLinks` | The team chip / verify prompt, and one link: "Back to MFL" |
| The site footer deck | `src/components/theleague/Footer.astro` | `src/config/footer-config.ts` → `THELEAGUE_COLUMNS` / `AFL_COLUMNS` | The five-column site directory (My Team, This Week, Front Office, Record Book, League Office) |

A `footerLinks` array sitting right there in `nav-config.json` is the trap:
it looks like the site directory and is not — it is the drawer's own footer, and
has held exactly one external link since the redesign. Adding a page there puts
it inside the drawer you were trying to take it out of.

**They also disagree by design, which is the useful part.** The two registries
are independent, so a page can live in one and not the other, and that is the
lever for "de-duplicate this link" requests:

- The nav lists **paths** inline (`"path": "/owners"`).
- The footer lists **`page-directory.json` ids** (`'owners'`,
  `{ id: 'afl-owners', label: 'Owners' }`), never paths — see the docblock at
  the top of `footer-config.ts` for why (the old hardcoded-path footer drifted
  and shipped two labels pointing at `/rules`).

So removing a nav entry does **not** remove the footer entry, and neither one is
what makes the page reachable: the route, the `page-directory.json` entry (site
search), and `nav-config.json`'s `routeEquivalence` map all live separately.
That map is the easy thing to over-delete — `"/owners": "/owners"` is what keeps
the league toggle landing on the other league's owners page instead of bouncing
home, and it is keyed by path with no relationship to whether the drawer still
lists it.

**Rule:** "put it in / take it out of the footer" means `footer-config.ts` plus a
`page-directory.json` id. Touch `nav-config.json`'s `footerLinks` only when the
thing genuinely belongs at the bottom of the open drawer.

---

## 2026-09-07 - The Footer Account Menu, and Why `pinnedLinks` Is Now Empty

**Context:** the footer's team row carried a chevron that toggled commissioner
mode and was rendered for commissioners only — no label, no `aria-expanded`
target, nothing announcing what it did. Meanwhile the two settings that belong
to the VIEWER rather than the league (Notifications, Preferences) sat pinned at
the top of the drawer, ~700px above the block that already showed who you are.

**The change.** That chevron became an account disclosure every signed-in owner
gets, opening four labelled rows in the footer: Preferences (printing the
viewer's chosen clock), Notifications, Commissioner mode (a labelled row with an
ON/OFF pill), and Sign out — which the site had an endpoint for and no button.
`pinnedLinks` is now `[]`.

Four things worth carrying forward:

- **The nav reads the clock cookie by hand.** `viewer-preferences-page.ts` is
  route-only for two independent reasons and the footer trips both:
  `resolveViewerPreferences` WRITES cookies (`ResponseSentError` from a
  component — a blank page on every route), and `readViewerClock` reads Redis
  whenever the device has no cookie, which in a component the whole site renders
  is a round-trip per page view rather than the once-per-device the mirror was
  designed for. `Astro.cookies.get(COUNTRY_COOKIE/ZONE_COOKIE)` +
  `parseViewerPreferences` is side-effect free and exact: the cookies are only
  ever written by an explicit choice, so their presence IS the `explicit`
  signal, and their absence prints "League time (PT)" — the pre-preference floor.
- **Removing a pinned link is only safe if something else carries it.**
  `/notifications` bounces a signed-out visitor to login, so losing its pin
  costs that visitor nothing. `/preferences` has NO auth gate and works
  signed out by design — and a signed-out visitor has no team row, therefore no
  account menu. It needs its own row beside the verify prompt, or the pin
  removal quietly strands the one setting that was built to work without an
  account. `tests/nav-pinned-links.test.ts` now pins that pairing.
- **Menu rows are registry-gated, not league-literal'd.** Best-ball publishes
  neither page; `viewerPreferences` / `pushNotifications` in `leagues-data.mjs`
  decide, so adding a league can't accidentally ship it two rows that 404.
- **`pinnedLinks` stays in the schema at zero entries.** The reason it exists
  is unchanged — phase order means no section link can hold "first in the
  drawer" — so a future must-be-first link goes there rather than into a
  section. The guard suite kept its structural checks (never pinned AND
  sectioned, pinned `<ul>` before `nav-links__list`) for exactly that day.

---

## 2026-09-07 - Feature Spotlights: A Pulse That Turns Itself Off

**Context:** the account menu shipped behind a chevron. A chevron with no label
is invisible to everyone who already knows the drawer — the same reason the
commissioner-only version of it went unnoticed for a year. The ask was a subtle
pulse marking the new thing, stopping "next week when it's not new".

**The mechanism.** `src/utils/feature-spotlight.ts` holds a registry keyed by
id and valued by SHIP DATE (`'nav-account-menu': '2026-09-07'`), plus a
seven-day default. `src/styles/feature-spotlight.css` carries the
`.spotlight-pulse` class — global, imported from component frontmatter the way
`loading.css` is, so any control can wear it. Marking a new feature is two
lines: a registry entry, and the class plus `data-spotlight="<id>"` on the
control.

Five things that are load-bearing:

- **A DATE, not a flag.** A boolean someone has to remember to remove pulses
  forever; a date expires whether or not anyone comes back. The registry entry
  can be left in place after the week — it renders identically to being absent.
  `tests/feature-spotlight.test.ts` asserts the expiry rather than trusting it.
- **Two stop conditions, both needed.** The week is the guarantee; the owner
  OPENING the thing is the courtesy. A pulse that keeps going after you have
  used the feature is noise, and this one sits in a nav people open all day. The
  second condition is a localStorage key per spotlight, and every access is
  wrapped — the accessor itself throws in a private window, and the pulse must
  never be the reason the nav fails to bind.
- **The dismissal check runs BEFORE the "already bound" early return.** The
  server renders the pulse for every device inside the week, so a returning
  owner needs the class cleared on each page load, not just on the load where
  the listener happens to be attached.
- **The halo is a `::after` box-shadow, never a transform on the control.** A
  button that changes size shifts its neighbours and reads as a glitch. And it
  rests as a thin 2px ring rather than nothing, so the control still reads as
  marked in a still frame — most of any given second is the rest state.
- **A global class loses to a scoped one on specificity.** `.spotlight-pulse
  { color }` in the shared file cannot beat `.nav-footer__account-toggle
  { color }` compiled with its `data-astro-cid` attribute, so the tint is
  re-stated inside the component and only the ring comes from the shared file.
  The first cut shipped a grey chevron with a blue halo for exactly this reason.

**Reduced motion keeps the ring and drops the animation.** Dropping the
affordance entirely would hide a new feature from precisely the people who
asked for less movement.
