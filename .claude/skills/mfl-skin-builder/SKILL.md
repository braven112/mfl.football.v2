---
name: build-skin
description: "Build a new MFL league CSS skin/theme. Use this skill whenever someone wants to create custom styling for their MyFantasyLeague (MFL) league pages — including colors, fonts, and light/dark mode. Trigger on: /build-skin, 'new skin', 'build a skin', 'league theme', 'MFL CSS', 'custom colors for my league', 'change the look of my MFL site', 'style my league', 'build a theme', 'create a theme', 'new MFL look', 'league styling', 'skin my league'. Even if the user just mentions wanting their MFL pages to look different or asks about CSS for MFL, use this skill."
---

# MFL Skin Builder

Build a new MFL CSS skin by copying an existing variables file, updating the colors/fonts, and compiling. The end result is a single `.css` file the commissioner plugs into their MFL league.

## How MFL Skins Work

Every skin has two files in `src/assets/css/src/`:

1. **`_variables-{name}.scss`** — A `:root` block with CSS custom properties (colors, fonts, etc.) + SCSS `$variable` wrappers. This is the only file where skin-specific values live.
2. **`{name}_main.scss`** — Entry file that imports fonts, reset, nav-tokens, all component partials, and the variables file. The component list is identical across all skins.

The build script (`scripts/build-themes.js`) compiles entry files to `public/assets/css/dist/{name}_main.css`.

**Why it works:** All component partials internally load `_variables.scss` (TheLeague defaults). The skin's variables file is imported last in the main entry, so its `:root` block appears at the end of the compiled CSS and wins via cascade.

## Step 1: Interview

Ask the commissioner:

| Input | Example | Notes |
|-------|---------|-------|
| **Skin name** | `space-black` | kebab-case, used for filenames |
| **Base theme** | `light` or `dark` | Which existing variables file to copy from |
| **Accent color** | `#DC4405` | Buttons, secondary nav, calendar today, logo accent |
| **Primary color** | `#051C2C` | Menus, headers, icons, links, footer (light mode) or headlines/icons (dark mode) |
| **Headline font** | `Roboto Slab` | Google Fonts name |
| **Body font** | `Roboto` | Google Fonts name |

## Step 2: Create the Variables File

1. **Copy** the base variables file:
   - Light base: `src/assets/css/src/_variables.scss`
   - Dark base: `src/assets/css/src/_variables-dark.scss`
2. **Save as** `src/assets/css/src/_variables-{name}.scss`
3. **Update** the comment block at the top with the new skin name
4. **Find and replace** the color values in the `:root` block. Read `references/token-map.md` to understand which tokens map to which user input. The key substitutions:

**Accent color** — replace in these tokens:
- `--accent-color`, `--dark-accent-color` (darken 10%)
- `--button-bg-color`, `--button-bg-color-hover` (lighten 5%)
- `--secondary-menu-bg-color`, `--secondary-menu-border-color`
- `--today-bg-color`, `--today-border-color`
- `--logo-secondary-color`, `--logo-secondary-text-color`
- `--logo-name-primary-color`
- `--caption-color`, `--headline-font-color`, `--h1-color` through `--h6-color` (dark mode only)
- `--icon-color`, `--icon-color-hover`, `--icon-text-color` (dark mode only)
- `--logo-main-color`, `--logo-text-color` (dark mode only)

**Primary color** — replace in these tokens:
- `--primary-color`, `--secondary-color` (light mode only — dark mode uses #f7f7f7)
- `--link-color`, `--link-color-hover`
- `--menu-bg-color`, `--menu-bg-hover-color`, `--menu-border-color`
- `--footer-bg-color`
- `--table-header-color`
- `--caption-color`, `--headline-font-color`, `--h1-color` through `--h6-color` (light mode only)
- `--icon-color`, `--icon-color-hover`, `--icon-text-color` (light mode only)
- `--header-icon-color`, `--header-icon-text-color`, `--header-icon-hover-color`
- `--logo-main-color`, `--logo-text-color` (light mode only)
- `--logo-name-secondary-color`
- `--division-heading-color`, `--division-subheading-color`

**Fonts** — update these tokens:
- `--headline-font`: user's headline font name (in quotes)
- `--body-font`: user's body font name (in quotes)

5. **Update the SCSS `$variable` wrappers** below the `:root` block to match (these are just `$var: var(--var);` lines — the structure stays the same, just make sure any new tokens added to `:root` have matching `$var` wrappers)

## Step 3: Create the Main Entry File

Save as `src/assets/css/src/{name}_main.scss`:

```scss
@use "./fonts-{name}";
@use "./reset";

//// Design Tokens (load before components)
@use "./nav-tokens";

//// Alphabetical
@use "./add-drop";
@use "./alerts";
@use "./auctions";
@use "./calendar";
@use "./chat";
@use "./commish";
@use "./constitution";
@use "./custom-buttons";
@use "./custom-message-board";
@use "./draft";
@use "./draft-grid";
@use "./footer";
@use "./franchise-icons";
@use "./grid";
@use "./header";
//@use "./history";
@use "./icons";
@use "./injured-reserve";
@use "./inputs";
@use "./livescoring";
@use "./livescoring-toshabman";
@use "./login";
@use "./message-board";
@use "./mflmenu";
@use "./mflsubmenu";
@use "./mfltabs";
@use "./misc";
@use "./news";
@use "./owner-setup";
@use "./player-news";
@use "./playoffs";
@use "./playoff-projections";
@use "./power-rank";
@use "./rosters";
@use "./salarycap";
@use "./scrollbar";
@use "./standings";
@use "./submit-lineup";
@use "./tables";
@use "./tabs";
@use "./theleague";
@use "./top-players";
@use "./transactions";

//// Skin override — MUST be last (CSS cascade: last :root wins)
@use "./variables-{name}";
```

**The last line is critical.** Without it, the skin's colors won't apply.

## Step 4: Create the Fonts File

Save as `src/assets/css/src/_fonts-{name}.scss`. For Google Fonts:

```scss
@import url('https://fonts.googleapis.com/css2?family={Headline+Font}:wght@400..900&family={Body+Font}:wght@300..900&display=swap');
```

For self-hosted fonts (like the dark theme's UFC Sans), use `@font-face` declarations instead. Check `_fonts-dark.scss` for an example.

## Step 5: Build & Provide URL

```bash
node scripts/build-themes.js
```

Verify `public/assets/css/dist/{name}_main.css` exists, then give the commissioner their URL:

```
https://mflfootballv2.vercel.app/assets/css/dist/{name}_main.css
```

Tell them to paste this into MFL Commissioner → Appearance → Custom CSS URL.

Remind them the URL goes live after the changes are deployed (pushed to main or preview deployment).

## Promoting a Hardcoded Value to a Variable

Sometimes a commissioner wants to change something that isn't a CSS variable yet — for example, a border width, a specific background color buried in a component partial, or a font size that's hardcoded in pixels. When this happens, don't just hack it for one skin. Promote it to a variable so every skin can control it going forward.

### Process

1. **Find the hardcoded value** in the source SCSS partial (e.g., `_rosters.scss`, `_standings.scss`, etc.). These files live in `src/assets/css/src/`.

2. **Create a new CSS custom property** in the base variables file (`_variables.scss`):
   - Add it to the `:root` block in the appropriate category section
   - Use the naming convention: `--{category}-{property}` (e.g., `--roster-header-bg`, `--table-border-width`)
   - Set the value to whatever it was hardcoded as (so existing skins don't change)
   - Add a matching SCSS `$variable` wrapper below the `:root` block

3. **Replace the hardcoded value** in the component partial with `var(--new-variable)` (or `$new-variable` if the partial uses SCSS variables).

4. **Add the new variable to ALL existing skin variable files** — not just the one being built. Every `_variables-*.scss` file needs the new token added to its `:root` block and `$variable` wrapper section:
   - `_variables.scss` (TheLeague light — the base, already done in step 2)
   - `_variables-dark.scss`
   - `_variables-afl.scss`
   - Any other `_variables-*.scss` files that exist

   For each skin, set the value to whatever makes sense for that skin's look. If unsure, use the same default value — the commissioner can always change it later.

5. **Update `references/token-map.md`** with the new token: what it controls, which category it belongs to, and its default values.

### Example

Commissioner says: "I want the roster table header to have a different background than the default."

The roster table header background is hardcoded as `#1c497c` in `_rosters.scss`:

```scss
// Before (hardcoded)
.roster-header { background: #1c497c; }
```

Promote it:

```scss
// In _variables.scss :root block, under "Roster Page" section:
--roster-header-bg: #1c497c;

// In _variables.scss $variable wrappers:
$roster-header-bg: var(--roster-header-bg);

// In _rosters.scss (replace hardcoded value):
.roster-header { background: var(--roster-header-bg); }

// In _variables-dark.scss :root block:
--roster-header-bg: #141516;

// In _variables-afl.scss :root block:
--roster-header-bg: #1c497c;
```

Now every skin can control this value, and the new skin can set it to whatever the commissioner wants.

## Reference

- `references/token-map.md` — what every CSS custom property controls and which user input it maps to
