# MFL Skin Token Map

Every CSS custom property in the MFL skin system, organized by category. Each token shows what it controls and which user input it derives from.

**Derivation key:**
- **P** = primary color input
- **A** = accent color input
- **F** = fixed value (same across all skins)
- **D** = derived (computed from primary or accent)
- **M** = mode-dependent (changes between light and dark)

---

## Colors (6 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--primary-color` | Main brand color used across headers, icons, links | User's primary hex | `#f7f7f7` (flipped for contrast) | P / M |
| `--secondary-color` | Secondary brand color (often same as primary) | Same as primary | `#f7f7f7` | P / M |
| `--accent-color` | Action color for buttons, highlights, CTAs | User's accent hex | User's accent hex (stays vivid) | A |
| `--dark-accent-color` | Darker accent for hover states, borders | darken(accent, 10%) | darken(accent, 10%) | D |
| `--primary-text-color` | Main body text | `#333333` | `#f7f7f7` | M |
| `--secondary-text-color` | Secondary/muted text | `#333333` | `#d0d0d0` | M |

## Links (4 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--link-color` | Hyperlink default color | primary | `#d0d0d0` | P / M |
| `--link-color-hover` | Hyperlink hover color | lighten(primary, 10%) | accent | D / M |
| `--add-color` | "Add player" transaction color | `green` | `#4ade80` | M |
| `--drop-color` | "Drop player" transaction color | `red` | `#f87171` | M |

## Alerts (12 tokens)

Semantic colors — keep standard values. Don't brand these.

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--alert-danger-text` | Error text | `#a94442` | `#fca5a5` | F / M |
| `--alert-danger-bg` | Error background | `#f2dede` | `rgba(220, 38, 38, 0.15)` | F / M |
| `--alert-danger-border` | Error border | `#ebccd1` | `rgba(220, 38, 38, 0.25)` | F / M |
| `--alert-warning-text` | Warning text | `#8a6d3b` | `#fcd34d` | F / M |
| `--alert-warning-bg` | Warning background | `#fcf8e3` | `rgb(57, 36, 1)` | F / M |
| `--alert-warning-border` | Warning border | `#faf2cc` | `rgb(216, 155, 49)` | F / M |
| `--alert-success-text` | Success text | `#3c763d` | `#6ee7b7` | F / M |
| `--alert-success-bg` | Success background | `#dff0d8` | `rgba(16, 185, 129, 0.12)` | F / M |
| `--alert-success-border` | Success border | `#d0e9c6` | `rgba(16, 185, 129, 0.25)` | F / M |
| `--alert-info-text` | Info text | `#31708f` | `#93bbfd` | F / M |
| `--alert-info-bg` | Info background | `#d9edf7` | `rgba(59, 130, 246, 0.12)` | F / M |
| `--alert-info-border` | Info border | `#bcdff1` | `rgba(59, 130, 246, 0.25)` | F / M |

## Neutrals (10 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--gray1` | Darkest gray (text) | `#333` | `#d8d8d8` | M |
| `--gray2` | Medium gray (secondary text) | `#666` | `#8a8a8a` | M |
| `--gray3` | Light gray (tertiary text) | `#999` | `#6b6b6b` | M |
| `--offwhite` | Off-white backgrounds | `#eee` | `#48494A` | M |
| `--offwhite2` | Alternate off-white | `#e0e0e0` | `#1d1e1f` | M |
| `--lightgray` | Light gray borders/dividers | `#ddd` | `#48494A` | M |
| `--lightgray2` | Alternate light gray | `#ccc` | `#555657` | M |
| `--lightgray3` | Darker light gray | `#aaa` | `#6a6b6c` | M |
| `--white` | "White" token (flips in dark mode) | `#fff` | `#48494A` | M |
| `--codebg-color` | Code block background | `#31382d` | `#1d1e1f` | M |

## Tables (3 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--oddtablerow` | Odd table row background | `#fff` | `#48494A` | M |
| `--eventablerow` | Even table row background | `#ececec` | `#555657` | M |
| `--newposition-border-color` | Position change border | `#ccc` | `#555657` | M |
| `--table-header-color` | Table header text | primary | `#9a9a9a` | P / M |

## Page Backgrounds (4 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--primary-bg-color` | Main content area background | `#fff` | `#333` | M |
| `--pagebody-bg` | Full page background behind content | `#e0e0e0` | `#1d1e1f` | M |
| `--report-bg` | Report/card background | `#fff` | `#333` | M |
| `--header-bg` | Page header background | `#fff` | `#333` | M |

## Footer (3 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--footer-bg-color` | Footer background | primary | darken(primary-input, 20%) | P / D |
| `--footer-text-color` | Footer body text | `#fff` | `#fff` | F |
| `--footer-header-text-color` | Footer heading text | `#fff` | `#fff` | F |

## Borders (1 token)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--border-color` | Default border color | `#ddd` | `#48494A` | M |

## MFL Menu (4 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--menu-bg-color` | Main navigation background | primary | darken(primary-input, 20%) | P / D |
| `--menu-bg-hover-color` | Nav item hover background | darken(primary, 5%) | darken(primary-input, 25%) | D |
| `--menu-border-color` | Nav border | primary | darken(primary-input, 20%) | P / D |
| `--menu-text-color` | Nav link text | `#fff` | `#fff` | F |

## Report Navigation / Secondary Menu (7 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--secondary-menu-border-color` | Sub-nav border | accent | accent | A |
| `--secondary-menu-bg-color` | Sub-nav background | accent | accent | A |
| `--secondary-menu-text-color` | Sub-nav text | `#fff` | `#fff` | F |
| `--secondary-menu-link-color` | Sub-nav links | `#fff` | `#fff` | F |
| `--secondary-menu-icon-color` | Sub-nav icons | `#fff` | `#fff` | F |
| `--secondary-menu-icon-hover-color` | Sub-nav icon hover | `#fff` | `#fff` | F |
| `--secondary-menu-font-weight` | Sub-nav font weight | `normal` | `normal` | F |

## Buttons (3 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--button-bg-color` | Primary button background | accent | accent | A |
| `--button-bg-color-hover` | Button hover background | lighten(accent, 5%) | lighten(accent, 5%) | D |
| `--button-link-color` | Button text color | `#fff` | `#fff` | F |

## Scrollbar (2 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--scrollbar-bg-color` | Scrollbar track | `#ddd` | `#555657` | M |
| `--scrollbar-bg-hover-color` | Scrollbar hover | `#eaeaea` | `#6a6b6c` | M |

## Captions & Headlines (8 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--caption-color` | Table/figure captions | primary | `#d0d0d0` | P / M |
| `--headline-font-color` | Generic headline color | primary | `#f7f7f7` | P / M |
| `--h1-color` | H1 headings | primary | `#f7f7f7` | P / M |
| `--h2-color` | H2 headings | primary | `#f7f7f7` | P / M |
| `--h3-color` | H3 headings | primary | `#f7f7f7` | P / M |
| `--h4-color` | H4 headings | primary | `#f7f7f7` | P / M |
| `--h5-color` | H5 headings | primary | `#f7f7f7` | P / M |
| `--h6-color` | H6 headings | primary | `#f7f7f7` | P / M |

## Icons (3 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--icon-color` | Default icon fill | primary | `#d0d0d0` | P / M |
| `--icon-color-hover` | Icon hover fill | lighten(primary, 10%) | `#f7f7f7` | D / M |
| `--icon-text-color` | Icon label text | primary | `#d0d0d0` | P / M |

## Calendar (5 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--calendar-bg-color` | Calendar grid background | `#eee` | `#48494A` | M |
| `--calendar-eventablerow` | Calendar event row | `#fff` | `#555657` | M |
| `--calendar-border-color` | Calendar cell borders | `#f0f0f0` | `#555657` | M |
| `--calendar-text-color` | Calendar header text | `#fff` | `#fff` | F |
| `--today-bg-color` | Today highlight | accent | accent | A |
| `--today-border-color` | Today highlight border | lighten(accent, 2%) | lighten(accent, 2%) | D |
| `--today-text-color` | Today text | `#fff` | `#fff` | F |

## Logo (6 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--logo-main-color` | Logo primary fill | primary | `#f7f7f7` | P / M |
| `--logo-secondary-color` | Logo accent fill | accent | accent | A |
| `--logo-3rd-color` | Logo tertiary | `#ddd` | `#555657` | M |
| `--logo-4th-color` | Logo quaternary | `#fff` | `#48494A` | M |
| `--logo-text-color` | Logo text primary | primary | `#f7f7f7` | P / M |
| `--logo-secondary-text-color` | Logo text accent | accent | accent | A |

## Typography (4 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--headline-font` | Heading font family | User's headline font | User's headline font | User input |
| `--headline-font-weight` | Heading weight | `700` | `700` | F |
| `--body-font` | Body text font family | User's body font | User's body font | User input |
| `--body-font-weight` | Body weight | `300`-`400` | `300`-`400` | F |
| `--svg-text-font-size` | SVG text sizing | `11.25px` | `11.25px` | F |

## Border Radius (4 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--border-radius-sm` | Small radius | `.25rem` | `.25rem` | F |
| `--border-radius-default` | Default radius | `.5rem` | `.5rem` | F |
| `--border-radius-lg` | Large radius | `1rem` | `1rem` | F |
| `--border-radius-xl` | Extra-large radius | `8rem` | `8rem` | F |

## Header Icons (3 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--header-icon-color` | Header action icons | primary | `#d0d0d0` | P / M |
| `--header-icon-text-color` | Header icon labels | primary | `#d0d0d0` | P / M |
| `--header-icon-hover-color` | Header icon hover | lighten(primary, 10%) | `#f7f7f7` | D / M |

## Logo Name (2 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--logo-name-primary-color` | Site name primary | accent | accent | A |
| `--logo-name-secondary-color` | Site name secondary | primary | `#f7f7f7` | P / M |

## Division Headings (3 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--division-heading-color` | Division title text | primary | `#f7f7f7` | P / M |
| `--division-subheading-color` | Division subtitle text | primary | `#d0d0d0` | P / M |
| `--division-border-color` | Division separator | `#ddd` | `#555657` | M |

## Roster Page (8 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--color-bg-base` | Roster base background | `#ffffff` | `#333` | M |
| `--color-bg-subtle` | Subtle background | `#f7f8fb` | `#3a3a3a` | M |
| `--color-bg-practice` | Practice squad bg | `#f0f7ff` | `rgba(59,130,246,0.08)` | M |
| `--color-bg-practice-alt` | Practice squad alt bg | `#e0efff` | `rgba(59,130,246,0.15)` | M |
| `--color-bg-injured` | Injured reserve bg | `#fff5f5` | `rgba(220,38,38,0.08)` | M |
| `--color-bg-injured-alt` | Injured reserve alt bg | `#ffe8e8` | `rgba(220,38,38,0.15)` | M |
| `--color-border-practice` | Practice squad border | `#bfdbfe` | `rgba(59,130,246,0.3)` | M |
| `--color-border-injured` | Injured reserve border | `#fecaca` | `rgba(220,38,38,0.3)` | M |

## Homepage Messages (6 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--hpm-header-bg` | Message header bg | `var(--alert-warning-bg)` | `var(--alert-warning-bg)` | F (ref) |
| `--hpm-header-border` | Message header border | `var(--alert-warning-border)` | `var(--alert-warning-border)` | F (ref) |
| `--hpm-header-color` | Message header text | `var(--alert-warning-text)` | `var(--alert-warning-text)` | F (ref) |
| `--hpm-body-bg` | Message body bg | `var(--alert-warning-bg)` | `var(--alert-warning-bg)` | F (ref) |
| `--hpm-body-border` | Message body border | `var(--alert-warning-border)` | `var(--alert-warning-border)` | F (ref) |
| `--hpm-body-color` | Message body text | `var(--alert-warning-text)` | `var(--alert-warning-text)` | F (ref) |

## Live Scoring (2 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--live-scoring-highlight` | Score highlight color | `var(--accent-color)` | `var(--accent-color)` | F (ref) |
| `--live-scoring-border` | Score border | `var(--dark-accent-color)` | `var(--dark-accent-color)` | F (ref) |

## Container Header (1 token)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--container-header-bg` | Container header bg | `var(--header-bg)` | `var(--header-bg)` | F (ref) |

## Tabs (5 tokens)

| Token | Controls | Light Mode | Dark Mode | Source |
|-------|----------|-----------|-----------|--------|
| `--tab-text-color` | Inactive tab text | `var(--gray2)` | `var(--gray2)` | F (ref) |
| `--tab-active-text-color` | Active tab text | `var(--primary-color)` | `var(--primary-color)` | F (ref) |
| `--tab-active-indicator-color` | Active tab underline | `var(--accent-color)` | `var(--accent-color)` | F (ref) |
| `--tab-separator-color` | Tab separator line | `var(--border-color)` | `var(--border-color)` | F (ref) |
| `--tab-hover-color` | Tab hover text | `var(--primary-color)` | `var(--primary-color)` | F (ref) |
