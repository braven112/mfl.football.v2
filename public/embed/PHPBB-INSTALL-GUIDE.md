# phpBB Navigation Integration - Installation Guide

## Overview

This embeds TheLeague.us header, navigation drawer, and footer into your phpBB forum so it looks like part of the main site.

**What you get:**
- Blue breadcrumb bar with "← Back to MFL" and hamburger toggle
- League logo + name header with desktop quick-link icons
- Full sliding nav drawer (identical sections to the main site)
- Personalized team info in the nav footer (reads `myteam` cookie)
- Site footer with champion banner and nav columns

**File:** `public/embed/phpbb-nav.html`

This single file contains three sections you need to split up:
1. **CSS** (goes in `<head>`)
2. **Header HTML + Drawer** (goes after `<body>`)
3. **Footer HTML + JS** (goes before `</body>`)

---

## Step-by-Step Installation

### 1. Access phpBB Templates

In your phpBB admin panel, go to:
**ACP → Styles → Templates → Edit**

Or directly edit files at:
```
styles/your_theme/template/overall_header.html
styles/your_theme/template/overall_footer.html
```

### 2. Add the CSS

**Option A: Inline in the header template**

Open `overall_header.html` and find the `</head>` tag. Paste the entire `<style>...</style>` block from `phpbb-nav.html` just before `</head>`.

**Option B: External stylesheet (recommended for maintainability)**

1. Extract the CSS from `phpbb-nav.html` into a file: `styles/your_theme/theme/theleague-nav.css`
2. In `overall_header.html`, add before `</head>`:
   ```html
   <link rel="stylesheet" href="{T_THEME_PATH}/theleague-nav.css">
   ```

### 3. Add the Header HTML

In `overall_header.html`, find where the page content begins (after `<body>` tag, before phpBB's own header/content).

Paste everything between these comments:
```
<!-- Breadcrumb Bar -->
...through...
<!-- end of Nav Drawer aside -->
```

This includes:
- `.tl-breadcrumb-bar` (blue top bar)
- `.tl-header` (logo + desktop nav)
- `.tl-nav-overlay` (mobile backdrop)
- `.tl-nav-drawer` (the sliding drawer `<aside>`)

### 4. Add the Footer HTML

In `overall_footer.html`, find where phpBB's content ends (before `</body>`).

Paste the `<footer class="tl-site-footer">...</footer>` block.

### 5. Add the JavaScript

In `overall_footer.html`, paste the entire `<script>...</script>` block just before `</body>`.

The JS handles:
- Dynamic MFL year calculation
- Drawer open/close with full accessibility (focus trap, escape key, etc.)
- Rendering nav sections from config
- Reading the `myteam` cookie for personalized footer
- Setting MFL link URLs

---

## How Cookie-Based Personalization Works

Since the forum is at `theleague.us/forum/` and the main site is at `theleague.us/`, they share the same domain. The `myteam` cookie (set when a user verifies their team on the main site) is automatically available to the forum.

**The flow:**
1. User visits main site → clicks "Verify Your Team" → gets redirected through MFL
2. MFL redirect sets `?myteam=0004` in the URL
3. Main site JS reads the param and sets `myteam=0004` cookie on `theleague.us`
4. User visits forum → embed JS reads `myteam` cookie → shows "Boomtown" with team icon

If the user hasn't verified, the nav footer shows "Verify Your Team" with a link to MFL.

---

## Customization

### Updating the Champion Banner
Edit the footer HTML to change the champion image and alt text:
```html
<img src="https://theleague.us/assets/theleague/banners/NEW_CHAMPION.png" alt="New Champion - 2025 Champions" />
```

### Adding/Removing Nav Links
Edit the `NAV_SECTIONS` array in the JavaScript. Each link needs:
```js
{ id: 'unique-id', label: 'Display Name', icon: 'sprite-icon-name', href: 'https://...', external: true/false }
```

Set `active: true` on the "Message Board" link to highlight it as the current page.

### Team Data
If team names change, update the `TEAMS` object in the JavaScript. Franchise IDs (0001-0016) map to team names and icon paths.

---

## Troubleshooting

### SVG icons not showing
The icons load from `https://theleague.us/assets/icons/sprite.svg`. If your forum uses a different domain, you may hit CORS issues. Solution: Host the sprite.svg on the forum server too.

### CSS conflicts with phpBB
All CSS classes are prefixed with `.tl-` to avoid conflicts. If you see issues, check for phpBB styles that use `!important` on common properties like `background`, `color`, or `display`. You may need to add `!important` to specific `.tl-` rules.

### Nav drawer appears behind phpBB elements
The drawer uses `z-index: 9050`. If phpBB has elements with higher z-index values, increase the `--tl-nav-z-*` custom properties.

### myteam cookie not working
Check that:
1. The cookie path is `/` (not restricted to a subdirectory)
2. Both sites use the same domain (theleague.us)
3. The cookie hasn't expired

---

## Phase 2: Automated Sync (Future)

To eliminate manual syncing, we can create a build step that generates `nav-widget.js` and `nav-widget.css` from the source nav config. The phpBB template would then just reference:

```html
<link rel="stylesheet" href="https://theleague.us/embed/nav-widget.css">
<script src="https://theleague.us/embed/nav-widget.js"></script>
<div id="tl-nav-mount"></div>
```

Any changes to `nav-config.json` would auto-propagate on the next build/deploy.
