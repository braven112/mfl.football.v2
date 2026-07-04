# Design System Insights

Domain knowledge about design tokens, CSS variables, theming, and visual patterns.

---

## 2026-03-02 - Editorial Hero Banner Pattern

**Context:** Homepage hero redesign to match the magazine/editorial style from `about.astro`.

**Pattern name:** `HeroBanner` with `variant="editorial"`

**Component:** `src/components/theleague/HeroBanner.astro`

**Design:** Transparent background (blends into page), large bold title (800 weight, `clamp(1.75rem, 2.5vw + 0.75rem, 2.5rem)`), eyebrow badge + date, summary, two-action row (primary CTA button + text link). Image floats right in a tilted browser-frame when available.

**Key props:**
```astro
<HeroBanner
  variant="editorial"
  title="Large headline here"
  summary="Body copy — max 54ch"
  link="/feature-page"
  linkLabel="Read more"
  kicker="New Feature"       <!-- gray pill badge, uppercase -->
  kickerDate="Mar 2, 2026"   <!-- date next to badge -->
  allNewsLink="/theleague/whats-new"
  allNewsLabel="All releases"
  image="feature-screenshot.webp"  <!-- optional, goes RIGHT -->
  imageAlt="Screenshot of feature"
/>
```

**Layout rules:**
- Text on the LEFT, image on the RIGHT (normal flex row — not `row-reverse` like the old card variant)
- No card background, border, or box-shadow — blends into page `var(--page-bg)`
- Mobile (<700px): stacks vertically, image below text
- The section header label ("Featured News" + "View all releases" link) was removed from the parent — the `allNewsLink` prop handles that link inline

**Where used:** Homepage (`src/pages/theleague/index.astro`) — always `variant="editorial"` now.

**Eyebrow data source:** `hero-resolver.ts` → `featureToHero()` sets `kicker` from `WHATS_NEW_CATEGORY_LABELS[entry.category]` and `kickerDate` from `formatKickerDate(entry.date)`.

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

> **AFL font-size exception:** AFL uses UFC Sans Condensed, which renders visually smaller than The League's Vend Sans at the same rem value. AFL section-title components use `font-size: 0.9rem` (not 0.75rem) to compensate. When bumping section titles in AFL components, use 0.9rem. When bumping in TheLeague components, use 0.75rem (already standard). Don't accidentally "fix" one by copying from the other.

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

### Section Header with Subtitle Pattern

When a section title needs a descriptive subtitle, wrap both in a `.section-header` container so the left-border accent spans both lines. This keeps the title and subtitle visually unified as a single label block, rather than the subtitle dangling loose below the border.

**HTML:**
```html
<div class="section-header">
  <h3 class="section-header__title">NFL Analysis</h3>
  <p class="section-header__sub">Players on the same NFL team</p>
</div>
```

**CSS:**
```css
.section-header {
  padding-left: 0.625rem;
  border-left: 2px solid var(--color-primary, #1c497c);
  margin-bottom: 0.75rem;
}

.section-header__title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-gray-900, #111827);
  line-height: 1;
}

.section-header__sub {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  color: var(--color-gray-400, #9ca3af);
  line-height: 1.3;
}
```

**When to use:**
- Section title + subtitle (e.g., "NFL Analysis" / "Players on the same NFL team")
- Any editorial section heading that needs a clarifying description

**When NOT to use (use standalone section title instead):**
- Section titles without subtitles (e.g., "Cap Analysis") — use the plain `.section-title` pattern above

**Evidence:** First implemented in `src/pages/theleague/rosters.astro` for the NFL Analysis and College Analysis sections in the Analytics view.

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

**CRITICAL:** When building new modals or overlays, the backdrop MUST use the frosted-glass blur effect. Never use a plain dark overlay without blur — this is a core part of the site's visual identity.
- **Overlay (mandatory):** `rgba(15, 23, 42, 0.45)` + `backdrop-filter: blur(2px)` — the blur is NOT optional
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

## 2026-03-02 - Page Toolbar / Section Header Row Pattern

**Context:** Applied while aligning the Free Agents page (`src/pages/theleague/players.astro`) with the editorial design standard. The toolbar row below a hero or section break needed editorial identity.

**Insight:** Pages with data tables benefit from a "toolbar row" that combines the editorial section title (left-border accent) with a live count display and optional action buttons (view toggles, filters). This is the page-level analog to the modal section title.

### Toolbar Pattern

```html
<div class="players-toolbar">
  <div class="toolbar-left">
    <h2 class="section-title">Available Players</h2>
    <span class="count-display" aria-live="polite">
      <strong id="showing-count">50</strong> of <strong id="total">0</strong>
    </span>
  </div>
  <div class="toolbar-center">
    <!-- optional: view toggle pills -->
  </div>
  <div class="toolbar-right">
    <!-- action button (Filters, Export, etc.) -->
  </div>
</div>
```

```css
.players-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.875rem 0 0.625rem;
  border-bottom: 1px solid var(--color-gray-50, #f9fafb);
  flex-wrap: wrap;
}
.toolbar-left {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
}
/* Section title: the standard editorial left-border accent */
.section-title {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-gray-900, #111827);
  padding-left: 0.625rem;
  border-left: 2px solid var(--color-primary, #1c497c);
  margin: 0;
  line-height: 1.2;
  white-space: nowrap;
}
/* Count display alongside section title */
.count-display {
  font-size: 0.75rem;
  color: var(--color-gray-400, #9ca3af);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.count-display strong {
  color: var(--color-gray-700, #374151);
  font-weight: 600;
}
```

**Key rules:**
- Section title always uses the left-border accent (`border-left: 2px solid var(--color-primary)`)
- Count uses `baseline` alignment with title so numbers sit on same text baseline
- `aria-live="polite"` on the count container for screen reader updates
- On mobile: `toolbar-left` can `flex-wrap: wrap` and `gap: 0.5rem`

**Source:** `src/pages/theleague/players.astro` (toolbar section)

---

## 2026-03-02 - Filter Panel Section Title Pattern

**Context:** Applied to the collapsible filter panel on the Free Agents page.

**Insight:** Any collapsible panel, drawer, or expandable section that contains grouped controls should open with an editorial section title. This provides visual hierarchy and confirms to the user what context they're in.

### Filter Panel Pattern

```html
<div class="filters-panel__inner">
  <h3 class="section-title">Filters</h3>
  <div class="filters-grid">
    <!-- filter groups -->
  </div>
</div>
```

Filter labels follow the **Detail Label** spec from the editorial standard:
```css
.filter-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-gray-400, #9ca3af);  /* NOT gray-500 */
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
```

**Common mistake:** Using `gray-500` for filter labels. Editorial standard uses `gray-400` for all uppercase labels.

**Source:** `src/pages/theleague/players.astro` (filters-panel section)

---

## 2026-03-02 - Table Header: Gray-50 Editorial Standard (Production Confirmed)

**Context:** Converting the Free Agents page from the dark gradient table header to the editorial standard.

**Decision:** The `--table-header-gradient` token (dark blue) is **NOT** the editorial standard for tables. It is a legacy pattern. New pages and refactored pages must use the gray-50 editorial header.

### Correct Table Header CSS

```css
.my-table thead {
  background: var(--color-gray-50, #f9fafb);
  position: sticky;
  top: 0;
  z-index: 10;
  border-bottom: 1px solid var(--content-border, #e2e8f0);
}
.my-table th {
  padding: 0.5rem 0.375rem;
  font-size: 0.625rem;      /* NOT 0.7rem or 0.75rem */
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-gray-400, #9ca3af);
  white-space: nowrap;
}
/* Hover state (light bg) */
.my-table th.sortable:hover {
  background: var(--color-gray-100, #f3f4f6);
  color: var(--color-gray-600, #4b5563);
}
/* Sorted state */
.my-table th.sorted {
  background: rgba(28, 73, 124, 0.06);
  color: var(--color-primary, #1c497c);
}
```

**Anti-pattern:** Using `rgba(255,255,255,0.1)` for hover/sorted — this only works on dark backgrounds and is invisible on the editorial gray-50 header.

**The `--table-header-gradient` token** is still defined in tokens.css for backwards compatibility but should not be used in new work.

**Source:** `src/pages/theleague/players.astro` (table styles, confirmed 2026-03-02)

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

---

## 2026-03-02 - Broadcast Diagonal Cut (Flair Pattern)

**Context:** Redesigning the Free Agents hero section to give the rotating player photos a distinctive sports-media presence. Iterated through several approaches (desaturated watermark, bordered frame, sports card with header/footer strips) before landing on the broadcast diagonal cut inspired by ESPN, FOX Sports, and CBS NFL broadcast graphics packages.

**Decision:** The **broadcast diagonal cut** is an official design element for adding visual flair to sections that benefit from bold, sports-forward energy. It should be used sparingly — for hero sections, feature highlights, or promotional areas — not for everyday data layouts. Think of it as the design system's "broadcast mode."

### When to Use

- **Hero sections** with featured imagery (players, action shots, promo graphics)
- **Feature callouts** or marketing areas that need visual punch
- **Landing page accents** where the editorial standard alone feels too restrained
- Any context where you'd see a similar treatment on ESPN SportsCenter or FOX NFL Sunday

### When NOT to Use

- Data tables, forms, modals, or utility UI
- Anywhere the diagonal geometry would compete with content readability
- Stacked/repeated — one broadcast cut per page maximum

### Core Technique: Parallelogram Clip-Path

The photo container uses `clip-path: polygon()` to create a parallelogram where both diagonal edges slant at the same angle. The key is that both left and right edges have an identical slope (20% horizontal shift over the full height), creating true parallel lines.

```css
/* Container: parallelogram with matching diagonal edges */
.broadcast-photo {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 50%;
  overflow: hidden;
  pointer-events: none;
  /* Left edge: 20%→0%, Right edge: 110%→90% (same 20% slope) */
  /* Right point starts off-screen (>100%) so the diagonal */
  /* enters the visible area partway down, showing only a  */
  /* small corner of background on the bottom-right         */
  clip-path: polygon(20% 0, 110% 0, 90% 100%, 0% 100%);
  background: var(--color-gray-900, #111827);
}
```

### Accent Stripes

Thin primary-blue stripes run along each diagonal edge using pseudo-elements with their own `clip-path` polygons. The stripe width is 2.5% of the container. The gradient direction is reversed between left and right for visual balance.

```css
/* Left accent stripe */
.broadcast-photo::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 3;
  background: linear-gradient(
    to bottom,
    var(--color-primary, #1c497c) 0%,
    rgba(28, 73, 124, 0.6) 100%
  );
  clip-path: polygon(20% 0, 22.5% 0, 2.5% 100%, 0% 100%);
  pointer-events: none;
}

/* Right accent stripe (parallel, same slope) */
.broadcast-photo::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 3;
  background: linear-gradient(
    to bottom,
    rgba(28, 73, 124, 0.6) 0%,
    var(--color-primary, #1c497c) 100%
  );
  clip-path: polygon(110% 0, 107.5% 0, 87.5% 100%, 90% 100%);
  pointer-events: none;
}
```

### Geometry Rules

The parallelogram math must keep both edges parallel:

| Parameter | Left Edge | Right Edge | Rule |
|-----------|-----------|------------|------|
| Top point | 20% | 110% (off-screen) | Difference must match |
| Bottom point | 0% | 90% | Difference must match |
| Slope | 20% leftward | 20% leftward | **Identical** = parallel |
| Stripe width | 2.5% | 2.5% | Match for symmetry |

To adjust how much corner shows on the right, shift both right points equally:
- **More corner:** decrease values (e.g., 105%→85%)
- **Less corner:** increase values (e.g., 115%→95%)
- **No right corner:** use 120%→100% (line exits off-screen entirely)

### Photo Treatment

Images inside the broadcast cut should feel vivid and present — not faded or desaturated:

```css
.broadcast-photo img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 50% 20%;
  filter: brightness(1.02) contrast(1.1) saturate(1.15);
}
```

### Mobile Behavior

Hide the broadcast photo element entirely below 767px. The diagonal geometry doesn't scale well to narrow viewports and competes with content:

```css
@media (max-width: 767px) {
  .broadcast-photo {
    display: none;
  }
}
```

### Design Lineage

This pattern draws directly from NFL broadcast graphics:
- **ESPN NFL** — angular geometric player frames with team-color accents
- **FOX Sports** — diagonal clip-path layouts with bold color bars
- **CBS NFL** — angled lower-thirds with gradient accent stripes

The parallelogram shape (vs. a simple trapezoid) was chosen because it creates visual motion — the parallel lines imply speed and dynamism, which is the exact energy sports broadcast graphics are designed to convey.

**Source:** `src/pages/theleague/players.astro` (hero section, confirmed 2026-03-02)

**Recommendation:** When a page needs flair beyond the editorial standard, reach for the broadcast diagonal cut. It pairs well with the editorial light background (gray-50) because the dark photo area creates natural contrast. Reserve it for one hero-level element per page to maintain impact.

---

## 2026-03-14 - Token Fallback Correctness in React Inline Styles

**Context:** Trade Builder design system alignment revealed widespread incorrect CSS variable fallbacks in inline `<style>` blocks within React components.

**Common mistakes found:**
- `--color-warning-dark` fallback was `#92400e` (amber-900) but token is `#d97706` (amber-600)
- `--color-error-light` fallback was `#fef2f2` (red-50) but token is `#fee2e2` (red-100)
- `--color-success-light` fallback was inconsistent (`#ecfdf5`, `#f0fdf4`, `#dcfce7`) — token is `#d1fae5`
- `--content-border` fallback was sometimes `#d1d5db` (gray-300) — token is `#e2e8f0` (slate-200)

**Rule:** When adding `var(--token, #fallback)`, always verify the fallback against `src/styles/tokens.css`. Never guess from memory.

**Focus-visible pattern:** Every interactive button in inline `<style>` blocks needs explicit `:focus-visible` — the global tokens.css rule may be overridden by inline specificity. Standard pattern:
```css
.my-btn:focus-visible {
  outline: 2px solid var(--color-primary, #1c497c);
  outline-offset: 2px;
}
```

**Contrast rule for small white-on-color text:** At `0.75rem` (12px), white text on `--color-error` (#dc2626) is borderline (~4.0:1). Use `--color-error-dark` (#b91c1c, ~4.87:1) for backgrounds with white text at small sizes.

---

## 2026-03-14 - CRITICAL: Use Inset Box-Shadow for Table Row Indicators, Never border-left

**Context:** League Summary page had a preferred team highlight using `border-left: 3px solid` on a `<tr>`. This created a visible white gap between the row border and the table header because `border-left` on table rows doesn't span the full visual row height — it's interrupted by row spacing, cell padding, and border-collapse behavior.

**Rule:** When highlighting a table row with a colored left indicator, **always use `box-shadow: inset` on the first `<td>`**, never `border-left` on the `<tr>` or `<td>`.

**Pattern:**
```css
/* ❌ WRONG — creates white gap between rows */
.table-row--highlighted {
  border-left: 3px solid var(--color-primary);
}

/* ❌ STILL WRONG — gap between cell border and row spacing */
.table-row--highlighted td:first-child {
  border-left: 3px solid var(--color-primary);
}

/* ✅ CORRECT — seamless indicator with no gaps */
.table-row--highlighted td:first-child {
  box-shadow: inset 3px 0 0 var(--color-primary, #1c497c);
}
```

**Why box-shadow works:** It paints inside the cell's box without affecting layout or creating gaps. Unlike `border-left`, it doesn't participate in border-collapse calculations and isn't interrupted by row spacing.

**When this applies:**
- Preferred/selected team highlighting in multi-team tables
- Active row indicators in any sortable data table
- "My team" highlighting in standings, league summary, or comparison views
- Any table where a colored left-edge indicator marks a specific row

**When border-left is fine:**
- Section titles (editorial accent) — block elements, not table rows
- Cards and panels — no row-spacing gap issue
- `<thead> <tr>` with nearly-invisible gray spacer borders

**Evidence:** `src/components/theleague/LeagueSummaryTable.astro` — preferred team row highlight.

**Known instances that need this fix:**
- **`src/pages/theleague/rosters.astro`** (lines 4095–4132): `.roster-row` uses `border-left: 4px solid transparent` with colored variants for active (green `#57b881`), practice (blue `#487ae7`), injured (red `#e56263`), and contract-action (amber `#f59e0b`). These are all on `<tr>` elements and will show the same gap. Fix: change all to `box-shadow: inset 4px 0 0 {color}` on the first `<td>`.
- **`src/pages/theleague/rosters.astro`** (line 4221): `.roster-row--contract-action` uses `border-left: 3px solid #f59e0b !important` — same issue.
- Any future multi-team table that highlights rows (standings, league comparison, draft order, etc).

**Pages where border-left is fine (not table rows):**
- Section titles, cards, chips, buttons — these are block/inline elements where border-left works correctly.

---

## 2026-03-15 - Chart.js Editorial Design Pattern (Canonical)

**Context:** First chart in the editorial design system — salary history page with multi-dataset line charts.

**Insight:** Chart.js renders on `<canvas>`, which cannot read CSS custom properties. Chart colors, grid colors, and font sizes must be passed as hex/rgba values directly in the JS config. CSS tokens exist for HTML elements (legend, tooltip) but JS must mirror them for canvas rendering.

**Canonical file:** `src/pages/theleague/salary-history.astro`

**Chart palette tokens** (added to `src/styles/tokens.css`):
```css
--chart-color-1: #3b6b9a;   /* Steel Blue */
--chart-color-2: #c0623a;   /* Burnt Sienna */
--chart-color-3: #1a7a6d;   /* Dark Teal */
--chart-color-4: #7b5ea7;   /* Slate Purple */
--chart-color-5: #b8860b;   /* Goldenrod */
--chart-color-6: #5a6672;   /* Graphite */
--chart-grid-color: rgba(0, 0, 0, 0.06);
--chart-tick-color: var(--color-gray-500);
--chart-border: var(--content-border);
```

**Key patterns:**
1. **Muted palette** — 6 colors chosen for distinguishability and editorial feel (no Chart.js defaults)
2. **Hidden points** — `pointRadius: 0, pointHoverRadius: 5` for clean lines with hover reveal
3. **Custom external tooltip** — `tooltip.enabled: false` + `external: handler` for DOM-based tooltip matching site typography
4. **Custom legend** — `legend.display: false` + JS-built legend with `role="toolbar"` for keyboard access
5. **No axis titles** — Context provided by section header, not chart chrome
6. **Compact currency** — `$14M` not `$14,000,000` via custom tick callback
7. **Segmented control tabs** — ARIA tablist pattern for switching datasets
8. **Collapsible data table** — `<details>` element with full tabular data for a11y

**ViewTransitions lifecycle:**
```js
// Dynamic Chart.js loading (replaces CDN <script> tag)
function ensureChartJS() {
  if (window.Chart) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// Cleanup on navigation
const ac = new AbortController();
document.addEventListener('astro:before-swap', () => {
  chart.destroy();  // Prevent canvas memory leak
  ac.abort();       // Remove resize listener
}, { once: true });
window.addEventListener('resize', handler, { signal: ac.signal });
```

**Gotchas:**
- CDN `<script is:inline src>` causes race condition with `astro:page-load` — use dynamic loading with `ensureChartJS()` instead
- Chart.js CDN `<script>` tags don't re-execute on ViewTransitions navigation — must use `astro:page-load` listener
- `chart.destroy()` on `astro:before-swap` prevents canvas memory leaks across navigations
- AbortController pattern prevents resize listener accumulation
- `aspectRatio` (not fixed height) for responsive charts: `isMobile ? 1.4 : 2.2`

**Recommendation:** All future charts should follow this file as the canonical reference. Reuse the palette tokens, the tooltip pattern, the legend pattern, and the ViewTransitions cleanup.

---

## 2026-03-15 - Container Query Units for Responsive Metric Cards

**Context:** Salary Analytics editorial redesign — 3-column metric grids showing dollar values ($4,209,425) overflowed on both mobile and desktop when position cards were narrow.

**Insight:** Fixed font sizes (even with mobile media queries) can't adapt to the actual card width. Using `container-type: inline-size` on the card and `clamp()` with `cqi` units makes text scale with the container, not the viewport.

**Pattern:**
```css
.position-card {
  container-type: inline-size;
}
.metric-value {
  font-size: clamp(0.875rem, 1.8cqi, 1.125rem);
}
.metric-label {
  font-size: clamp(0.5625rem, 1.2cqi, 0.6875rem);
}
```

**Why this works:** On desktop with 3 position cards per row, each card is ~400px so `cqi` maps to a comfortable size. On mobile at 375px full-width, the same units produce a slightly smaller but readable size. No separate media query needed.

**Also:** Use `min()` in grid templates to prevent cards from forcing horizontal scroll: `grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr))`.

---

## 2026-03-15 - JS-Created Rows Need :global() for Astro Scoped Styles

**Context:** Salary Analytics tables — `<tbody>` is empty at SSR and rows are injected by client-side JS (`buildPlayerRow()`).

**Insight:** Astro scoped styles add `[data-astro-cid-xxx]` attributes only to elements rendered at build time. JS-created elements don't have these attributes, so scoped selectors like `.editorial-table tbody tr:first-child td` won't match them.

**Fix:** Wrap the dynamic-element portion of the selector in `:global()`:
```css
/* ❌ Won't match JS-created rows */
.editorial-table tbody tr:first-child td { padding-top: 0.625rem; }

/* ✅ Scoped to the table (SSR), global for the rows (JS) */
.editorial-table :global(tbody tr:first-child td) { padding-top: 0.625rem; }
```

**Recommendation:** Any page with JS-populated table bodies, lists, or containers must use this pattern. The parent element (`.editorial-table`) stays scoped for isolation, but child selectors for dynamic content use `:global()`.

---

## 2026-06-24 - EventHeroShell Pill is White-on-Accent — Accents Must Clear Contrast

**Context:** TheLeague's branded homepage hero (`EventHeroShell.astro`) renders its eyebrow pill as `background: var(--ev-accent); color: #fff;`. The `--ev-accent` value comes per-event from `CATEGORY_ACCENT` in `src/utils/league-event-hero-view.ts` (keyed by calendar category: preseason / free-agency / draft / regular-season).

**Insight:** Because the pill is white text on the raw accent color (13px bold uppercase — *not* WCAG "large" text, which starts at 14pt bold / 18.66px), every accent must clear ≥4.5:1 against white for AA. The original preseason accent `#60a5fa` (light blue) measured only ~2.5:1 and rendered an unreadable pill. It was darkened to `#2563eb` (white-on-blue ≈ 5.2:1). The other accents already clear it: red `#dc2626`, green `#2e8743`, purple `#7c3aed`, navy `#1c497c`.

**Recommendation:** When adding or changing any value in `CATEGORY_ACCENT` (or passing a custom `accent` to `EventHeroShell`), check white-on-accent contrast before shipping — the pill, not the card background, is the binding constraint. `CATEGORY_ACCENT` / `CATEGORY_GLOW` are exported and are the single source of truth; the standalone preseason heroes (`TagExtensionHero`, `TaggedPlayerShowcaseHero`) reference `CATEGORY_ACCENT.preseason` rather than hardcoding the hex, so they stay in sync automatically.

**Parallel CSS tokens — keep in lockstep.** The same category palette is *also* declared as `--cat-*` CSS custom properties (`CalendarEventCard.astro`, `WhatsNextCard.astro`) and as `var(--cat-*, <fallback>)` fallbacks in `hero-resolver.ts`. They must hold the **same hex** as `CATEGORY_ACCENT` or "preseason blue" drifts into two values. When you change a category accent, grep `--cat-<category>` and the resolver fallbacks and update all of them together. As of 2026-06-25 the calendar cards are "mini heroes" (see below), so they now render the same **white-on-accent pill** as the hero — the AA contrast constraint above now applies to the cards too, not just `EventHeroShell`.

## 2026-06-25 - "Mini Hero" Card Pattern (Calendar / What's Next)

**Context:** Calendar event cards (`CalendarEventCard.astro` for the full calendar, `WhatsNextCard.astro` for the homepage) were restyled to read as small versions of `EventHeroShell`: deep-navy `#0f1e2e` card, per-category accent on the icon chip, pill, glow wash, border, and a big tabular countdown number. No player images.

**Insight / reusable recipe** for making any card adopt the hero look:
- Set a per-category accent var on the root (`--card-accent`, defaulted then overridden by `.card--<category>`), plus a matching `--card-glow`. Glow is a low-alpha rgba of the accent; the chip tint uses `color-mix(in srgb, var(--card-accent) 22%, transparent)` exactly like the hero (`EventHeroShell.astro:231`).
- Layer order matters: an absolutely-positioned `__glow` element at `z-index:0` under a `z-index:1` `__body`, with `isolation: isolate` on the card so the glow's radial gradient doesn't bleed past the rounded corners.
- Title uses `--font-display` condensed uppercase; countdown number uses `--font-numeric` + `tabular-nums` in the accent color; links become on-navy chips (`rgba(255,255,255,.08)` bg, white-on-hover) mirroring `.tl-hero-panel__link`.
- State handling: `--past` drains `--card-accent` to gray + dims opacity; `--active` swaps the pill to `--color-success` and shows a pulsing dot (gated by `prefers-reduced-motion`); `--urgent` goes `--color-warning`.

**Gotcha:** the multicolor NFL sprite (`MULTICOLOR_ICONS = ['nfl']`) must NOT be tinted — give it a `--chip--multicolor` modifier that sets the chip bg to neutral `rgba(255,255,255,.1)` and the icon `fill: none`, otherwise the accent recolors the league logo.

**Evidence:** `src/components/theleague/CalendarEventCard.astro`, `src/components/theleague/WhatsNextCard.astro`, mirrors `src/components/theleague/EventHeroShell.astro`.

## 2026-06-24 - Per-League Theming via `html[data-league]` + Single-Value-Per-League Tokens

**Context:** AFL and TheLeague share `TheLeagueLayout.astro`, `Header.astro`, `Footer.astro`, and `tokens.css`. Before this change there was **no per-league theming hook in the Astro app** — both leagues resolved the identical `tokens.css`, so `--color-primary` was `#1c497c` blue for *both*. AFL's "red" identity only existed in the MFL skin (`_variables-afl.scss`), not the Astro site. Result: AFL homepage components rendered blue even though the design intent was red.

**The dead-fallback trap.** Nine AFL components carried `--afl-accent: var(--color-primary, #c41e3a)` — the author's intent (the `#c41e3a` red fallback) **never rendered**, because a `var()` fallback only applies when the referenced var is *undefined*, and `--color-primary` is always defined. So the components silently rendered blue. Same shape bit `var(--afl-red, #c41e3a)` in `AflEventHero` — except there `--afl-red` was genuinely undefined, so the red fallback *did* render. Lesson: `var(--x, <fallback>)` is not "prefer fallback for this league" — it's "fallback only if `--x` is missing." To get a per-league value you must actually *set* a different value per league.

**The pattern that works:**
1. Add `data-league={league}` to `<html>` in `TheLeagueLayout.astro` (the `league` var already exists there: `'afl'` | `'theleague'`). This is the scoping hook — it didn't exist before.
2. Define the token once in `:root` with the default (TheLeague) value: `--league-accent: var(--color-primary);`
3. Override in a scoped block: `html[data-league="afl"] { --league-accent: #c41e3a; }`. Specificity `(0,1,1)` beats `:root`'s `(0,1,0)`, so AFL wins. Custom-property declaration order inside the block is irrelevant — vars resolve at *use*, so `--breadcrumb-bar-bg: var(--afl-navy)` can reference `--afl-navy` declared on a later line.
4. Components consume the shared token (`var(--league-accent, …)`); they don't need to know the league.

**Tokens established (all in `tokens.css`):** `--league-accent` (TheLeague blue / AFL red `#c41e3a`), `--header-nav-icon-color` + `--header-nav-icon-hover-color` (TheLeague blue→green / AFL navy→red), `--breadcrumb-bar-bg` + `--inverse-bg` (AFL deep navy `#0f1e2e`, DRY'd into one `--afl-navy` since it appears 3×). Crucially `--color-primary` was left **untouched** for AFL — so links, headings, nav-active states, and table headers keep blue while only the deliberately-scoped accents change. Don't reach for overriding `--color-primary` per league unless you really want the blast radius; prefer a dedicated semantic token.

---

## 2026-06-27 - Two AFL golds: `--afl-gold` (orange) vs `--afl-trophy-gold` (badge metallic)

There are **two** AFL gold tokens and they are not interchangeable:
- `--afl-gold: #d97706` — an orange-amber (literally the same value as `--color-warning-dark`). Despite the comment calling it "trophy gold," it does **not** match the award-badge art.
- `--afl-trophy-gold: #c9a44c` (+ `--afl-trophy-gold-light: #e6c976`) — the actual metallic gold used in the trophy-badge SVGs. Use this for anything meant to read as the same gold as the trophies (progress-bar pips, tier-title accents, the championship hero).

Two gotchas when unifying gold:
1. `AflChampionshipHero.astro` **locally redefines** `--afl-gold` inside `.afl-champ-hero`, shadowing the global token — to retheme it, change the local override line, not the global token.
2. `#c9a44c` is a **low-contrast text color on white** (≈2:1). It's fine as fills/borders and as text on the navy badges, but for gold *text* on a light background (e.g. the hero kicker/"VS"), it's softer than the orange it replaced — neither passes WCAG AA for small text, so it's a judgment call, not a regression.

---

## 2026-06-25 - Font Token Architecture and Heading Font System

**Context:** Expanding UFC Sans Condensed from hero/display elements to all h1–h4 headings site-wide.

**Font tokens in `src/styles/tokens.css`:**
```css
--font-family-base: var(--font-vend-sans, 'Vend Sans'), system-ui, …;  /* body */
--font-display: 'UFC Sans Condensed', 'Arial Narrow', 'Oswald', system-ui, sans-serif;  /* headings/hero */
--font-numeric: 'UFC Sans', 'Vend Sans', system-ui, sans-serif;  /* numbers/stats */
--font-family-mono: Menlo, Monaco, …;  /* code */
```

**Vend Sans** is loaded via Astro's `Font` component (Google Fonts optimized) — configured in `astro.config.ts`. **UFC Sans** and **UFC Sans Condensed** are self-hosted `.woff2` files under `public/assets/fonts/`, registered with `@font-face` in `tokens.css`.

**Heading font-family lives in `TheLeagueLayout.astro`**, not `tokens.css` — the global `:global(h1)–:global(h4)` rules are the right place to apply `--font-display` to bare heading elements.

**`TheLeagueLayout.astro` is the real layout for both leagues.** AFL pages import `TheLeagueLayout`, not the base `Layout.astro`. If you're making a site-wide style change for AFL or TheLeague, edit `TheLeagueLayout.astro`. `Layout.astro` has a parallel copy of heading rules for edge-case pages (login, 404) — keep both in sync.

**Heading scale (as of 2026-06-25):**
| Level | Size |
|-------|------|
| h1 | 2.25rem |
| h2 | 1.75rem |
| h3 | 1.5rem |
| h4 | 1.125rem |

These are fixed rem values (not fluid clamps) because UFC Sans Condensed is a display face — its optical weight doesn't need fluid scaling the way body text does.

**Section title labels** (editorial uppercase headers with left border, e.g. `.afl-conf__title`) are separate from bare h3/h4 elements and have their own class-level `font-size` overrides. These are not affected by the global h3/h4 rule because class specificity wins. As of 2026-06-25: `0.9rem` (bumped from `0.75rem` to compensate for UFC Sans Condensed appearing slightly smaller at the same rem value as Vend Sans).

**Verification gotcha.** `@import`ed `tokens.css` inside an Astro `<style>` block does **not** reliably HMR — after editing tokens or a component's scoped style, *restart* the dev server for a clean compile, don't trust the live page. Also, `preview_inspect`/`getComputedStyle` reflects `:hover` if the synthetic cursor is parked over the element — a "resting" color reading that comes back as the hover value usually means the pointer is over it; read all sibling elements at once and the non-hovered ones show the true resting color.

---

## 2026-06-25 - Per-League Favicons and `<head>` Metadata in TheLeagueLayout

**Context:** Both AFL and TheLeague pages share `TheLeagueLayout.astro`, which previously served one `favicon.ico` and one `manifest.json` for both. The AFL design system ships a distinct favicon set (AFL football mark, navy `#002244` theme color, its own `site.webmanifest`).

**Pattern:** Gate the entire favicon/PWA `<head>` block on the `league` variable that's already derived from `leagueContext.slug` earlier in the layout frontmatter:

```astro
{league === 'afl' ? (
  <>
    <link rel="icon" type="image/svg+xml" href="/assets/afl/favicons/favicon.svg" />
    <link rel="icon" type="image/svg+xml" href="/assets/afl/favicons/favicon-dark.svg" media="(prefers-color-scheme: dark)" />
    <link rel="icon" type="image/x-icon" href="/assets/afl/favicons/favicon.ico" />
    <link rel="apple-touch-icon" href="/assets/afl/favicons/apple-touch-icon.png" />
    <link rel="manifest" href="/assets/afl/favicons/site.webmanifest" crossorigin="use-credentials" />
    <meta name="theme-color" content="#002244" />
    <meta name="apple-mobile-web-app-title" content="AFL" />
  </>
) : (
  <>
    {/* TheLeague defaults */}
  </>
)}
```

**AFL favicon asset location:** `public/assets/afl/favicons/` — includes `favicon.svg`, `favicon-dark.svg`, `favicon.ico`, `favicon-{16,32,48,192,512}.png`, `apple-touch-icon.png`, and `site.webmanifest`.

**Webmanifest gotcha:** The `site.webmanifest` from the AFL design system ships with *relative* icon paths (`"src": "favicon-192.png"`). When served from `/assets/afl/favicons/site.webmanifest`, relative paths resolve to `/assets/afl/favicons/favicon-192.png` correctly in most browsers — but to be safe and explicit, update the manifest to use **absolute** paths (`"/assets/afl/favicons/favicon-192.png"`) so it resolves correctly regardless of where the file is served from.

**Verification:** Inspect `Array.from(document.querySelectorAll('link[rel*="icon"], link[rel="manifest"], meta[name="theme-color"]')).map(el => el.outerHTML)` on an `/afl-fantasy/` page to confirm the AFL block renders and the TheLeague defaults are absent.

---

## 2026-06-25 - SVG Sprite Icons Need `fill: currentColor` on the Wrapper

**Context:** AFL homepage Explore section — all icons appeared black except Playoffs, which was red.

**Root cause:** SVG `<use>` elements that reference sprite symbols inherit their fill from the symbol's own path attributes, not from the wrapper SVG's CSS `color`. The browser's default SVG fill is `black`. Setting `color: var(--afl-accent)` on the wrapper alone is insufficient — it only works if the path element inside the symbol has `fill="currentColor"` baked in.

In `public/assets/icons/sprite.svg`, `icon-playoff` had `fill="currentColor"` on its `<path>` elements; all other AFL icons did not.

**Fix:** Add `fill: currentColor` to the CSS rule targeting the wrapper SVG element:
```css
.afl-links__icon {
  color: var(--afl-accent);
  fill: currentColor;   /* required — CSS color alone doesn't cascade into SVG fill */
}
```

This overrides the SVG default for any path that doesn't have an explicit fill attribute, while leaving icons with hardcoded fills (e.g. multi-color logos like `icon-nfl`) unaffected (their paths have explicit fill values that win over the CSS rule).

**When to apply:** Any component that uses `<svg class="…"><use href="…" /></svg>` sprite icons and wants them to pick up an accent color via CSS. Always pair `color` with `fill: currentColor` on the icon wrapper.

---

## Loading State Standard (Phase 0 — June 2026)

A site-wide loading standard exists, adapted from the Alaska + Hawaiian guest-app loading framework. Core rule: **choose the loading indicator by elapsed wait time, not by screen** — a duration ladder (nothing < 0.3s → optimistic → skeleton/button-spinner in the 1–10s band → branded 10s+ moment for AI endpoints). It reuses the **structure-vs-skin** model directly: behavior/ARIA identical across both leagues, accent skinned only via `var(--league-accent)`.

The repo had **no shared loading infrastructure** before this — 5 distinct spinners, 1 real skeleton, ~18 ad-hoc text mutations, inconsistent reduced-motion coverage (`PendingTradesPanel` guards its pulse; the playoffs shimmer doesn't). New loaders follow the `PlayerCell` dual Astro + JS pattern and a mandatory `@media (prefers-reduced-motion: reduce)` guard.

**Status:** Phase 1 — primitives, the prototype (`/theleague/loading-prototype`), and the branded roster loader are built; migration of existing pages not yet started. Docs: [loading-standards.md](../../loading-standards.md), [loading-inventory.md](../../loading-inventory.md), [loading-roadmap.md](../../loading-roadmap.md), [loading-prd.md](../../loading-prd.md).

---

## 2026-06-29 - UFC Sans Condensed Only Ships 400 and 700 — Never Ask for 800

**Context:** The branded division-standings banner spec called for `font-weight: 800` at 26px. Rendered with the body font it looked dramatically bigger/wider than the design; even after switching to the display font, 800 still looked bloated.

**Insight:** The `@font-face` declarations in `src/styles/tokens.css` register UFC Sans Condensed at exactly two weights: 400 (CondensedMedium) and 700 (CondensedBold). Requesting any heavier weight (800/900) makes the browser synthesize faux-bold — it smears the glyphs wider, defeating the condensed face's whole purpose and reading as "too big" even when `font-size` matches the design px-for-px. The same applies to UFC Sans (400/500 only).

**Recommendation:** For display/headline text use `font-family: var(--font-display, 'UFC Sans Condensed', 'Arial Narrow', sans-serif)` with `font-weight: 700` — never 800+. If a design mock looks "smaller" than the implementation at the same px size, check the font family and synthesized weight before touching `font-size`.

---

## 2026-07-04 - AFL Red via `var(--color-primary, #c41e3a)` Is a Bug — the Fallback Never Fires

**Context:** 19 declarations across 7 AFL pages (about, keepers, calendar, rules, rules-chat, franchises index + [id]) used `var(--color-primary, #c41e3a)` or `var(--primary-color, #c41e3a)` intending "AFL red." Confirmed via computed styles: every one rendered TheLeague blue `#1c497c`, because `--color-primary` (and its `--primary-color` alias, tokens.css ~line 472) is always defined — a var() fallback only applies when the variable is *undefined*, not when its value isn't what you hoped. Under the dark-mode rescope, `--color-primary` becomes gold, so the same declarations would have silently turned gold in dark mode.

**Insight:** A red hex in the fallback slot of a blue-resolving token is a latent copy-paste trap — it looks league-aware in the source and even shows red in devtools' fallback preview, but never on screen. `--color-primary` is intentionally never overridden for AFL (see "Per-League Theming" insight above); the only correct way to say "AFL red / TheLeague blue" is `var(--league-accent, #c41e3a)`, which resolves red on AFL in both light and dark (`html[data-league="afl"]` sets it, and tokens-dark.css leaves it alone).

**Recommendation:** All 19 were swapped to `var(--league-accent, #c41e3a)` (2026-07-04). When writing or reviewing AFL styles, grep for the smell: `grep -rnE 'var\(--(color-primary|primary-color), ?#c41e3a\)' src/`. A fallback hex that differs in *hue* from the token's real value is almost always intent leaking into the wrong slot.

---

## 2026-07-04 - Dark Surface + Text Pairs Must Both Come From the Inverting Gray Scale

**Context:** The Asset Library banner (`.gallery-header` in `src/pages/theleague/assets.astro`) rendered white text on near-white gray — invisible. The CSS was `background: var(--gallery-content-bg, #1f2937); color: #fff`.

**Root cause (two-part):**
1. **A `var()` fallback is not design intent.** The dark `#1f2937` fallback never applies when the token is defined anywhere up the cascade — and the page's own `<style>` set `--gallery-content-bg: #eeeeee` for its card wells. If an element needs a specific color, point it at the token that IS that color (`--color-gray-800`); don't rely on a fallback that a token definition silently overrides.
2. **Picking the replacement text color:** in `tokens-dark.css` the gray scale inverts as a unit (`--color-gray-800` flips to light `#d8d8d8`, `--color-gray-50` flips to dark `#181818`) but `--color-white` stays `#ffffff` in both modes. So `gray-800` background + `--color-white` text would recreate the invisible-text bug in dark mode.

**Root cause (part 3 — found in review):** setting `color` on the container is NOT enough. `TheLeagueLayout.astro` has a global element-level rule (`h1, h2, h3, h4 { color: var(--primary-link-default-text-color) }`), and a direct declaration on the element always beats an inherited value — regardless of specificity. The banner's `<h1>` stayed dark (`#111827` on `#1f2937`, 1.21:1) even with `color: var(--color-gray-50)` on `.gallery-header`. The bug slipped past the first verification pass because only the container's computed color and a screenshot were checked. **Verify heading fixes by reading the heading element's computed color, not the container's and not a screenshot.**

**Recommendation:** For any surface/text pair that must keep contrast across light and dark modes, take BOTH sides from the gray scale so they invert together — e.g. `background: var(--color-gray-800, #1f2937); color: var(--color-gray-50, #f9fafb)`. Never pair a gray-scale background with `--color-white` / `--color-black` text. And when the surface contains headings or links, add an explicit rule for those elements (`.my-banner h1 { color: var(--color-gray-50, #f9fafb); }`) — the layout's global `h1`–`h4` and `a` color rules override anything the container tries to pass down by inheritance.

---

## 2026-07-04 - `:global()` Is Inert Outside Astro Scoped Styles — Dead CSS in React `<style>` Literals and `is:global` Blocks

**Context:** TradeBaitMarketplace.tsx (a React island) carried 8 dark-mode rules written as `:global(html.dark) .marketplace__header { ... }` inside its `<style>{marketplaceStyles}</style>` template literal. They shipped to the browser verbatim as literal, unmatchable CSS — the dark trade-builder page silently showed light-mode amber. The same pattern was dead in 4 other trade-builder TSX components and 5 `<style is:global>` pages (fixed in bulk on the dark-mode branch, commit `4445bf795d`: 31 dead rules total).

**Insight:** `:global()` is a directive for Astro's scoped-style compiler, not real CSS. It only means something inside a plain scoped `<style>` in a `.astro` file. In a React/JSX style tag, a `<style is:global>` block, or any CSS injected via `set:html`, nothing compiles it away — the browser sees `:global(html.dark)` as an invalid selector and drops the rule. The failure is silent: the page still renders, just without the override, so light-mode colors can "look OK by coincidence" in dark mode.

**Recommendation:** Match the selector style to the style context: Astro scoped `<style>` → `:global(html.dark) .foo`; everything else (React `<style>` literals, `is:global`, injected CSS) → plain `html.dark .foo`. To audit, curl the rendered page — the literal string `:global(` in the response body always means dead rules: `curl -s localhost:PORT/page | grep -c ':global('` should be 0.

---

## 2026-07-04 - Data-File `icon` Fields Store BARE Sprite Glyph Names — Validated Against sprite.svg by Tests

**Context:** The dark-mode What's New entry shipped `"icon": "icon-eye"` instead of `"eye"`. Every consumer renders `<use href={`${spriteUrl}#icon-${value}`}>`, so the double prefix resolved to the nonexistent `#icon-icon-eye` and the hero eyebrow chip silently rendered empty — no error, no broken-image indicator. A sweep then found two more long-standing dead references in `page-directory.json` (`draft`, `scroll` — glyphs that never existed in the sprite), meaning the 2026 Rookie Rankings and AFL Constitution directory cards had blank icons in production.

**Insight:** Every data file that references the shared sprite (`public/assets/icons/sprite.svg`) — `whats-new.json`, `page-directory.json`, `nav-config.json` — stores the bare glyph name; display code prepends `icon-`. A wrong value fails completely silently: `<use>` pointing at a missing fragment renders nothing. This class of bug is now blocked at PR time for all three files: `tests/helpers/sprite-icons.ts` exports `describeSpriteIconValidation(label, refs)`, which registers the standard three-test suite (sprite parse sanity, no `icon-` double-prefix, every value exists as a `<symbol>` glyph). Consumers: `whats-new-data.test.ts`, `page-directory-data.test.ts`, `nav-config-icons.test.ts` (the latter covers `icon`, `iconAFL`, and footer links).

**Recommendation:** When adding an icon reference to any data file, use the bare glyph name and pick from the sprite's actual inventory (`grep -o 'id="icon-[^"]*"' public/assets/icons/sprite.svg`). If a new data file starts referencing the sprite, call `describeSpriteIconValidation()` from `tests/helpers/sprite-icons.ts` in its data test — map each entry to `{ source, icon }` — rather than reimplementing the checks.

---
## 2026-07-04 - Dark-Mode Token Migration: The AFL Dead-Var Family

**Context:** Migrating older AFL Fantasy pages (`rules.astro`, `rules-chat.astro`,
`keepers.astro`, `franchises/index.astro`, `franchises/[id].astro`) plus
`theleague/design-system.astro` to be dark-mode-safe.

**Insight:** A cluster of AFL pages was written against a set of CSS custom
properties that were **never defined in `tokens.css`/`tokens-dark.css`**.
Because `var(--undefined-name, fallback)` still renders via its fallback, these
pages "worked" in light mode by accident — but the fallback is a fixed light
hex that never inverts, so every one of these was a dark-mode bug waiting to
surface. The dead-var → real-token mapping (consistent across all 5 files):

| Dead var (never defined) | Real token |
|---|---|
| `--text-muted` | `--content-text-muted` |
| `--text-default` (no fallback) | `--page-text` |
| `--border-color` | `--content-border` |
| `--primary-color` | `--color-primary` |
| `--bg-muted` / `--code-bg` | `--content-bg-muted` |
| `--surface` / `--surface-2` | `--card-bg` / `--content-bg-muted` |
| `--color-bg-subtle` / `--color-border-subtle` | `--content-bg-muted` / `--content-border` |
| `--color-text-strong` / `--color-text-muted` | `--color-gray-900` / `--content-text-muted` |

`--text-default` is the sneaky one: with no fallback value, an undefined
`var()` makes the whole declaration invalid, which for the inherited `color`
property computes to the inherited value — so it often *happened* to render
correctly (inheriting `--page-text` from `body`) while still being wrong to
leave in place (no dark-mode guarantee, easy to break if the DOM structure
changes). Grep for `var(--text-default)`, `var(--text-muted`, `var(--border-color`,
`var(--primary-color`, `var(--bg-muted`, `var(--surface` across any
not-yet-migrated AFL page — this exact list keeps recurring file to file.

**Second bug pattern found:** `var(--afl-navy, #0f1e2e)` used as a **text**
color (`franchises/[id].astro` — trophy-wall label + title-pips ratio).
`--afl-navy` (#0f1e2e) is deep navy — correct for text on a light card, but
it's *also* the dark-mode page background (`html.dark[data-league="afl"]`
sets `--page-bg: var(--afl-navy)`), so navy-on-navy text goes invisible.
Any raw `--afl-navy`/`--afl-gold`-style brand constant used as *text* (not a
background/border/accent) should be double-checked against dark mode — these
brand hexes are fixed, not part of the inverted token ramp.

**Third pattern:** hardcoded per-button hex trios like
`background:#fff; color:#c41e3a; border:1px solid #c41e3a;` with a hover that
hardcodes a hand-picked darker shade (`#a01830`, `#a31a31`) — convert the base
three to `--card-bg` / `--color-primary`, and the hover darken to
`color-mix(in srgb, var(--color-primary) 80%, black)` rather than inventing a
new fixed hex — it tracks the token if the brand color ever changes and
self-adjusts in dark mode without a separate override.

**Known pre-existing gotcha (not fixed, flagged separately):** many AFL pages
write `var(--color-primary, #c41e3a)` intending "AFL red, red fallback" — but
`--color-primary` is *deliberately* never overridden for AFL (see the comment
block in `tokens.css` ~line 620: TheLeague blue is kept for links/headings/nav
on purpose). AFL's actual accent lives in `--league-accent` (red in both
light and dark AFL modes). This means those `var(--color-primary, #c41e3a)`
call sites resolve to blue at runtime, not red — the red only shows if you
read the fallback in devtools. This is a widespread, pre-existing pattern
across many AFL files (not introduced by dark-mode migration work) and needs
its own investigation/fix pass rather than a drive-by change during a
token-migration task.

**Preview switcher pattern (design-system.astro):** to add a page-local
light/dark toggle that never persists, call `window.__applyTheme('light'|'dark')`
(defined by `ThemeScript.astro`) directly — it only toggles the `dark` class +
theme-color meta + fires `theme-change`. Do **not** call
`setClientThemePreference()` (that's what writes the `theme_pref` cookie).
Restore the visitor's real theme on `astro:before-swap` (soft nav) and
`pagehide` (hard nav / tab close) by calling `window.__applyTheme()` with no
argument, which re-resolves from the cookie.
