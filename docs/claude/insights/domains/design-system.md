# Design System Insights

Domain knowledge about design tokens, CSS variables, theming, and visual patterns.

---

## 2026-01-18 - Existing CSS Variable Naming Convention

**Context:** Planning nav design tokens

**Insight:** The codebase uses CSS custom properties with a specific naming pattern.

**Evidence:** From existing stylesheets:
```css
--primary-color: #1c497c;
--secondary-color: #2e8743;
--primary-content-bg-color: #ffffff;
--primary-content-border-color: #e2e8f0;
--primary-link-hover-text-color: #b22222;
```

**Recommendation:** Follow this pattern for new components:
- Use `--{component}-{property}` for component-scoped tokens
- Reference existing global tokens where applicable
- Example: `--nav-bg` can fallback to `--primary-content-bg-color`

---

## 2026-01-18 - Box Shadow Token Pattern

**Context:** Recent commits show box shadow work

**Insight:** The codebase uses `--shadow-md` and similar tokens for consistent shadows.

**Evidence:** `src/components/theleague/Header.astro:247` uses `box-shadow: var(--shadow-md);`

**Recommendation:** Use shadow tokens rather than hardcoded values:
```css
box-shadow: var(--shadow-sm);  /* subtle */
box-shadow: var(--shadow-md);  /* default */
box-shadow: var(--shadow-lg);  /* prominent */
```

---

## 2026-01-18 - Transition Timing Function

**Context:** Planning nav drawer animations

**Insight:** Use cubic-bezier for smooth, natural-feeling transitions.

**Evidence:** From Header.astro hamburger animation:
```css
transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
```

**Recommendation:** Standard transition for UI elements:
```css
--nav-transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
```

---

## 2026-01-18 - Nav Token Architecture Complete

**Context:** Created nav design tokens for the unified navigation drawer

**Insight:** The nav tokens file (`src/assets/css/src/_nav-tokens.scss`) establishes a comprehensive design token system with:
- Dimension tokens (widths, heights, spacing scale)
- Transition tokens (timing functions, durations)
- Color tokens for light and dark modes
- Z-index layering system
- Touch target minimums for accessibility (44px)

**Key patterns implemented:**
1. **Fallback references**: Tokens reference existing global variables where possible
   ```css
   --nav-bg: var(--primary-content-bg-color, #ffffff);
   --nav-section-color: var(--primary-link-hover-text-color, #b22222);
   ```

2. **Dark mode dual support**: Both `@media (prefers-color-scheme: dark)` AND `.dark` class for manual toggle

3. **Semantic grouping**: Tokens organized by purpose (dimensions, transitions, colors, etc.)

**Evidence:** `src/assets/css/src/_nav-tokens.scss` - 250+ lines of design tokens

**Recommendation:** When creating new component token files:
- Import early in main SCSS (before component styles)
- Group by category with clear comments
- Provide fallbacks to existing global tokens
- Support both dark mode methods

---

## 2026-01-18 - SCSS Import Order for Tokens

**Context:** Adding nav tokens to main SCSS files

**Insight:** Design token files should be imported after reset/fonts but before component styles.

**Evidence:** Updated both `theleague_main.scss` and `afl_main.scss`:
```scss
@use "./fonts";
@use "./reset";

//// Design Tokens (load before components)
@use "./nav-tokens";

//// Alphabetical (components)
```

**Recommendation:** Follow this order for SCSS imports:
1. Fonts
2. Reset/normalize
3. Design tokens (CSS custom properties)
4. Components (alphabetical)

---

## 2026-01-18 - Nav Tokens Must Be in tokens.css

**Context:** Nav drawer CSS variables weren't working because the demo page didn't load the compiled SCSS

**Insight:** Nav tokens must be defined in `src/styles/tokens.css` (the single source of truth), not just in `_nav-tokens.scss`. This ensures:
1. Nav components work in any page that imports tokens.css
2. No dependency on the full compiled SCSS bundle
3. Consistent values across all contexts (demo pages, layouts, etc.)

**Decision:** All `--nav-*` CSS custom properties are now defined in both:
- `src/styles/tokens.css` - Primary source, always available
- `src/assets/css/src/_nav-tokens.scss` - For pages using the full SCSS bundle

**Evidence:** Nav drawer failed on `/nav-demo` because it only imported tokens.css, not theleague_main.css

**Recommendation:**
- When adding new nav tokens, add them to BOTH files
- Use fallback values in component CSS as defensive coding: `var(--nav-team-logo-size, 40px)`
- The tokens.css file is the canonical source; keep _nav-tokens.scss in sync

---

## 2026-01-18 - Icon Assignment: Next Year Summary = Chalkboard

**Context:** Choosing the right icon for the Next Year Summary nav link

**Decision:** The **chalkboard** icon (`icon-chalkboard`) must always be used for the "Next Year Summary" page/link.

**Rationale:** The chalkboard icon visually represents planning and forecasting, which aligns with the purpose of previewing next year's roster and salary commitments.

**Evidence:** `src/config/nav-config.json` - "next-year" link uses `"icon": "chalkboard"`

**Recommendation:** If creating any new links or references to the Next Year Summary feature, always use the chalkboard icon for consistency.

---

## 2026-03-01 - Editorial Design Standard (Modal-Derived)

**Context:** The PlayerDetailsModal, ContractDeclarationModal, and other modal components established a refined editorial design language that is now the standard for all new pages and components.

**Insight:** The "editorial design" is characterized by specific typography, spacing, color, and layout patterns that create a clean, data-dense, sports-editorial feel. New pages must follow these patterns.

### Typography Hierarchy

| Role | Size | Weight | Color | Extra |
|------|------|--------|-------|-------|
| **Hero/Page Title** | 1.35rem | 700 | gray-900 | line-height: 1.2 |
| **Section Title** | 0.75rem | 700 | gray-900 | UPPERCASE, 0.06em letter-spacing, left border accent |
| **Body/Values** | 0.875rem | 400–500 | gray-700 | `font-variant-numeric: tabular-nums` for numbers |
| **Meta/Secondary** | 0.875rem | 500 | gray-600 | Supporting info below titles |
| **Detail Label** | 0.75rem | 600 | gray-500 | UPPERCASE, 0.04em letter-spacing |
| **Micro Label** | 0.6875rem | 600 | gray-500 | UPPERCASE, 0.05em letter-spacing (metric cards) |
| **Table Header** | 0.625rem | 600 | gray-500 | UPPERCASE |

### Section Title Pattern (Signature Element)

The left-border accent on uppercase section titles is the most recognizable editorial pattern:
```css
.section-title {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-gray-900, #111827);
  padding-left: 0.625rem;
  border-left: 2px solid var(--color-primary, #1c497c);
}
```

### Key Metrics Strip

3-column grid for hero-level stats:
```css
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.625rem;
}
.metric-card {
  background: var(--color-gray-50, #f9fafb);
  border: 1px solid var(--content-border, #e2e8f0);
  border-radius: var(--radius-md, 0.5rem);
  padding: 0.5rem;
  text-align: center;
}
.metric-value {
  font-size: 1.25rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.metric-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-gray-500);
}
```

### Detail Row Pattern

Label + value rows separated by subtle borders (NOT a table — flexbox):
```css
.detail-row {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--color-gray-50, #f9fafb);
}
.detail-label {
  width: 4.5rem;
  flex-shrink: 0;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-gray-500);
  text-align: right;
}
.detail-value {
  font-size: 0.875rem;
  color: var(--color-gray-700);
}
```

### Pill/Badge Pattern

Compact metadata indicators:
```css
.pill {
  background: var(--color-gray-100, #f3f4f6);
  padding: 0.2rem 0.6rem;
  border-radius: var(--radius-full, 9999px);
  font-size: 0.8125rem;
  font-weight: 600;
  white-space: nowrap;
}
```
Semantic variants use light background + dark text (e.g., info: `#f0f9ff` bg, `#0369a1` text).

### Table Styling

```css
/* Header */
thead th {
  background: var(--color-gray-50);
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-gray-500);
  position: sticky;
  top: 0;
}

/* Rows */
tbody td {
  padding: 0.3rem 0.5rem;
  font-size: 0.75rem;
  color: var(--color-gray-700);
  border-bottom: 1px solid var(--color-gray-50);
}
tbody tr:hover { background: var(--color-gray-50); }

/* Footer/totals */
tfoot td {
  border-top: 1px solid var(--content-border);
  background: var(--color-gray-50);
  font-weight: 600;
}
```

### Modal Shell (Reference)

When building new modals or overlays:
- Overlay: `rgba(15, 23, 42, 0.45)` + `backdrop-filter: blur(2px)`
- Modal: `max-width: 580px`, `border-radius: var(--radius-lg)`, `box-shadow: var(--shadow-xl)`
- Body padding: 1.75rem desktop, 1.25rem mobile
- Entry animation: `0.32s ease-out` scale(0.96→1) + translateY(12px→0) — see ContractDemoOverlay `cdemo-card-enter`
- Mobile entry: `0.3s ease-out` translateY(100%→0) (bottom sheet slide-up)
- Close button: 32px circle, gray-100 bg, gray-500 icon, absolute top-right
- Mobile (≤640px): bottom-sheet style (`align-items: flex-end`, top-only radius)

### Selected State Pattern (Cards/Options)

Interactive selection uses a left border accent + subtle gradient:
```css
.option-selected {
  border-left: 2px solid var(--color-primary, #1c497c);
  background: linear-gradient(135deg, #f0f5fa 0%, #e8eff7 100%);
  box-shadow: 0 1px 3px rgba(28, 73, 124, 0.08);
}
```

### Color Usage Rules

| Purpose | Token | Fallback | Contrast on #fff |
|---------|-------|----------|------------------|
| Primary text | `--color-gray-900` | `#111827` | 16.75:1 |
| Secondary text | `--color-gray-700` | `#374151` | 9.33:1 |
| Tertiary text | `--color-gray-600` | `#4b5563` | 6.40:1 |
| **Labels/hints** | **`--color-gray-500`** | **`#6b7280`** | **4.63:1 ✓ AA** |
| Accent/brand | `--color-primary` | `#1c497c` | 7.22:1 |
| Subtle bg | `--color-gray-50` | `#f9fafb` | — |
| Borders | `--content-border` | `#e2e8f0` | — |
| Light borders | `--color-gray-50` | `#f9fafb` | — |

> **A11y correction (2026-03-02):** Labels/hints was previously `--color-gray-400` (#9ca3af, ~2.86:1) which **fails WCAG AA**. Corrected to `--color-gray-500` (#6b7280, ~4.63:1). Reserve gray-400 for non-text elements only (borders, decorative dividers, disabled controls).

### Defensive CSS

Always use token fallbacks: `var(--color-gray-700, #374151)`. This ensures components render correctly even if tokens.css fails to load.

### Responsive Rules

- Mobile breakpoint: `max-width: 640px`
- Reduce padding: 1.75rem → 1.25rem
- Shrink hero elements (avatars, titles) by ~25%
- Hide lower-priority table columns
- Use `:global()` for styles targeting JS-inserted DOM

**Evidence:** PlayerDetailsModal.astro (1072 lines), ContractDeclarationModal.astro, PlayerInjuryModal.astro, PlayerNewsModal.astro

**Recommendation:** Before building any new page or component, reference these patterns. The PlayerDetailsModal is the canonical implementation. When in doubt, match its typography, spacing, and color choices.

---

## 2026-03-01 - Button & CTA System (Official Decision)

**Context:** Formalizing the button/CTA hierarchy based on the demo modal's navigation buttons.

**Decision:** The dark blue button (`var(--color-primary, #1c497c)`) from the `ContractDemoOverlay` demo modal ("Next" / "Start Exploring") is the **official primary CTA** for the site — whether implemented as a `<button>` or an `<a>` anchor tag.

### Element Selection Rule

| Element | When to use |
|---------|-------------|
| `<button>` | In-page actions — submit form, open modal, trigger JS |
| `<a href>` | Navigation — links to pages, external URLs, anchors |

The CSS classes (`.btn--primary`, `.btn--secondary`, `.btn--ghost`) are identical for both. **Never use `<a>` without an `href`, and never use `<button>` for navigation.**

### CTA Hierarchy

| Variant | Token | Color | When to use |
|---------|-------|-------|-------------|
| **Primary** | `--btn-primary-bg` | `#1c497c` (dark blue) | Default CTA — modals, forms, page-level actions, link CTAs |
| **Secondary** | `--btn-secondary-bg` | `#2e8743` (green) | Select spaces only — affirmative/go actions (bid submit, roster confirm) |
| **Ghost / Text** | transparent | `--color-gray-500` | Low-emphasis; paired with a primary CTA (e.g. "Back", "Cancel") |

### Primary CTA Spec (from demo modal)
```css
display: inline-flex;
align-items: center;
justify-content: center;
background: var(--btn-primary-bg, #1c497c);
color: var(--btn-primary-text, #fff);
font-size: 0.8125rem;
font-weight: 600;
border-radius: 8px;
padding: 0.625rem 1.25rem;
border: none;
text-decoration: none; /* required when applied to <a> */
transition: background 0.15s ease;

/* Hover */
background: var(--btn-primary-bg-hover, #164066);
```

### Green CTA (Secondary) Usage Rule

The green CTA (`--btn-secondary-bg`) is **not a general-purpose CTA**. It is reserved for contexts where green communicates "go", "approve", or positive affirmation (e.g. submitting an auction bid, confirming a roster action). Default to primary blue in all other cases.

### Canonical Reference

- Live demos: `src/pages/theleague/design-system.astro` (Buttons & CTAs section)
- Tokens: `src/styles/tokens.css` under `--btn-primary-*` and `--btn-secondary-*`
- Source pattern: `.cdemo-nav__next` / `.cdemo-nav__start` in `src/components/theleague/ContractDemoOverlay.astro`

**Recommendation:** Use `--btn-primary-bg` and `--btn-secondary-bg` tokens. Never hardcode `#1c497c` or `#2e8743` directly in CTA styles — always go through the token layer.

---

## 2026-03-01 - Slide Animation System (from ContractDemoOverlay)

**Context:** Documenting the four animation patterns established in the contract demo walkthrough modal.

**Source:** `src/components/theleague/ContractDemoOverlay.astro`

### Animation Catalog

| Name | Keyframes | Duration | Use Case |
|------|-----------|----------|----------|
| **Card Enter** | scale(0.96→1) + translateY(12px→0) + fade | 0.32s ease-out | Desktop modal/card entrance |
| **Slide Up** | translateY(100%→0) | 0.3s ease-out | Mobile bottom-sheet modals |
| **Panel In** | translateX(16px→0) + fade | 0.3s ease-out | Step-to-step transitions within a modal |
| **Trigger Enter** | translateX(100%→0) + fade | 0.5s ease-out, 1.5s delay | Floating edge-anchored CTAs |

### Motion Rules

- **Entrances:** Always `ease-out` (decelerate into place)
- **Duration range:** 0.2s–0.35s for UI elements; 0.5s max for dramatic reveals
- **Fill mode:** `forwards` when starting from `opacity: 0`
- **Stagger delays:** 0.05s increments for list items
- **Mobile override:** Prefer slide-up (bottom sheet) over scale-enter on small screens
- **Interactive transitions:** `0.3s cubic-bezier(0.4, 0, 0.2, 1)` for hover/focus state changes

### Astro `<style>` Gotcha

`@keyframes` work fine inside scoped `<style>` blocks, but `{ }` characters inside `<code>` HTML tags in the template must be escaped using `set:html` (e.g., `<code set:html="'@keyframes foo { ... }'" />`) to avoid Astro treating them as JS expressions.

**Live demos:** `src/pages/theleague/design-system.astro` (Animation & Motion section)

---

## 2026-03-02 - Negative/Warning State Pattern (Subtle Red Accents)

**Context:** Redesigning the Dead Money Awards page to use the editorial design system. The original page used large red background blocks (gradient fills, pink cards) to indicate "bad" items. This was overpowering and inconsistent with the editorial language.

**Decision:** Negative/warning states use **subtle left-border accents** — never large colored backgrounds.

### Pattern: Winner/Worst Card (Left-Border Accent)

For ranking cards where #1 is the "worst" or "winner" of a negative award:
```css
.rank-card-worst {
  border-left: 3px solid var(--color-error, #dc2626);
  box-shadow: var(--shadow-md);
}
```
The elevated shadow + red left-border is sufficient. The badge, red numeric text, and rank number already communicate hierarchy. **Never use** `background: linear-gradient(... error-light ...)` or full red borders on cards.

### Pattern: Negative Data Card (Shame/Zero-Value)

For cards representing negative data (zero-point players, wasted salary):
```css
.negative-card {
  background: var(--color-gray-50, #f9fafb);
  border: 1px solid var(--content-border, #e2e8f0);
  border-left: 2px solid var(--color-error, #dc2626);
  border-radius: var(--radius-md, 0.5rem);
}
```
The neutral gray-50 background keeps cards visually consistent with the rest of the page. The red left-border is the only color signal — paired with red text on key values (e.g., salary amounts).

### Anti-Pattern: Colored Background Blocks

**Never do this:**
```css
/* ❌ Too heavy — overwhelms the editorial layout */
background: var(--color-error-light, #fee2e2);
border: 1px solid #fecaca;

/* ❌ Red gradient fills are not editorial */
background: linear-gradient(135deg, #fff5f5 0%, #ffffff 100%);
border: 2px solid var(--color-error);
```

### Section Title Variant (Red Accent)

For section titles that mark negative/shame sections, override the left-border color:
```css
.section-title--negative {
  border-left-color: var(--color-error-dark, #b91c1c);
}
```
This keeps the editorial section-title pattern intact while signaling the section's tone.

**Evidence:** Dead Money Awards page redesign (`src/pages/theleague/dead-money.astro`) — Hall of Shame cards, Jerry Jones winner cards.

**Recommendation:** When building award/ranking pages with negative connotations, rely on:
1. Left-border color accents (2-3px)
2. Red text on key numeric values
3. Badge components for labels
4. Elevated shadow for #1/winner emphasis
Never flood a card or section with colored backgrounds.
