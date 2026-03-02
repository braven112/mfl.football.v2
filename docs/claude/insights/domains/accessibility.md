# Accessibility Insights

Domain knowledge about accessibility patterns, ARIA usage, and inclusive design.

---

## 2026-01-18 - Existing Hamburger Menu ARIA Pattern

**Context:** Reviewing existing nav implementation

**Insight:** The current hamburger menu uses proper ARIA attributes for toggle state.

**Evidence:** From `src/components/theleague/Header.astro`:
```html
<button
  class="hamburger-btn"
  id="hamburger-btn"
  aria-label="Toggle menu"
  aria-expanded="false"
>
```

JavaScript updates `aria-expanded` on toggle:
```javascript
hamburgerBtn?.setAttribute("aria-expanded", isActive ? "true" : "false");
```

**Recommendation:** Maintain this pattern in new nav:
- `aria-label` for icon-only buttons
- `aria-expanded` for toggle state
- Update dynamically on state change

---

## 2026-01-18 - Keyboard Navigation for Drawers

**Context:** Reviewing existing nav accessibility

**Insight:** Current drawer supports Escape key to close.

**Evidence:** From `src/components/theleague/Header.astro`:
```javascript
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && navMenu?.classList.contains("active")) {
    closeMenu();
  }
});
```

**Recommendation:** New nav should also support:
- Escape to close
- Tab trapping within open drawer
- Focus return to trigger button on close
- Arrow keys for link navigation (optional enhancement)

---

## 2026-01-18 - Body Scroll Lock When Drawer Open

**Context:** Reviewing drawer behavior

**Insight:** Current implementation locks body scroll when drawer is open.

**Evidence:** From `src/components/theleague/Header.astro`:
```javascript
document.body.style.overflow = isActive ? "hidden" : "";
```

**Recommendation:** Maintain this pattern to prevent background scrolling when drawer overlays content.

---

## 2026-01-18 - NavLinks Component Accessibility Patterns

**Context:** Building the NavLinks component for the new navigation drawer

**Insight:** Several accessibility patterns were implemented for the scrollable links section:

1. **Semantic Structure:**
   - `<nav>` with `aria-label="Main navigation"` for landmark identification
   - `role="list"` on `<ul>` elements for explicit list semantics
   - Section headings (`<h2>`) with IDs linked via `aria-labelledby` on section link lists

2. **Active State:**
   - `aria-current="page"` on active links for screen reader announcement
   - Visual indicators (background, border) with sufficient color contrast

3. **Collapsed Mode Accessibility:**
   - Labels are visually hidden but remain accessible via `.visually-hidden` class
   - Tooltips appear on hover/focus for sighted users
   - Screen readers still announce the full link text

4. **External Links:**
   - `target="_blank"` paired with `rel="noopener noreferrer"` for security
   - Visual indicator icon with `aria-hidden="true"` (decorative)
   - Tooltip includes "(opens in new tab)" text for clarity

5. **Focus Management:**
   - `:focus-visible` for keyboard focus styling (not mouse clicks)
   - Custom focus ring using design tokens for consistency
   - Focus ring offset for visual separation from content

**Evidence:** From `src/components/nav/NavLinks.astro`:
```html
<a
  href={href}
  aria-current={active ? 'page' : undefined}
  data-tooltip={isCollapsed ? label : undefined}
>
  <span class="nav-links__icon" aria-hidden="true">...</span>
  <span class:list={['nav-links__label', { 'visually-hidden': isCollapsed }]}>
    {label}
  </span>
</a>
```

**Recommendation:** When building NavDrawer container:
- Implement focus trap when drawer is open
- Return focus to trigger button on close
- Announce drawer open/close state to screen readers

---

## 2026-01-18 - Focus Trap Implementation for Drawers

**Context:** Implementing focus trap for the NavDrawer component

**Insight:** Focus trap pattern for modal-like drawers follows this structure:

1. **Track focusable elements dynamically:**
   ```typescript
   function getFocusableElements(): HTMLElement[] {
     const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
     return Array.from(drawer.querySelectorAll(selector));
   }
   ```

2. **Trap Tab and Shift+Tab:**
   - When Tab on last element -> focus first element
   - When Shift+Tab on first element -> focus last element
   - Use `e.preventDefault()` to prevent default tab behavior

3. **Lifecycle management:**
   - Add keydown listener when drawer opens
   - Remove keydown listener when drawer closes
   - Use flag (`focusTrapActive`) to track state

**Evidence:** Implemented in `src/components/nav/NavDrawer.astro`:
```typescript
function handleFocusTrap(e: KeyboardEvent): void {
  if (e.key !== 'Tab' || !focusTrapActive) return;

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

**Recommendation:** Always track the element that triggered the drawer opening and return focus to it on close:
```typescript
let previousActiveElement: HTMLElement | null = null;

function openDrawer(): void {
  previousActiveElement = document.activeElement as HTMLElement;
  // ... open drawer
}

function closeDrawer(): void {
  // ... close drawer
  previousActiveElement?.focus();
  previousActiveElement = null;
}
```

---

## 2026-01-18 - Screen Reader Announcements for State Changes

**Context:** Announcing drawer state changes to assistive technology

**Insight:** Use a live region to announce important state changes:

1. **HTML structure:**
   ```html
   <div
     class="visually-hidden"
     role="status"
     aria-live="polite"
     aria-atomic="true"
     id="nav-drawer-announcer"
   ></div>
   ```

2. **Announcement function:**
   ```typescript
   function announce(message: string): void {
     if (announcer) {
       announcer.textContent = message;
       setTimeout(() => {
         announcer.textContent = '';
       }, 1000);
     }
   }
   ```

3. **When to announce:**
   - Drawer opened: "Navigation drawer opened"
   - Drawer closed: "Navigation drawer closed"
   - Collapsed: "Navigation collapsed to icon-only mode"
   - Expanded: "Navigation expanded"

**Recommendation:** Clear the announcement after a brief delay to prevent re-announcement on focus changes. Use `aria-live="polite"` for non-urgent state changes.

---

## 2026-01-18 - Dialog Role for Modal Drawers

**Context:** Applying correct ARIA roles to the navigation drawer

**Insight:** When a drawer behaves as a modal (overlay mode on mobile), it should use dialog semantics:

```html
<aside
  role="dialog"
  aria-modal="true"
  aria-label="Navigation drawer"
  aria-hidden="true"  <!-- Toggle with state -->
>
```

**Key attributes:**
- `role="dialog"`: Identifies as modal dialog
- `aria-modal="true"`: Indicates it traps focus
- `aria-label`: Provides accessible name
- `aria-hidden`: Must toggle with open state

**Evidence:** Implemented in NavDrawer.astro. The `aria-hidden` attribute is toggled via JavaScript when opening/closing:
```typescript
drawer.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
```

**Recommendation:** For desktop "push" mode where the drawer doesn't trap focus, consider using `role="complementary"` instead. The current implementation uses `dialog` consistently for simplicity, which works but is slightly more restrictive on desktop

---

## 2026-03-02 - Color Contrast: gray-400 Fails WCAG AA

**Context:** Accessibility audit of the Dead Money Awards page revealed systemic contrast failures in the editorial design system's label colors.

**Insight:** `--color-gray-400` (#9ca3af) against white (#fff) has a contrast ratio of **~2.86:1**, which fails WCAG AA for both normal text (requires 4.5:1) and large text (requires 3:1 at this size). This affects every editorial pattern that uses gray-400 for labels:
- Detail labels (0.75rem/600)
- Micro labels (0.6875rem/600)
- Table headers (0.625rem/600)
- Filter labels
- Season/date metadata
- Secondary info (team names, summaries)

**Decision:** Use `--color-gray-500` (#6b7280) instead of `--color-gray-400` for all text that must be readable. Gray-500 on white = **~4.63:1**, passing WCAG AA for normal text.

**Where gray-400 is still acceptable:**
- Decorative borders and dividers (not text)
- Placeholder text inside focused inputs (supplementary, not primary)
- Disabled state text (WCAG exempts disabled controls)

**Anti-pattern:**
```css
/* ❌ Fails AA — 2.86:1 contrast on white */
color: var(--color-gray-400, #9ca3af);

/* ✅ Passes AA — 4.63:1 contrast on white */
color: var(--color-gray-500, #6b7280);
```

**Impact:** This is a **design system-wide correction**. All pages using the editorial label patterns should migrate from gray-400 to gray-500 for text elements. The visual difference is subtle (slightly darker gray) but the accessibility improvement is significant.

**Evidence:** Dead Money Awards audit. Verified with computed styles via browser inspection.

**Recommendation:** When building new pages, use `--color-gray-500` for all label/hint text. Reserve `--color-gray-400` for non-text decorative elements only.

---

## 2026-03-02 - Badge/Pill Contrast: White Text on Colored Backgrounds

**Context:** Audit of lineup position badges on Dead Money Awards page.

**Insight:** White text (#fff) on `--color-gray-400` (#9ca3af) background has ~2.86:1 contrast — fails WCAG AA. White text on `--color-error` (#dc2626) has ~4.0:1 — passes AA for large/bold text but fails for small text (10.8px / 0.625rem).

**Decision:**
- Badges with white text on colored bg must use `--color-gray-500` (#6b7280) minimum for the background. White on gray-500 = ~4.63:1 (passes AA).
- Red badges (`--color-error-dark`, #b91c1c) provide ~4.87:1 — better for small text.
- At very small sizes (< 12px), prefer `--color-error-dark` over `--color-error` for white text.

**Pattern:**
```css
/* ❌ Fails AA — white on gray-400 */
color: #fff;
background: var(--color-gray-400, #9ca3af);

/* ✅ Passes AA — white on gray-500 */
color: #fff;
background: var(--color-gray-500, #6b7280);
```

**Evidence:** Lineup slot badges on Dead Money Awards page.

---

## 2026-03-02 - Filter-Driven View Switching: Live Region Pattern

**Context:** The Dead Money Awards page uses `<select>` filters to toggle between multiple content views. Screen readers had no way to know the content changed.

**Insight:** When filter changes cause large content areas to show/hide, a `role="status"` live region should announce what view is now displayed.

**Pattern:**
```html
<!-- Place outside the toggled content, near the top of the page -->
<div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true" id="filter-announcer"></div>
```

```typescript
const announcer = document.getElementById('filter-announcer');

function announce(message: string) {
  if (announcer) {
    announcer.textContent = message;
    setTimeout(() => { announcer.textContent = ''; }, 1000);
  }
}

// After switching views:
announce('Showing 2025 Jerry Jones Award, Starting Lineup');
announce('Showing All-Time Brock Osweiler Awards');
announce('Showing Position Worst: Quarterback');
```

**Key rules:**
- Use `aria-live="polite"` (not `assertive`) — filter changes are informational, not urgent
- Clear the text after ~1s to prevent re-announcement on focus changes
- Message should name the specific view/content now visible
- Place the live region element outside all toggled containers so it's never hidden by `display: none`

**Evidence:** Implemented on Dead Money Awards page (`src/pages/theleague/dead-money.astro`).

**Recommendation:** Apply this pattern to any page with filter-driven view toggling (e.g., player tables, ranking views).

---

## 2026-03-02 - Heading Hierarchy in Card-Based Layouts

**Context:** Dead Money Awards page had player name `<h2>` elements nested inside position sections with `<h3>` headings, creating broken heading hierarchy (h2 → h3 → h2).

**Insight:** In card-based layouts with nested sections, heading levels must reflect the document outline:

**Correct hierarchy for award/ranking pages:**
```
h1: Page title
  h2: Section/view title (e.g., "Jerry Jones Award")
    h3: Team/entity name within section
  h2: Another section (e.g., "All-Time Brock Osweiler Awards")
    h3: Player name cards
  h2: Category section (e.g., "Position Worst")
    h3: Sub-category (e.g., "Quarterback")
      h4: Player name cards within sub-category
  h2: Hall of Shame
    h3: Year group
```

**Common mistake:** Using the same heading level for both section titles and card titles when they're at different nesting levels.

**CSS note:** Use class selectors (e.g., `.dm-card-name`) rather than tag selectors (e.g., `.dm-card h2`) so the heading level can change without breaking styles.

**Evidence:** Dead Money Awards page — changed Brock Osweiler player names from `<h2>` to `<h3>`, and Position Worst player names from `<h2>` to `<h4>`.

---

## 2026-03-02 - Focus-Visible Pattern for Interactive Elements

**Context:** Audit found links and form controls with `:hover` styles but no `:focus-visible` styles, leaving keyboard users without visual feedback.

**Insight:** Every interactive element with a `:hover` state must also have a `:focus-visible` state. Use `:focus-visible` (not `:focus`) to avoid showing focus rings on mouse clicks.

**Pattern for links:**
```css
.link:hover,
.link:focus-visible {
  color: var(--color-primary-dark, #164066);
  text-decoration: underline;
}

.link:focus-visible {
  outline: 2px solid var(--color-primary, #1c497c);
  outline-offset: 2px;
  border-radius: var(--radius-sm, 0.25rem);
}
```

**Pattern for form inputs:**
```css
/* ❌ Removes native focus ring for all users */
.input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(28, 73, 124, 0.25);
}

/* ✅ Only shows custom ring for keyboard users */
.input:focus-visible {
  outline: 2px solid var(--color-primary, #1c497c);
  outline-offset: 2px;
  border-color: var(--color-primary, #1c497c);
}
```

**Key rules:**
- Never use `outline: none` on `:focus` — it removes accessibility
- Use `:focus-visible` to target keyboard navigation only
- `outline-offset: 2px` prevents the ring from overlapping content
- Match the outline color to the brand primary for consistency

**Evidence:** Dead Money Awards cross-link and filter selects.

---

## 2026-03-02 - Section Landmarks with aria-labelledby

**Context:** Dead Money Awards page had `<section>` elements without accessible names.

**Insight:** Named `<section>` elements appear as landmarks in screen reader navigation, allowing users to jump between them. Unnamed sections are ignored.

**Pattern:**
```html
<section aria-labelledby="section-heading-id">
  <h2 id="section-heading-id">Section Title</h2>
  <!-- content -->
</section>
```

**When to use:** Any `<section>` that represents a distinct content region the user might want to navigate to directly:
- Award categories (Jerry Jones, Brock Osweiler)
- Hall of Shame
- Position-specific sections

**When NOT to use:** Wrapper sections that are purely structural (e.g., a section wrapping the entire page content).

**Evidence:** Added `aria-labelledby` to Brock Osweiler, Position Worst, and Hall of Shame sections on Dead Money Awards page.
