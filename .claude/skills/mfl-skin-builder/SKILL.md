---
name: build-skin
description: "Build a new MFL league CSS skin/theme from scratch. Use this skill whenever someone wants to create custom styling for their MyFantasyLeague (MFL) league pages — including colors, fonts, and light/dark mode. Trigger on: /build-skin, 'new skin', 'build a skin', 'league theme', 'MFL CSS', 'custom colors for my league', 'change the look of my MFL site', 'style my league', 'build a theme', 'create a theme', 'new MFL look', 'league styling', 'skin my league'. Even if the user just mentions wanting their MFL pages to look different or asks about CSS for MFL, use this skill."
---

# MFL Skin Builder

You are building a complete CSS skin for a MyFantasyLeague (MFL) league. The skin system uses SCSS with CSS custom properties (`:root` variables) that control every visual element of MFL's hosted pages — menus, tables, buttons, headers, footers, calendars, icons, and more.

The end result is a compiled CSS file hosted on Vercel that the commissioner plugs into their MFL league settings.

---

## Overview

You will:
1. Interview the commissioner for their brand preferences
2. Generate 4 SCSS files
3. Compile them via the existing build system
4. Provide the Vercel URL for the compiled CSS

---

## Step 1: Interview

Ask the commissioner for these inputs. Use AskUserQuestion to present them clearly:

### Required Inputs

| Input | Format | Example | What it Controls |
|-------|--------|---------|-----------------|
| **Skin name** | kebab-case | `dynasty-kings` | File naming (e.g., `_variables-dynasty-kings.scss`) |
| **Primary color** | Hex | `#1c497c` | Menus, headers, headings (h1-h6), icons, links, footer background, table headers, division headings |
| **Accent color** | Hex | `#3c9950` | Buttons, secondary nav, calendar "today" highlight, logo accent, live scoring highlight |
| **Headline font** | Google Fonts name | `Roboto Slab` | Section headings, page titles, SVG text |
| **Body font** | Google Fonts name | `Roboto` | Body text, table cells, labels |
| **Style** | `light` or `dark` | `light` | Controls background/text color inversion |

### Validation

- Skin name must be kebab-case (lowercase letters, numbers, hyphens only)
- Colors must be valid hex (`#` + 3 or 6 hex chars)
- Font names should be real Google Fonts — verify by constructing the Google Fonts URL and checking it loads
- If any input is invalid, explain why and ask again

### Tips for the Commissioner

If they're unsure about colors, suggest they pick from their league logo or team colors. For fonts, suggest popular pairings:
- **Classic**: Roboto Slab + Roboto
- **Modern**: Inter + Inter
- **Bold**: Oswald + Source Sans Pro
- **Elegant**: Playfair Display + Lato
- **Fun**: Bangers + Nunito

---

## Step 2: Generate Files

Generate all 4 SCSS files in `src/assets/css/src/`. Read the reference files to understand the exact format:

1. **Read** `references/color-derivation.md` — this has every derivation rule
2. **Read** `references/main-template.md` — this has the file templates
3. **Read** `references/token-map.md` if you need to understand what a specific token controls

### File 1: `_fonts-{name}.scss`

A single Google Fonts `@import` line. Construct the URL from the font names:

```scss
@import url('https://fonts.googleapis.com/css2?family={Headline+Font}:wght@400..900&family={Body+Font}:wght@300..900&display=swap');
```

Replace spaces in font names with `+`. Check whether each font supports variable weights (use `wght@min..max`) or fixed weights (use `wght@300;400;700`).

### File 2: `_variables-{name}.scss`

This is the largest file — a complete `:root` block with all 60+ CSS custom properties, followed by SCSS `$variable` wrappers that reference them.

**Structure:**
1. Opening comment with skin name
2. `:root { ... }` block with ALL tokens organized by category
3. SCSS `$variable: var(--variable);` wrappers for each token

Use `references/color-derivation.md` to determine every value:
- Apply primary color to all "P" tokens
- Apply accent color to all "A" tokens
- Compute derived values (darken/lighten) for "D" tokens
- Use the light or dark fixed values for "M" and "F" tokens

**The `:root` block must include ALL of these categories in order:**
1. Colors (primary, secondary, accent, dark-accent, text colors)
2. Links (link-color, link-color-hover, add-color, drop-color)
3. Alerts (danger, warning, success, info — text/bg/border each)
4. Neutrals (grays, offwhites, lightgrays, white, codebg)
5. Tables (oddtablerow, eventablerow, newposition-border, table-header)
6. Page Backgrounds (primary-bg, pagebody-bg, report-bg, header-bg)
7. Footer (bg, text, header-text)
8. Borders (border-color)
9. MFL Menu (bg, hover, border, text)
10. Report Navigation (border, bg, text, link, icon, icon-hover, font-weight)
11. Buttons (bg, hover, link)
12. Scrollbar (bg, hover)
13. Captions & Headlines (caption, headline-font-color, h1-h6)
14. Icons (color, hover, text)
15. Calendar (bg, eventablerow, border, text, today-bg, today-border, today-text)
16. Logo (main, secondary, 3rd, 4th, text, secondary-text)
17. Typography (headline-font, headline-font-weight, body-font, body-font-weight, svg-text-font-size)
18. Border Radius (sm, default, lg, xl)
19. Header Icons (color, text, hover)
20. Logo Name (primary, secondary)
21. Division Headings (heading, subheading, border)
22. Roster Page (bg-base, bg-subtle, bg-practice, bg-practice-alt, bg-injured, bg-injured-alt, border-practice, border-injured)
23. Homepage Messages (header bg/border/color, body bg/border/color — all `var()` refs)
24. Live Scoring (highlight, border — `var()` refs)
25. Container Header (bg — `var()` ref)
26. Tabs (text, active-text, active-indicator, separator, hover — all `var()` refs)

**After the `:root` block**, add the SCSS `$variable` wrappers. These follow the exact same pattern as the existing `_variables.scss` file — one `$variable: var(--variable);` line for each custom property. Copy the wrapper section structure from `_variables.scss` (read it if needed).

### File 3: `_globals-{name}.scss`

Short file that forwards the variables:

```scss
@forward "color-helpers";
@forward "variables-{name}";

:root {
  --color-bg-base: {value};
  --color-bg-subtle: {value};
  --color-bg-practice: {value};
  --color-bg-practice-alt: {value};
  --color-bg-injured: {value};
  --color-bg-injured-alt: {value};
  --color-border-practice: {value};
  --color-border-injured: {value};
}
```

Values come from the "Roster Page" section in `references/color-derivation.md`.

### File 4: `{name}_main.scss`

The entry file. Copy the template from `references/main-template.md`, replacing `{name}` with the skin name.

**CRITICAL:** The last `@use` line in the main entry MUST be `@use "./globals-{name}"`. This is what makes the skin's colors actually apply. Here's why: all component partials internally load `_globals.scss` → `_variables.scss`, which outputs the TheLeague default `:root` block. The skin's globals file outputs a second `:root` block at the end of the CSS, and CSS cascade (last `:root` wins) makes the skin's values override the defaults. Without this line, the skin would look identical to TheLeague regardless of the colors chosen.

Optionally, add a body font-size override at the bottom if the commissioner wants a different base size:

```scss
// Optional: custom base font size
body {
  font-size: 14.25px;
}
```

---

## Step 3: Build

Run the build script to compile the SCSS:

```bash
node scripts/build-themes.js
```

This compiles ALL entry files (non-underscore `.scss` files) in `src/assets/css/src/` to `public/assets/css/dist/`. The new skin will appear as `public/assets/css/dist/{name}_main.css`.

**Verify the build succeeded:**
1. Check the output for `Compiled {name}_main.scss -> public/assets/css/dist/{name}_main.css`
2. Verify the file exists and has reasonable size (should be 50-150KB)
3. Spot-check a few values in the compiled CSS — search for the primary and accent hex colors to confirm they appear

If the build fails, read the error message. Common issues:
- Missing closing brace in the variables file
- Typo in a `@use` or `@forward` path
- Invalid SCSS syntax in font import URL

---

## Step 4: Provide the Vercel URL

After successful build, provide the commissioner with the URL where their CSS will be hosted once deployed:

```
https://mflfootballv2.vercel.app/assets/css/dist/{name}_main.css
```

**Tell the commissioner:**

> Your new skin has been built! Once deployed, your CSS will be available at:
>
> `https://mflfootballv2.vercel.app/assets/css/dist/{name}_main.css`
>
> To use it in MFL:
> 1. Go to your MFL league's Commissioner tools
> 2. Navigate to **Appearance** → **Custom CSS URL**
> 3. Paste the URL above
> 4. Save — your league pages will now use the new skin

Also mention that they should deploy the changes (push to main or create a preview deployment) to make the CSS live at that URL.

---

## Reference Files

Read these as needed during generation:

| File | When to Read |
|------|-------------|
| `references/token-map.md` | To understand what each CSS property controls |
| `references/color-derivation.md` | To determine every token value from the user's inputs |
| `references/main-template.md` | For the exact file templates and import lists |

You can also read the existing skin files for reference if the templates aren't clear:
- `src/assets/css/src/_variables.scss` — TheLeague light theme (canonical)
- `src/assets/css/src/_variables-dark.scss` — Dark theme
- `src/assets/css/src/_variables-afl.scss` — AFL theme (accent override example)
- `src/assets/css/src/_globals.scss` — TheLeague globals
- `src/assets/css/src/_globals-afl.scss` — AFL globals
- `src/assets/css/src/_fonts.scss` — TheLeague fonts
- `src/assets/css/src/_fonts-afl.scss` — AFL fonts
- `src/assets/css/src/theleague_main.scss` — TheLeague main entry
- `src/assets/css/src/afl_main.scss` — AFL main entry

---

## Quality Checklist

Before declaring the skin complete:

- [ ] All 4 files created in `src/assets/css/src/`
- [ ] Variables file has ALL 60+ tokens (don't skip any category)
- [ ] `:root` block AND `$variable` wrappers both present in variables file
- [ ] Globals file forwards the correct variables file name
- [ ] Main entry file references the correct fonts file name
- [ ] Main entry file has `@use "./globals-{name}"` as the LAST import (critical for CSS cascade)
- [ ] Build succeeds with no errors
- [ ] Compiled CSS exists in `public/assets/css/dist/`
- [ ] Primary and accent colors appear in the compiled output
- [ ] Font family names appear in the compiled output
- [ ] Vercel URL provided to the commissioner
