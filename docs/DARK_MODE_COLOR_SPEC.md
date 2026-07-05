# Dark Mode Color Specification

> **This document describes what SHIPPED.** `src/styles/tokens-dark.css` is authoritative — if this doc and the CSS ever disagree, trust the CSS and update this file.
>
> An earlier draft of this spec proposed a charcoal-and-gold palette. That direction was abandoned during implementation in favor of a **neutral dark-gray surface system with the brand blue/emerald palette brightened for contrast**, plus a separate **navy-based ramp for AFL Fantasy**. Everything below reflects the shipped tokens.

---

## 1. Brand Colors

Dark mode brightens the brand colors for vibrancy against dark surfaces — it does not introduce a new accent hue.

| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Primary** | `#1c497c` | `#3b82f6` (bright blue) |
| **Primary Dark** | `#164066` | `#2563eb` |
| **Primary Light** | `#2563eb` | `#60a5fa` |
| **Secondary** | `#2e8743` | `#10b981` (emerald, matches logo green) |
| **Secondary Dark** | `#26743a` | `#2e8743` |
| **Secondary Light** | `#3c9950` | `#4ade80` |
| **Accent** | `#2e8743` | `#4ade80` |

---

## 2. Neutral / Gray Scale

The scale inverts: light grays become dark surfaces, dark grays become readable text.

| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Gray 50** (lightest → darkest surface) | `#f9fafb` | `#181818` |
| **Gray 100** | `#f3f4f6` | `#1e1e1e` |
| **Gray 200** | `#dddedf` | `#2a2a2a` |
| **Gray 300** | `#d1d5db` | `#3a3a3a` |
| **Gray 400** | `#9ca3af` | `#6b6b6b` |
| **Gray 500** | `#6b7280` | `#8a8a8a` |
| **Gray 600** | `#4b5563` | `#a0a0a0` |
| **Gray 700** | `#374151` | `#c0c0c0` |
| **Gray 800** | `#1f2937` | `#d8d8d8` |
| **Gray 900** (darkest → brightest text) | `#111827` | `#ededed` |

---

## 3. Page & Content Surfaces

Three elevation levels: page (lowest), content/card (mid), elevated (dropdowns/tooltips).

| Token | Used For | Light Mode | Dark Mode |
|-------|----------|-----------|-----------|
| **Page Background** | Full page behind everything | `#e0e0e0` | `#121212` |
| **Content Background** | Main content panels, cards | `#ffffff` | `#1e1e1e` |
| **Content Background Muted** | Subtle/recessed areas | `#eeeeee` | `#181818` |
| **Content Background Accent** | Highlighted sections | `#66abea` | `#2a2a2a` |
| **Content Border** | Panel borders | `#e2e8f0` | `#555555` |

### Surface Elevation System (new tokens)

| Token | Purpose | Dark Mode Value |
|-------|---------|-----------------|
| `--color-surface-1` | Lowest — page background | `#121212` |
| `--color-surface-2` | Mid — cards, panels | `#1e1e1e` |
| `--color-surface-3` | Highest — dropdowns, tooltips | `#2a2a2a` |
| `--color-border-default` | Standard borders | `#3a3a3a` |
| `--color-border-subtle` | Faint dividers | `#2e2e2e` |
| `--color-text-primary` | Body copy | `#e0e0e0` |
| `--color-text-secondary` | Labels, captions | `#8a8a8a` |
| `--color-text-disabled` | Disabled text | `#5a5a5a` |

---

## 4. Text Colors

| Token | Used For | Light Mode | Dark Mode |
|-------|----------|-----------|-----------|
| **Page Text** (primary) | Main body text | `#111827` | `#ededed` |
| **Text Muted** | Secondary/helper text | `#6b7280` | `#8a8a8a` |

---

## 5. Links

| Token | Used For | Light Mode | Dark Mode |
|-------|----------|-----------|-----------|
| **Link Default** | Standard link text | `#111827` | `#60a5fa` |
| **Link Hover** | Link on hover | `#2e8743` | `#2563eb` |
| **Link Focus** | Link on focus | `#2e8743` | `#2563eb` |
| **Link Inverse** | Links on dark backgrounds | `#e2e8f0` | `#e2e2e2` |
| **Link Inverse Hover** | Inverse link hover | `#2e8743` | `#3b82f6` |
| **Link Accent** | Accent-styled links | `#2563eb` | `#60a5fa` |
| **Link Accent Hover** | Accent link hover | `#2e8743` | `#3b82f6` |

---

## 6. Buttons

### Primary Button
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Background** | `#1c497c` | `#2563eb` |
| **Background Hover** | `#164066` | `#1d4ed8` |
| **Background Focus** | `#164066` | `#1d4ed8` |
| **Text** | `#ffffff` | `#ffffff` |
| **Border** | `#1c497c` | `#1d4ed8` |
| **Border Hover** | `#2e8743` | `#3b82f6` |

### Secondary Button
Uses the logo-green emerald with **near-black text** — white-on-`#10b981` is only ~3:1 contrast; `#121212`-on-`#10b981` is ~6.4:1 (same treatment as the dark primary button).

| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Background** | `#2e8743` | `#10b981` |
| **Background Hover** | `#26743a` | `#34d399` |
| **Background Focus** | `#22663a` | `#34d399` |
| **Text** | `#ffffff` | `#121212` |
| **Border** | `#2e8743` | `#10b981` |
| **Border Hover** | `#1c497c` | `#2563eb` |

### Inverse Button
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Background** | `#e2e8f0` | `#2a2a2a` |
| **Background Hover** | `#1c497c` | `#3a3a3a` |
| **Background Focus** | `#1c497c` | `#3a3a3a` |
| **Text** | `#1f2937` | `#d8d8d8` |
| **Text Hover** | `#ffffff` | `#ffffff` |

### Icon Button
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Text** | `#6b7280` | `#8a8a8a` |
| **Text Focus** | `#3b82f6` | `#60a5fa` |

---

## 7. Cards

| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Background** | `#ffffff` | `#1e1e1e` |
| **Border** | `#e2e8f0` | `#555555` |

**Raised-card recipe** (dark only, since flat borders read as invisible on dark surfaces):
```css
:global(html.dark) .card {
  box-shadow: 0 0 0 1px var(--content-border, #555), var(--shadow-lg);
}
```

**Tint recipe** (accent-tinted cards/rows):
```css
color-mix(in srgb, <hue> 7-12%, var(--card-bg))
```

---

## 8. Tables

| Token | Used For | Light Mode | Dark Mode |
|-------|----------|-----------|-----------|
| **Header Background** | Column headers | `#f9fafb` | `#181818` |
| **Header Text** | Column header text | `#9ca3af` | `#8a8a8a` |
| **Row Background** | Odd rows | `#ffffff` | `#1e1e1e` |
| **Row Background Alt** | Even rows (zebra striping) | `#ececec` | `#232323` |
| **Row Background Hover** | Row on hover | `#f9fafb` | `#2a2a2a` |
| **Table Border** | Cell/row borders | `#e2e8f0` | `#3a3a3a` |

---

## 9. Forms

| Token | Used For | Light Mode | Dark Mode |
|-------|----------|-----------|-----------|
| **Input Background** | Text input fill | `#ffffff` | `#181818` |
| **Input Border** | Input border default | `#d1d5db` | `#3a3a3a` |
| **Input Border Focus** | Input border on focus | `#1c497c` | `#3b82f6` |
| **Input Text** | Typed text | `#111827` | `#e0e0e0` |
| **Input Placeholder** | Placeholder text | `#9ca3af` | `#6b6b6b` |
| **Input Disabled Background** | Disabled input fill | `#f3f4f6` | `#151515` |

---

## 10. Inverse Sections (Dark Headers/Footers)

| Token | Used For | Light Mode | Dark Mode |
|-------|----------|-----------|-----------|
| **Background** | Dark section fill (footer) | `#1c497c` | `#101010` |
| **Background Accent** | Accent within dark section | `#2e8743` | `#2563eb` (bright blue strip) |
| **Border** | Border in dark section | `#164066` | `#1a1a1a` |
| **Text** | Text in dark section | `#ffffff` | `#e0e0e0` |

**Breadcrumb "Back to MFL" strip:** pinned to `var(--inverse-bg, #101010)` with a `var(--color-primary, #3b82f6)` accent edge in dark mode — without the pin it would fall back to `--color-primary` (a bright blue bar glaring against the `#121212` page).

---

## 11. Accent Content Blocks

| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Background** | `#66abea` | `#2a2a2a` |
| **Border** | `#d6e3f0` | `#3a3a3a` |
| **Text** | `#ffffff` | `#e0e0e0` |

---

## 12. Semantic Colors

Dark mode uses translucent/muted backgrounds with brighter foreground text for status indicators.

### Success
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Color** | `#10b981` | `#34d399` |
| **Light** (badge/alert bg) | `#d1fae5` | `rgba(16, 185, 129, 0.15)` |
| **Dark** (badge/alert text) | `#059669` | `#6ee7b7` |

### Warning
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Color** | `#f59e0b` | `#fbbf24` |
| **Light** (badge/alert bg) | `#fef3c7` | `rgba(245, 158, 11, 0.15)` |
| **Dark** (badge/alert text) | `#d97706` | `#fcd34d` |

### Error
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Color** | `#dc2626` | `#f87171` |
| **Light** (badge/alert bg) | `#fee2e2` | `rgba(220, 38, 38, 0.15)` |
| **Dark** (badge/alert text) | `#b91c1c` | `#fca5a5` |

### Info
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Color** | `#3b82f6` | `#60a5fa` |
| **Light** (badge/alert bg) | `#dbeafe` | `rgba(59, 130, 246, 0.15)` |
| **Dark** (badge/alert text) | `#2563eb` | `#93bbfd` |

### Franchise Tag
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Color** | `#7c3aed` | `#a78bfa` |
| **Light** (badge bg) | `#ede9fe` | `rgba(124, 58, 237, 0.2)` |

---

## 13. Legacy Alerts

| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Warning Text** | `#8a6d3b` | `#fcd34d` |
| **Warning Background** | `#fcf8e3` | `rgba(245, 158, 11, 0.12)` |
| **Warning Border** | `#faf2cc` | `rgba(245, 158, 11, 0.25)` |
| **Success Text** | `#3c763d` | `#6ee7b7` |
| **Success Background** | `#dff0d8` | `rgba(16, 185, 129, 0.12)` |
| **Success Border** | `#d0e9c6` | `rgba(16, 185, 129, 0.25)` |
| **Info Text** | `#31708f` | `#93bbfd` |
| **Info Background** | `#d9edf7` | `rgba(59, 130, 246, 0.12)` |
| **Info Border** | `#bcdff1` | `rgba(59, 130, 246, 0.25)` |

---

## 14. Shadows

Dark surfaces swallow low-alpha shadows — elevation needs **pure-black shadows at roughly 2.5x the light-mode opacity** to read as "raised."

| Token | Light Mode (hue/opacity) | Dark Mode (hue/opacity) |
|-------|--------------------------|--------------------------|
| **Shadow Color (HSL hue)** | `220deg 3% 15%` (blue-tinted) | `0deg 0% 0%` (pure black) |
| **Shadow SM** | `0.09` alpha | `0.5` alpha |
| **Shadow MD** (3 layers) | `0.08 / 0.06 / 0.04` | `0.45 / 0.35 / 0.28` |
| **Shadow LG** (4 layers) | `0.06 / 0.05 / 0.04 / 0.03` | `0.4 / 0.32 / 0.26 / 0.2` |
| **Shadow XL** (5 layers) | `0.05 / 0.04 / 0.035 / 0.03 / 0.025` | `0.35 / 0.3 / 0.24 / 0.18 / 0.12` |
| **Button Hover Shadow** | `rgba(37,99,235,0.35)` | `rgba(59,130,246,0.3)` |
| **Focus Ring Shadow** | `rgba(28,73,124,0.25)` | `rgba(59,130,246,0.4)` |

---

## 15. Selection Colors

Without an explicit rule, selected text keeps its muted dark-mode color against the browser's default highlight — near-unreadable slate-on-slate. Forced per-league:

| League | Selection Background | Selection Text |
|--------|----------------------|-----------------|
| TheLeague (`html.dark`) | `rgba(59, 130, 246, 0.55)` | `#ffffff` |
| AFL (`html.dark[data-league="afl"]`) | `rgba(239, 83, 80, 0.5)` | `#ffffff` |

---

## 16. Navigation Drawer

### Backgrounds
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Nav Background** | `#ffffff` | `#1e1e1e` |
| **Nav Background Subtle** | `#f9fafb` | `#181818` |
| **Footer Background** | `#f9fafb` | `#151515` |

### Text
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Nav Text** | `#333333` | `#d8d8d8` |
| **Nav Text Muted** | `#6b7280` | `#8a8a8a` |
| **Nav Text Subtle** | `#9ca3af` | `#6b6b6b` |
| **Section Header** | `#777777` | `#8a8a8a` |
| **Footer Text Muted** | `#6b7280` | `#6b6b6b` |

### Borders
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Nav Border** | `#d0d2d6` | `#3a3a3a` |
| **Nav Border Subtle** | `#f3f4f6` | `#2e2e2e` |
| **Footer Border** | `#e5e7eb` | `#2a2a2a` |

### Interactive States
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Hover Background** | `#f3f4f6` | `#2a2a2a` |
| **Active Background** | `rgba(28,73,124,0.1)` | `rgba(37,99,235,0.15)` |
| **Active Text** | `#1c497c` | `#3b82f6` |
| **Active Border Left** | `#1c497c` | `#3b82f6` |

### Subcomponents
| Token | Used For | Light Mode | Dark Mode |
|-------|----------|-----------|-----------|
| **Badge Background** | Notification count | `#ef4444` | `#ef4444` |
| **Badge Text** | Notification text | `#ffffff` | `#ffffff` |
| **Switcher Background** | League toggle bg | `#f3f4f6` | `#181818` |
| **Switcher Border** | League toggle border | `#e5e7eb` | `#3a3a3a` |
| **Switcher Active Bg** | Selected league | `#1c497c` | `#2563eb` |
| **Switcher Active Text** | Selected league text | `#ffffff` | `#ffffff` |
| **Switcher Inactive Text** | Unselected league | `#6b7280` | `#6b6b6b` |
| **Tooltip Background** | Hover tooltip | `#1f2937` | `#2a2a2a` |
| **Tooltip Text** | Tooltip text | `#ffffff` | `#e0e0e0` |
| **Verify Prompt Bg** | Team verify area | `rgba(28,73,124,0.05)` | `rgba(37,99,235,0.08)` |
| **Verify Prompt Border** | Team verify border | `#1c497c` | `#2563eb` |
| **Verify Prompt Text** | Team verify text | `#1c497c` | `#2563eb` |
| **Overlay** | Backdrop behind drawer | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.7)` |

### Scrollbar
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Track** | `transparent` | `transparent` |
| **Thumb** | `#d1d5db` | `#3a3a3a` |
| **Thumb Hover** | `#9ca3af` | `#5a5a5a` |

---

## 17. AFL Fantasy — Dark Navy Ramp

AFL's dark mode is **navy-based, not neutral-gray** (`html.dark[data-league="afl"]`). The whole surface elevation ramp derives from `--afl-navy` (`#0f1e2e`) as the page floor, stepping lighter for cards → elevated surfaces, with blue-tinted borders/grays so everything stays in the navy family. Red brand identity is preserved via a brightened accent (`#ef5350`, 5.4:1 contrast on the navy page). `--afl-trophy-gold` / `--afl-trophy-gold-light` are left untouched in dark mode — they match the award SVG art and don't need to invert.

### Surface Ramp
| Token | Value | Role |
|-------|-------|------|
| `--afl-navy` | `#0f1e2e` | Page floor (`--page-bg`, `--color-surface-1`) |
| Cards/panels | `#16283c` | One step up (`--content-bg`, `--card-bg`, `--nav-bg`, `--table-row-bg`) |
| Recessed | `#122132` | `--content-bg-muted`, `--table-header-bg`, `--input-bg`, `--nav-bg-subtle` |
| Alt row | `#182b40` | `--table-row-bg-alt` |
| Elevated (dropdowns/tooltips/hover) | `#1d3349` | `--color-surface-3`, `--table-row-bg-hover`, `--nav-hover-bg`, `--nav-tooltip-bg` |
| Inverse buttons | `#1d3349` → hover `#27405c` | `--btn-inverse-bg` / `--btn-inverse-bg-hover` |
| Footer (deepest) | `#0a1622` | `--inverse-bg`, `--breadcrumb-bar-bg` |
| Footer border / bg | `#16283c` / `#0d1a28` | `--inverse-border` / `--nav-footer-bg` |

### Borders (blue-tinted)
| Token | Value |
|-------|-------|
| Standard border | `#2e4560` (`--content-border`, `--card-border`, `--table-border`, `--input-border`, `--nav-border`) |
| Subtle border | `#24374d` (`--nav-footer-border`, `--color-border-subtle`) |

### Inverted Gray Scale (navy-tinted; 50–300 = surfaces/borders, 400+ = text)
| Token | Value |
|-------|-------|
| Gray 50 | `#122132` |
| Gray 100 | `#16283c` |
| Gray 200 | `#1d3349` |
| Gray 300 | `#2e4560` |
| Gray 400 | `#64788c` |
| Gray 500 | `#8fa0b3` |
| Gray 600 | `#9dadbe` |
| Gray 700 | `#b9c5d2` |
| Gray 800 | `#d3dce5` |
| Gray 900 | `#e8eef4` |

### Text
| Token | Value |
|-------|-------|
| Page text | `#e8eef4` |
| Text primary | `#dbe4ec` |
| Text secondary / muted | `#8fa0b3` |
| Placeholder | `#64788c` |

### Accent & Chrome
| Token | Value | Note |
|-------|-------|------|
| `--league-accent` | `#ef5350` | Brightened red for dark (vs. `#c41e3a` in light) |
| `--header-nav-icon-color` | `#ffffff` | Resting icons; navy would vanish on dark |
| `--header-nav-icon-hover-color` / `--header-nav-label-color` | `var(--league-accent)` | Red hover/labels |
| `--logo-name-primary-color` | `#ffffff` | "AFL" wordmark (TheLeague's `html.dark` green doesn't apply) |
| `--breadcrumb-bar-bg` | `#0a1622` | Deeper than the navy page so it still reads as its own band |
| `--breadcrumb-bar-border` | `var(--league-accent, #ef5350)` | Red accent edge |
| Selection background | `rgba(239, 83, 80, 0.5)` | Red-tinted, vs. blue for TheLeague |

**Cascade note:** `html.dark[data-league="afl"]` loads after the light-mode `html[data-league="afl"]` block and the neutral `html.dark` block, so it re-asserts navy values that would otherwise be overwritten by `html.dark`'s generic dark tokens (e.g. `--breadcrumb-bar-bg`).

---

## 18. Logo / Icon Dark-Mode Swap Conventions

Team and brand art that doesn't hold up when inverted (e.g. dark logo strokes on a now-dark page) ships a **dark-specific asset variant** rather than relying on CSS filters:

- Per-team config carries an `iconDark` field (alongside the light `icon`) in `src/data/theleague.config.json` / `data/afl-fantasy/afl.config.json`. When present, dark mode renders the `-dark` suffixed asset instead of filtering the light one.
- The `ThemeImage` component swaps `src` for the dark variant based on the resolved `dark` class rather than duplicating markup per theme.
- Generated `TeamIconDarkStyles` emits the `html.dark` CSS rules that point each team's icon selector at its `iconDark` asset, so pages don't hand-write a dark override per team.

---

## Color Palette Summary

The shipped dark mode theme is built from these core values:

| Role | Hex | Description |
|------|-----|-------------|
| **Deepest background (page)** | `#121212` | TheLeague page body |
| **Base surface (cards)** | `#1e1e1e` | Cards, panels, content areas |
| **Elevated surface** | `#2a2a2a` | Hovers, dropdowns, tooltips |
| **Subtle border** | `#2e2e2e` | Dividers, subtle separation |
| **Standard border** | `#555555` (content) / `#3a3a3a` (input/table/nav) | Card borders, input borders |
| **Muted text** | `#6b6b6b` | Placeholders, disabled hints |
| **Secondary text** | `#8a8a8a` | Labels, table headers, captions |
| **Primary text** | `#e0e0e0` | Body copy, readable content |
| **Bright text** | `#ededed` | Headings, emphasis |
| **Bright blue (brand)** | `#3b82f6` | Primary buttons, links, focus rings |
| **Emerald (secondary)** | `#10b981` | Secondary buttons, logo green |
| **AFL navy floor** | `#0f1e2e` | AFL page background (dark) |
| **AFL card surface** | `#16283c` | AFL cards/panels (dark) |
| **AFL elevated surface** | `#1d3349` | AFL dropdowns/hover (dark) |
| **AFL red accent** | `#ef5350` | AFL brand accent (dark, brightened for contrast) |
