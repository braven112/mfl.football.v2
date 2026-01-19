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
    box-shadow: none;
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
