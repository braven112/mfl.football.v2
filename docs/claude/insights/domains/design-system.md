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
