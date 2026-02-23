# What's New Blog Redesign

## 2026-02-22 - SSR Required for Cookie-Based "New" Badges

**Context:** Implementing "new since last visit" indicators on the What's New listing page.

**Insight:** The listing page must use `prerender = false` (SSR) to read the `whats_new_last_visit` cookie server-side via `Astro.cookies`. Detail pages remain static (`prerender = true`) since they don't need cookie data. This avoids FOUC where badges would flash on hydration.

**Evidence:** `src/pages/theleague/whats-new/index.astro` line 20: `export const prerender = false`

**Recommendation:** Any page that needs cookie-based personalization before first paint must be SSR. Use `enrichEntries(sorted, lastVisitDate)` with `null` for first-visit baseline (marks all `isNew: false` to avoid badge noise).

---

## 2026-02-22 - Astro Route Coexistence: index.astro + [id].astro

**Context:** Adding individual detail pages alongside the existing listing page.

**Insight:** To have both `/theleague/whats-new` (listing) and `/theleague/whats-new/[id]` (detail), the listing must be moved from `whats-new.astro` to `whats-new/index.astro`. Both files coexist in the same directory.

**Evidence:** `src/pages/theleague/whats-new/index.astro` (SSR listing) + `src/pages/theleague/whats-new/[id].astro` (static detail)

**Recommendation:** When adding sub-routes to an existing page, always move the parent to a directory with `index.astro`.

---

## 2026-02-22 - Global a:hover Overrides Card text-decoration

**Context:** Cards are `<a>` tags wrapping title, summary, and "Read more" text. On hover, all text got underlined.

**Insight:** A global `a:hover { text-decoration: underline }` rule in the site's base styles overrides the card's `text-decoration: none`. The class selector `.wn-card:hover` has higher specificity than `a:hover`, but depending on stylesheet load order it may not win. Using `!important` on `a.wn-card:hover` guarantees the override.

**Evidence:** `src/pages/theleague/whats-new/index.astro` — `a.wn-card:hover { text-decoration: none !important }`

**Recommendation:** When using `<a>` tags as card containers, always add `text-decoration: none !important` on hover to combat global link styles. Only the "Read more" span changes color via `.wn-card:hover .wn-card__read-more`.

---

## 2026-02-22 - WCAG Contrast for Category Colors and Decorative Borders

**Context:** Initial category colors and sidebar borders failed WCAG 2.1 contrast checks.

**Insight:** Category pill badge colors need 4.5:1 contrast ratio against white text (AA normal text). Darkened values that pass: purple `#6d28d9` (7.10:1), green `#166534` (7.13:1), blue `#1d4ed8` (6.70:1). Timeline sidebar border is decorative but was changed from `#e2e8f0` to `#9ca3af` for visibility. Inactive sidebar labels changed from `#6b7280` to `#4b5563` (7.56:1).

**Evidence:** Category tokens in both `index.astro` and `[id].astro`: `--cat-new-page: #6d28d9`, `--cat-new-feature: #166534`, `--cat-enhancement: #1d4ed8`

**Recommendation:** Always verify category/badge colors against white text at 4.5:1 minimum. Use `color-mix()` for gradient backgrounds that reference category colors.

---

## 2026-02-22 - Nav Active State for Sub-Pages

**Context:** Detail pages at `/theleague/whats-new/[id]` didn't highlight the "What's New" nav link.

**Insight:** `isLinkActive()` in `nav-utils.ts` only did exact match. Added prefix matching: if `normalizedLink !== '/'` and `normalizedCurrent.startsWith(normalizedLink + '/')`, return true.

**Evidence:** `src/utils/nav-utils.ts` ~line 370

**Recommendation:** This pattern works for any page with sub-routes. The `/` guard prevents the homepage from matching everything.
