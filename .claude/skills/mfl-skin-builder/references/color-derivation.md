# Color Derivation Rules

How to generate the full 60+ token palette from just two hex color inputs (primary + accent) and a light/dark mode choice.

---

## Inputs

| Input | Example | Purpose |
|-------|---------|---------|
| Primary color | `#1c497c` | Brand identity — menus, headers, headings, icons, links, footer |
| Accent color | `#3c9950` | Action color — buttons, secondary nav, calendar today, logo accent |
| Mode | `light` or `dark` | Controls background/text inversion |

---

## Color Math Operations

When the skill says "darken" or "lighten", use these hex math rules:

### Darken by N%
Multiply each RGB channel by `(100 - N) / 100`. Example: darken `#3c9950` by 10%:
- R: 0x3c (60) × 0.90 = 54 → `#36`
- G: 0x99 (153) × 0.90 = 138 → `#8a`
- B: 0x50 (80) × 0.90 = 72 → `#48`
- Result: `#368a48`

### Lighten by N%
Move each channel N% toward 255: `channel + (255 - channel) × (N / 100)`. Example: lighten `#1c497c` by 10%:
- R: 28 + (255-28) × 0.10 = 51 → `#33`
- G: 73 + (255-73) × 0.10 = 91 → `#5b`
- B: 124 + (255-124) × 0.10 = 137 → `#89`
- Result: `#335b89`

### Contrast Check
For text on a background, ensure at least 4.5:1 contrast ratio (WCAG AA). Quick rule of thumb:
- White text (`#fff`) works on backgrounds darker than ~`#767676`
- Dark text (`#333`) works on backgrounds lighter than ~`#767676`
- When in doubt, use `#fff` text on primary/accent backgrounds

---

## Light Mode Derivation

### From Primary Color

| Token(s) | Value |
|----------|-------|
| `--primary-color`, `--secondary-color` | primary |
| `--link-color` | primary |
| `--link-color-hover` | lighten(primary, 10%) |
| `--menu-bg-color`, `--menu-border-color` | primary |
| `--menu-bg-hover-color` | darken(primary, 5%) |
| `--footer-bg-color` | primary |
| `--caption-color`, `--headline-font-color` | primary |
| `--h1-color` through `--h6-color` | primary |
| `--icon-color`, `--icon-text-color` | primary |
| `--icon-color-hover` | lighten(primary, 10%) |
| `--header-icon-color`, `--header-icon-text-color` | primary |
| `--header-icon-hover-color` | lighten(primary, 10%) |
| `--logo-main-color`, `--logo-text-color` | primary |
| `--logo-name-secondary-color` | primary |
| `--division-heading-color`, `--division-subheading-color` | primary |
| `--table-header-color` | primary |

### From Accent Color

| Token(s) | Value |
|----------|-------|
| `--accent-color` | accent |
| `--dark-accent-color` | darken(accent, 10%) |
| `--button-bg-color` | accent |
| `--button-bg-color-hover` | lighten(accent, 5%) |
| `--secondary-menu-bg-color`, `--secondary-menu-border-color` | accent |
| `--today-bg-color` | accent |
| `--today-border-color` | lighten(accent, 2%) |
| `--logo-secondary-color`, `--logo-secondary-text-color` | accent |
| `--logo-name-primary-color` | accent |

### Fixed Light Values

| Token(s) | Value |
|----------|-------|
| `--primary-text-color`, `--secondary-text-color` | `#333333` |
| `--primary-bg-color`, `--report-bg`, `--header-bg` | `#fff` |
| `--pagebody-bg` | `#e0e0e0` |
| `--menu-text-color` | `#fff` |
| `--footer-text-color`, `--footer-header-text-color` | `#fff` |
| `--button-link-color` | `#fff` |
| `--secondary-menu-text-color/link-color/icon-color` | `#fff` |
| `--border-color`, `--lightgray` | `#ddd` |
| `--gray1` | `#333` |
| `--gray2` | `#666` |
| `--gray3` | `#999` |
| `--offwhite` | `#eee` |
| `--offwhite2` | `#e0e0e0` |
| `--lightgray2` | `#ccc` |
| `--lightgray3` | `#aaa` |
| `--white` | `#fff` |
| `--codebg-color` | `#31382d` |
| `--oddtablerow` | `#fff` |
| `--eventablerow` | `#ececec` |
| `--newposition-border-color` | `#ccc` |
| `--scrollbar-bg-color` | `#ddd` |
| `--scrollbar-bg-hover-color` | `#eaeaea` |
| `--calendar-bg-color` | `#eee` |
| `--calendar-eventablerow` | `#fff` |
| `--calendar-border-color` | `#f0f0f0` |
| `--calendar-text-color`, `--today-text-color` | `#fff` |
| `--logo-3rd-color` | `#ddd` |
| `--logo-4th-color` | `#fff` |
| `--add-color` | `green` |
| `--drop-color` | `red` |
| `--division-border-color` | `#ddd` |
| `--secondary-menu-font-weight` | `normal` |

### Fixed Light — Alerts

| Token | Value |
|-------|-------|
| `--alert-danger-text` | `#a94442` |
| `--alert-danger-bg` | `#f2dede` |
| `--alert-danger-border` | `#ebccd1` |
| `--alert-warning-text` | `#8a6d3b` |
| `--alert-warning-bg` | `#fcf8e3` |
| `--alert-warning-border` | `#faf2cc` |
| `--alert-success-text` | `#3c763d` |
| `--alert-success-bg` | `#dff0d8` |
| `--alert-success-border` | `#d0e9c6` |
| `--alert-info-text` | `#31708f` |
| `--alert-info-bg` | `#d9edf7` |
| `--alert-info-border` | `#bcdff1` |

### Fixed Light — Roster Page

| Token | Value |
|-------|-------|
| `--color-bg-base` | `#ffffff` |
| `--color-bg-subtle` | `#f7f8fb` |
| `--color-bg-practice` | `#f0f7ff` |
| `--color-bg-practice-alt` | `#e0efff` |
| `--color-bg-injured` | `#fff5f5` |
| `--color-bg-injured-alt` | `#ffe8e8` |
| `--color-border-practice` | `#bfdbfe` |
| `--color-border-injured` | `#fecaca` |

---

## Dark Mode Derivation

Dark mode keeps the accent color vivid but flips backgrounds to dark grays and text to light values. The user's primary color input is still used for the menu and footer, but darkened significantly.

### From Primary Color (darkened)

| Token(s) | Value |
|----------|-------|
| `--menu-bg-color`, `--menu-border-color` | darken(primary-input, 20%) |
| `--menu-bg-hover-color` | darken(primary-input, 25%) |
| `--footer-bg-color` | darken(primary-input, 20%) |

### From Accent Color (stays vivid)

Same as light mode — accent tokens don't change between modes.

### Fixed Dark — Backgrounds & Text

| Token | Value |
|-------|-------|
| `--primary-color`, `--secondary-color` | `#f7f7f7` |
| `--primary-text-color` | `#f7f7f7` |
| `--secondary-text-color` | `#d0d0d0` |
| `--link-color` | `#d0d0d0` |
| `--link-color-hover` | accent |
| `--primary-bg-color` | `#333` |
| `--pagebody-bg` | `#1d1e1f` |
| `--report-bg` | `#333` |
| `--header-bg` | `#333` |
| `--white` | `#48494A` |
| `--offwhite` | `#48494A` |
| `--offwhite2` | `#1d1e1f` |
| `--border-color`, `--lightgray` | `#48494A` |
| `--lightgray2` | `#555657` |
| `--lightgray3` | `#6a6b6c` |
| `--gray1` | `#d8d8d8` |
| `--gray2` | `#8a8a8a` |
| `--gray3` | `#6b6b6b` |
| `--codebg-color` | `#1d1e1f` |
| `--add-color` | `#4ade80` |
| `--drop-color` | `#f87171` |

### Fixed Dark — Tables

| Token | Value |
|-------|-------|
| `--oddtablerow` | `#48494A` |
| `--eventablerow` | `#555657` |
| `--newposition-border-color` | `#555657` |
| `--table-header-color` | `#9a9a9a` |

### Fixed Dark — Headlines & Icons

| Token | Value |
|-------|-------|
| `--caption-color` | `#d0d0d0` |
| `--headline-font-color`, `--h1-color` through `--h6-color` | `#f7f7f7` |
| `--icon-color`, `--icon-text-color` | `#d0d0d0` |
| `--icon-color-hover` | `#f7f7f7` |
| `--header-icon-color`, `--header-icon-text-color` | `#d0d0d0` |
| `--header-icon-hover-color` | `#f7f7f7` |
| `--logo-main-color`, `--logo-text-color` | `#f7f7f7` |
| `--logo-name-secondary-color` | `#f7f7f7` |
| `--division-heading-color` | `#f7f7f7` |
| `--division-subheading-color` | `#d0d0d0` |
| `--division-border-color` | `#555657` |
| `--logo-3rd-color` | `#555657` |
| `--logo-4th-color` | `#48494A` |

### Fixed Dark — Alerts

| Token | Value |
|-------|-------|
| `--alert-danger-text` | `#fca5a5` |
| `--alert-danger-bg` | `rgba(220, 38, 38, 0.15)` |
| `--alert-danger-border` | `rgba(220, 38, 38, 0.25)` |
| `--alert-warning-text` | `#fcd34d` |
| `--alert-warning-bg` | `rgb(57, 36, 1)` |
| `--alert-warning-border` | `rgb(216, 155, 49)` |
| `--alert-success-text` | `#6ee7b7` |
| `--alert-success-bg` | `rgba(16, 185, 129, 0.12)` |
| `--alert-success-border` | `rgba(16, 185, 129, 0.25)` |
| `--alert-info-text` | `#93bbfd` |
| `--alert-info-bg` | `rgba(59, 130, 246, 0.12)` |
| `--alert-info-border` | `rgba(59, 130, 246, 0.25)` |

### Fixed Dark — Scrollbar & Calendar

| Token | Value |
|-------|-------|
| `--scrollbar-bg-color` | `#555657` |
| `--scrollbar-bg-hover-color` | `#6a6b6c` |
| `--calendar-bg-color` | `#48494A` |
| `--calendar-eventablerow` | `#555657` |
| `--calendar-border-color` | `#555657` |

### Fixed Dark — Roster Page

| Token | Value |
|-------|-------|
| `--color-bg-base` | `#333` |
| `--color-bg-subtle` | `#3a3a3a` |
| `--color-bg-practice` | `rgba(59, 130, 246, 0.08)` |
| `--color-bg-practice-alt` | `rgba(59, 130, 246, 0.15)` |
| `--color-bg-injured` | `rgba(220, 38, 38, 0.08)` |
| `--color-bg-injured-alt` | `rgba(220, 38, 38, 0.15)` |
| `--color-border-practice` | `rgba(59, 130, 246, 0.3)` |
| `--color-border-injured` | `rgba(220, 38, 38, 0.3)` |

---

## Border Radius & Typography (Mode-Independent)

These tokens are the same regardless of light or dark mode:

| Token | Value |
|-------|-------|
| `--border-radius-sm` | `.25rem` |
| `--border-radius-default` | `.5rem` |
| `--border-radius-lg` | `1rem` |
| `--border-radius-xl` | `8rem` |
| `--headline-font` | User's headline font choice |
| `--headline-font-weight` | `700` |
| `--body-font` | User's body font choice |
| `--body-font-weight` | `300` (light) or `400` (dark) |
| `--svg-text-font-size` | `11.25px` |

---

## Var-Reference Tokens (Mode-Independent)

These tokens reference other tokens and never need direct hex values:

| Token | Value |
|-------|-------|
| `--hpm-header-bg` | `var(--alert-warning-bg)` |
| `--hpm-header-border` | `var(--alert-warning-border)` |
| `--hpm-header-color` | `var(--alert-warning-text)` |
| `--hpm-body-bg` | `var(--alert-warning-bg)` |
| `--hpm-body-border` | `var(--alert-warning-border)` |
| `--hpm-body-color` | `var(--alert-warning-text)` |
| `--live-scoring-highlight` | `var(--accent-color)` |
| `--live-scoring-border` | `var(--dark-accent-color)` |
| `--container-header-bg` | `var(--header-bg)` |
| `--tab-text-color` | `var(--gray2)` |
| `--tab-active-text-color` | `var(--primary-color)` |
| `--tab-active-indicator-color` | `var(--accent-color)` |
| `--tab-separator-color` | `var(--border-color)` |
| `--tab-hover-color` | `var(--primary-color)` |
