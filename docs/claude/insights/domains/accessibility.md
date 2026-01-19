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
