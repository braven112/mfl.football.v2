# MFL CSS Customization Guide

This guide explains how to customize the dark theme CSS files (`dark_main.css` and `dark_din_main.css`) for your MFL league. You don't need to create a new stylesheet — just override specific CSS variables using a `<style>` block in an MFL Homepage Message.

---

## Table of Contents

1. [How It Works](#how-it-works)
2. [Getting Started — Override Variables in a Homepage Message](#getting-started)
3. [Giving Claude the Context It Needs](#giving-claude-context)
4. [Complete CSS Variable Reference](#variable-reference)
5. [Common Customization Examples](#examples)
6. [Using the SVG Icon Sprite](#icon-sprite)
7. [Adding New Icons to the Sprite](#adding-icons)
8. [Submitting New Icons via Pull Request](#submitting-icons-pr)
9. [Font Differences Between the Two CSS Files](#font-differences)
10. [Tips and Gotchas](#tips)

---

## <a id="how-it-works"></a>1. How It Works

The CSS files (`dark_main.css` or `dark_din_main.css`) are loaded via the **Custom CSS URL** field in MFL:

> **Setup > Franchise Setup > Images and Other URLs > Custom CSS**

Every color, font, spacing value, and visual style in these files is controlled by **CSS custom properties** (also called CSS variables) defined in a `:root` block at the top of the stylesheet. Because CSS custom properties cascade, you can **override any of them** by adding a `<style>` block in an MFL Homepage Message — no need to edit or replace the base CSS file.

**How the cascade works:**
1. MFL loads your Custom CSS file (e.g., `dark_main.css`)
2. MFL renders Homepage Messages, which can contain `<style>` blocks
3. The `<style>` block's `:root` overrides win because they appear later in the page

---

## <a id="getting-started"></a>2. Getting Started — Override Variables in a Homepage Message

Create (or edit) an MFL **Homepage Message** and add a `<style>` block like this:

```html
<style>
:root {
  /* === Brand Colors === */
  --accent-color: #ff4500;           /* Change gold accent to orange-red */
  --dark-accent-color: #cc3700;      /* Darker version for hover states */

  /* === Text === */
  --primary-text-color: #f0f0f0;     /* Slightly brighter body text */

  /* === Backgrounds === */
  --pagebody-bg: #0a0a0a;            /* Deeper black page background */

  /* === Headings === */
  --h1-color: #ff4500;               /* Match headings to new accent */
  --h2-color: #ff4500;
  --h3-color: #ff4500;

  /* === Buttons === */
  --button-bg-color: #ff4500;        /* Button background matches accent */
  --button-bg-color-hover: #ff6030;  /* Lighter on hover */
  --button-link-color: #ffffff;      /* White text on buttons */
}
</style>
```

**That's it.** Only list the variables you want to change. Everything else keeps its default value from the base CSS file.

---

## <a id="giving-claude-context"></a>3. Giving Claude the Context It Needs

When you're working with Claude to customize your CSS, paste the following prompt at the start of your conversation so Claude understands the system:

---

**Copy this prompt to Claude:**

> I'm customizing an MFL (MyFantasyLeague) league website. My league uses a dark theme CSS file loaded via MFL's Custom CSS URL field. I override specific CSS variables using a `<style>` block inside an MFL Homepage Message.
>
> The base CSS file defines all styles using CSS custom properties (variables) in a `:root` block. I can override any variable by redefining it in my Homepage Message's `<style>` block — the override wins because it appears later on the page.
>
> Here is the complete list of CSS variables I can override, with their current default values:
>
> ```css
> :root {
>   /* Colors */
>   --primary-color: #cccccc;
>   --secondary-color: #eeeeee;
>   --accent-color: #c9a94e;
>   --dark-accent-color: #a8893a;
>   --primary-text-color: #e0e0e0;
>   --secondary-text-color: #c0c0c0;
>   --link-color: #bbbbbb;
>   --link-color-hover: #c9a94e;
>   --add-color: #4ade80;
>   --drop-color: #f87171;
>
>   /* Alerts */
>   --alert-danger-text: #fca5a5;
>   --alert-danger-bg: rgba(220, 38, 38, 0.15);
>   --alert-danger-border: rgba(220, 38, 38, 0.25);
>   --alert-warning-text: #fcd34d;
>   --alert-warning-bg: rgb(57, 36, 1);
>   --alert-warning-border: rgb(216, 155, 49);
>   --alert-success-text: #6ee7b7;
>   --alert-success-bg: rgba(16, 185, 129, 0.12);
>   --alert-success-border: rgba(16, 185, 129, 0.25);
>   --alert-info-text: #93bbfd;
>   --alert-info-bg: rgba(59, 130, 246, 0.12);
>   --alert-info-border: rgba(59, 130, 246, 0.25);
>
>   /* Neutrals */
>   --gray1: #d8d8d8;
>   --gray2: #8a8a8a;
>   --gray3: #6b6b6b;
>   --offwhite: #2e2e2e;
>   --offwhite2: #121212;
>   --lightgray: #2e2e2e;
>   --lightgray2: #3a3a3a;
>   --lightgray3: #5a5a5a;
>   --white: #2e2e2e;
>   --codebg-color: #151515;
>
>   /* Tables */
>   --oddtablerow: #2e2e2e;
>   --eventablerow: #444444;
>   --newposition-border-color: #3a3a3a;
>   --table-header-color: #8a8a8a;
>
>   /* Page Backgrounds */
>   --primary-bg-color: #2e2e2e;
>   --pagebody-bg: #121212;
>   --report-bg: #2e2e2e;
>   --header-bg: #101010;
>
>   /* Footer */
>   --footer-bg-color: #101010;
>   --footer-text-color: #e0e0e0;
>   --footer-header-text-color: #e0e0e0;
>
>   /* Borders */
>   --border-color: #2e2e2e;
>
>   /* MFL Top Menu */
>   --menu-bg-color: #101010;
>   --menu-bg-hover-color: #1d1d1d;
>   --menu-border-color: #1a1a1a;
>   --menu-text-color: #e0e0e0;
>
>   /* Report Sub-Navigation */
>   --secondary-menu-border-color: #c9a94e;
>   --secondary-menu-bg-color: #8a7230;
>   --secondary-menu-text-color: #e0e0e0;
>   --secondary-menu-link-color: #e0e0e0;
>   --secondary-menu-icon-color: #e0e0e0;
>   --secondary-menu-icon-hover-color: #ededed;
>   --secondary-menu-font-weight: normal;
>
>   /* Buttons */
>   --button-bg-color: #c9a94e;
>   --button-bg-color-hover: #d4b85e;
>   --button-link-color: #121212;
>
>   /* Tabs */
>   --tab-hover-color: #fff;
>
>   /* Scrollbar */
>   --scrollbar-bg-color: #3a3a3a;
>   --scrollbar-bg-hover-color: #4a4a4a;
>
>   /* Captions and Headings */
>   --caption-color: #c9a94e;
>   --headline-font-color: #c9a94e;
>   --h1-color: #c9a94e;
>   --h2-color: #c9a94e;
>   --h3-color: #c9a94e;
>   --h4-color: #c9a94e;
>   --h5-color: #c9a94e;
>   --h6-color: #c9a94e;
>
>   /* Icons */
>   --icon-color: #c9a94e;
>   --icon-color-hover: #d4b85e;
>   --icon-text-color: #c9a94e;
>
>   /* Calendar */
>   --calendar-bg-color: #282828;
>   --calendar-eventablerow: #2e2e2e;
>   --calendar-border-color: #444033;
>   --calendar-text-color: #e0e0e0;
>   --today-bg-color: #c9a94e;
>   --today-border-color: #b89a42;
>   --today-text-color: #121212;
>
>   /* Logo / SVG Crest */
>   --logo-main-color: #c9a94e;
>   --logo-secondary-color: #1d1d1d;
>   --logo-3rd-color: #3a3a3a;
>   --logo-4th-color: #c9a94e;
>   --logo-text-color: #c9a94e;
>   --logo-secondary-text-color: #1d1d1d;
>
>   /* Roster Page */
>   --color-bg-base: #323232;
>   --color-bg-subtle: #272727;
>   --color-bg-practice: rgba(59, 130, 246, 0.1);
>   --color-bg-practice-alt: rgba(59, 130, 246, 0.15);
>   --color-bg-injured: rgba(220, 38, 38, 0.1);
>   --color-bg-injured-alt: rgba(220, 38, 38, 0.15);
>   --color-border-practice: rgba(59, 130, 246, 0.3);
>   --color-border-injured: rgba(220, 38, 38, 0.3);
>
>   /* Header Icon Buttons */
>   --header-icon-color: #666666;
>   --header-icon-text-color: #eeeeee;
>   --header-icon-hover-color: #dddddd;
>
>   /* Logo Name */
>   --logo-name-primary-color: #c9a94e;
>   --logo-name-secondary-color: #e0e0e0;
>
>   /* Division Headings */
>   --division-heading-color: #e0e0e0;
>   --division-subheading-color: #c9a94e;
>   --division-border-color: #666666;
>
>   /* Typography */
>   --headline-font: "UFC Sans Condensed", sans-serif;
>   --headline-font-weight: 700;
>   --body-font: "UFC Sans Condensed", sans-serif;
>   --body-font-weight: 400;
>   --svg-text-font-size: 11px;
>
>   /* Border Radius */
>   --border-radius-sm: .25rem;
>   --border-radius-default: .5rem;
>   --border-radius-lg: 1rem;
>   --border-radius-xl: 8rem;
> }
> ```
>
> When I ask you to change something, generate ONLY a `<style>` block containing the overridden variables. Do not regenerate the entire stylesheet. Only include variables that are changing.

---

That prompt gives Claude everything it needs. From there you can say things like:

- "Change my accent color to red `#dc2626`"
- "Make the page background pure black"
- "Make the table headers match my accent color"
- "Change my heading font to Arial"

And Claude will respond with the correct `<style>` block.

---

## <a id="variable-reference"></a>4. Complete CSS Variable Reference

Below is every variable available, grouped by what it controls. Default values shown are from `dark_main.css` (the UFC font version). The `dark_din_main.css` file uses identical values except for the font variables.

### Brand / Accent Colors
| Variable | Default | What it controls |
|---|---|---|
| `--primary-color` | `#cccccc` | Primary UI color (light gray in dark mode) |
| `--secondary-color` | `#eeeeee` | Secondary UI color |
| `--accent-color` | `#c9a94e` | Main accent / brand highlight (gold) |
| `--dark-accent-color` | `#a8893a` | Darker accent for hover/active states |

### Text Colors
| Variable | Default | What it controls |
|---|---|---|
| `--primary-text-color` | `#e0e0e0` | Main body text |
| `--secondary-text-color` | `#c0c0c0` | Muted / secondary text |
| `--link-color` | `#bbbbbb` | Link text color |
| `--link-color-hover` | `#c9a94e` | Link hover color |

### Page Backgrounds
| Variable | Default | What it controls |
|---|---|---|
| `--pagebody-bg` | `#121212` | Full page background |
| `--primary-bg-color` | `#2e2e2e` | Content area / card backgrounds |
| `--report-bg` | `#2e2e2e` | Report page backgrounds |
| `--header-bg` | `#101010` | Site header background |
| `--codebg-color` | `#151515` | Code block backgrounds |

### Headings (h1–h6)
| Variable | Default | What it controls |
|---|---|---|
| `--headline-font-color` | `#c9a94e` | General headline color |
| `--caption-color` | `#c9a94e` | Caption text |
| `--h1-color` through `--h6-color` | `#c9a94e` | Individual heading levels |

### Typography / Fonts
| Variable | Default | What it controls |
|---|---|---|
| `--headline-font` | `"UFC Sans Condensed", sans-serif` | Heading font family |
| `--headline-font-weight` | `700` | Heading font weight |
| `--body-font` | `"UFC Sans Condensed", sans-serif` | Body text font family |
| `--body-font-weight` | `400` | Body text font weight |
| `--svg-text-font-size` | `11px` | Font size inside SVG elements |

### MFL Top Menu
| Variable | Default | What it controls |
|---|---|---|
| `--menu-bg-color` | `#101010` | Menu background |
| `--menu-bg-hover-color` | `#1d1d1d` | Menu item hover background |
| `--menu-border-color` | `#1a1a1a` | Menu border |
| `--menu-text-color` | `#e0e0e0` | Menu text |

### Report Sub-Navigation
| Variable | Default | What it controls |
|---|---|---|
| `--secondary-menu-bg-color` | `#8a7230` | Sub-nav background |
| `--secondary-menu-border-color` | `#c9a94e` | Sub-nav border |
| `--secondary-menu-text-color` | `#e0e0e0` | Sub-nav text |
| `--secondary-menu-link-color` | `#e0e0e0` | Sub-nav links |
| `--secondary-menu-icon-color` | `#e0e0e0` | Sub-nav icon fill |
| `--secondary-menu-icon-hover-color` | `#ededed` | Sub-nav icon hover fill |
| `--secondary-menu-font-weight` | `normal` | Sub-nav font weight |

### Buttons
| Variable | Default | What it controls |
|---|---|---|
| `--button-bg-color` | `#c9a94e` | Button background |
| `--button-bg-color-hover` | `#d4b85e` | Button hover background |
| `--button-link-color` | `#121212` | Button text color |

### Tables
| Variable | Default | What it controls |
|---|---|---|
| `--oddtablerow` | `#2e2e2e` | Odd row background |
| `--eventablerow` | `#444444` | Even row background |
| `--table-header-color` | `#8a8a8a` | Table header text |
| `--newposition-border-color` | `#3a3a3a` | Position change indicator border |

### Alerts
| Variable | Default | What it controls |
|---|---|---|
| `--alert-danger-text` | `#fca5a5` | Danger alert text |
| `--alert-danger-bg` | `rgba(220, 38, 38, 0.15)` | Danger alert background |
| `--alert-danger-border` | `rgba(220, 38, 38, 0.25)` | Danger alert border |
| `--alert-warning-text` | `#fcd34d` | Warning alert text |
| `--alert-warning-bg` | `rgb(57, 36, 1)` | Warning alert background |
| `--alert-warning-border` | `rgb(216, 155, 49)` | Warning alert border |
| `--alert-success-text` | `#6ee7b7` | Success alert text |
| `--alert-success-bg` | `rgba(16, 185, 129, 0.12)` | Success alert background |
| `--alert-success-border` | `rgba(16, 185, 129, 0.25)` | Success alert border |
| `--alert-info-text` | `#93bbfd` | Info alert text |
| `--alert-info-bg` | `rgba(59, 130, 246, 0.12)` | Info alert background |
| `--alert-info-border` | `rgba(59, 130, 246, 0.25)` | Info alert border |

### Icons
| Variable | Default | What it controls |
|---|---|---|
| `--icon-color` | `#c9a94e` | Default SVG icon fill |
| `--icon-color-hover` | `#d4b85e` | Icon hover fill |
| `--icon-text-color` | `#c9a94e` | Text labels next to icons |

### Calendar
| Variable | Default | What it controls |
|---|---|---|
| `--calendar-bg-color` | `#282828` | Calendar background |
| `--calendar-eventablerow` | `#2e2e2e` | Calendar alternating rows |
| `--calendar-border-color` | `#444033` | Calendar cell borders |
| `--calendar-text-color` | `#e0e0e0` | Calendar text |
| `--today-bg-color` | `#c9a94e` | Today highlight background |
| `--today-border-color` | `#b89a42` | Today highlight border |
| `--today-text-color` | `#121212` | Today highlight text |

### Logo / SVG Crest
| Variable | Default | What it controls |
|---|---|---|
| `--logo-main-color` | `#c9a94e` | Primary logo fill |
| `--logo-secondary-color` | `#1d1d1d` | Secondary logo fill |
| `--logo-3rd-color` | `#3a3a3a` | Third logo color |
| `--logo-4th-color` | `#c9a94e` | Fourth logo color |
| `--logo-text-color` | `#c9a94e` | Logo text fill |
| `--logo-secondary-text-color` | `#1d1d1d` | Logo secondary text fill |
| `--logo-name-primary-color` | `#c9a94e` | League name primary color |
| `--logo-name-secondary-color` | `#e0e0e0` | League name secondary color |

### Footer
| Variable | Default | What it controls |
|---|---|---|
| `--footer-bg-color` | `#101010` | Footer background |
| `--footer-text-color` | `#e0e0e0` | Footer text |
| `--footer-header-text-color` | `#e0e0e0` | Footer section headers |

### Neutrals / Grays
| Variable | Default | What it controls |
|---|---|---|
| `--gray1` | `#d8d8d8` | Lightest gray |
| `--gray2` | `#8a8a8a` | Medium gray |
| `--gray3` | `#6b6b6b` | Darkest gray |
| `--offwhite` | `#2e2e2e` | Off-white (dark mode: dark gray) |
| `--offwhite2` | `#121212` | Deeper off-white |
| `--lightgray` | `#2e2e2e` | Light gray |
| `--lightgray2` | `#3a3a3a` | Medium light gray |
| `--lightgray3` | `#5a5a5a` | Darker light gray |
| `--white` | `#2e2e2e` | "White" (inverted for dark mode) |

### Scrollbar
| Variable | Default | What it controls |
|---|---|---|
| `--scrollbar-bg-color` | `#3a3a3a` | Scrollbar track |
| `--scrollbar-bg-hover-color` | `#4a4a4a` | Scrollbar hover |

### Roster Page
| Variable | Default | What it controls |
|---|---|---|
| `--color-bg-base` | `#323232` | Roster card base background |
| `--color-bg-subtle` | `#272727` | Subtle background areas |
| `--color-bg-practice` | `rgba(59, 130, 246, 0.1)` | Practice squad row |
| `--color-bg-injured` | `rgba(220, 38, 38, 0.1)` | IR row |

### Division Headings
| Variable | Default | What it controls |
|---|---|---|
| `--division-heading-color` | `#e0e0e0` | Division heading text |
| `--division-subheading-color` | `#c9a94e` | Division subheading text |
| `--division-border-color` | `#666666` | Division separator line |

### Header Icon Buttons
| Variable | Default | What it controls |
|---|---|---|
| `--header-icon-color` | `#666666` | Header icon fill |
| `--header-icon-text-color` | `#eeeeee` | Header icon label text |
| `--header-icon-hover-color` | `#dddddd` | Header icon hover fill |

### Miscellaneous
| Variable | Default | What it controls |
|---|---|---|
| `--add-color` | `#4ade80` | Waiver add / pickup indicator (green) |
| `--drop-color` | `#f87171` | Waiver drop indicator (red) |
| `--border-color` | `#2e2e2e` | General border color |
| `--tab-hover-color` | `#fff` | Tab hover text |
| `--border-radius-sm` | `.25rem` | Small border radius |
| `--border-radius-default` | `.5rem` | Default border radius |
| `--border-radius-lg` | `1rem` | Large border radius |
| `--border-radius-xl` | `8rem` | Extra-large / pill border radius |

---

## <a id="examples"></a>5. Common Customization Examples

### Change your brand accent from gold to red
```html
<style>
:root {
  --accent-color: #dc2626;
  --dark-accent-color: #b91c1c;
  --link-color-hover: #dc2626;
  --button-bg-color: #dc2626;
  --button-bg-color-hover: #ef4444;
  --h1-color: #dc2626;
  --h2-color: #dc2626;
  --h3-color: #dc2626;
  --h4-color: #dc2626;
  --h5-color: #dc2626;
  --h6-color: #dc2626;
  --caption-color: #dc2626;
  --headline-font-color: #dc2626;
  --icon-color: #dc2626;
  --icon-color-hover: #ef4444;
  --icon-text-color: #dc2626;
  --secondary-menu-border-color: #dc2626;
  --secondary-menu-bg-color: #7f1d1d;
  --today-bg-color: #dc2626;
  --today-border-color: #b91c1c;
  --logo-main-color: #dc2626;
  --logo-4th-color: #dc2626;
  --logo-text-color: #dc2626;
  --logo-name-primary-color: #dc2626;
  --division-subheading-color: #dc2626;
}
</style>
```

### Use a custom Google Font for headings
```html
<!-- Load the font first (also in a Homepage Message) -->
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;700&display=swap" rel="stylesheet">

<style>
:root {
  --headline-font: "Oswald", sans-serif;
  --body-font: "Oswald", sans-serif;
}
</style>
```

### Make tables higher contrast
```html
<style>
:root {
  --oddtablerow: #1a1a1a;
  --eventablerow: #2a2a2a;
  --table-header-color: #e0e0e0;
}
</style>
```

### Softer border radius (more rounded)
```html
<style>
:root {
  --border-radius-sm: .5rem;
  --border-radius-default: 1rem;
  --border-radius-lg: 1.5rem;
}
</style>
```

---

## <a id="icon-sprite"></a>6. Using the SVG Icon Sprite

All icons in the CSS are served from a single SVG sprite file:

```
public/assets/icons/sprite.svg
```

This file contains 100+ icon symbols. Each icon is a `<symbol>` element with a unique `id`.

### Browsing Available Icons

We built an **Icon Gallery** page that lets you:
- Browse all 100+ icons visually
- Search by name or keyword (e.g., "money", "trade", "roster")
- Filter by category (gameday, draft, scoring, standings, auction, waivers, playoffs, roster, etc.)
- Test colors with a live color picker
- Copy the full sprite SVG to your clipboard

**The Icon Gallery is at:** `src/pages/theleague/icons.astro` in the repo (route: `/theleague/icons`).

> **Note:** The link in the site footer to this page is currently returning a 404. This is a known issue being tracked. In the meantime, navigate directly to `/theleague/icons` in your browser if the site is running locally.

### Using an Icon in HTML

To display an icon from the sprite, use an inline SVG with a `<use>` tag:

```html
<svg width="38" height="38" viewBox="0 0 512 512">
  <use href="/assets/icons/sprite.svg#icon-trophy"></use>
</svg>
```

Replace `icon-trophy` with any icon `id` from the sprite. The `viewBox` for most icons is `0 0 512 512`, but check the gallery for the exact value.

### Controlling Icon Colors

Icons inherit their fill color from the CSS variables:

| Variable | Controls |
|---|---|
| `--icon-color` | Default icon fill |
| `--icon-color-hover` | Icon fill on hover |
| `--icon-text-color` | Text labels next to icons |

You can also override a specific icon's color inline:

```html
<svg width="38" height="38" viewBox="0 0 512 512" style="fill: #dc2626;">
  <use href="/assets/icons/sprite.svg#icon-trophy"></use>
</svg>
```

---

## <a id="adding-icons"></a>7. Adding New Icons to the Sprite

The sprite is a single SVG file with `<symbol>` elements. To add a new icon:

### Step 1 — Get your SVG

Get a clean SVG icon. Good sources:
- [Heroicons](https://heroicons.com)
- [Lucide](https://lucide.dev)
- [Feather Icons](https://feathericons.com)
- [SVG Repo](https://www.svgrepo.com)
- Ask Claude to generate one

Make sure the SVG is simple (single path, no embedded styles or transforms if possible).

### Step 2 — Convert it to a `<symbol>`

Take the raw SVG content and wrap it as a `<symbol>`. For example, if your raw SVG is:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path d="M12 2L2 7v10l10 5 10-5V7L12 2z"/>
</svg>
```

Convert it to a symbol entry:

```xml
<symbol id="icon-my-custom-icon" viewBox="0 0 24 24">
  <path d="M12 2L2 7v10l10 5 10-5V7L12 2z"/>
</symbol>
```

**Rules:**
- The `id` must start with `icon-` (e.g., `icon-my-custom-icon`)
- Copy the `viewBox` from the original SVG's `viewBox` attribute
- Only include the inner elements (`<path>`, `<circle>`, `<rect>`, etc.) — not the outer `<svg>` wrapper
- Remove any `fill="..."` attributes from the paths so the icon inherits the theme color

### Step 3 — Add it to the sprite file

Open `public/assets/icons/sprite.svg` and add your new `<symbol>` inside the root `<svg>` tag, before the closing `</svg>`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" style="display: none;">
  <!-- ... existing symbols ... -->

  <symbol id="icon-my-custom-icon" viewBox="0 0 24 24">
    <path d="M12 2L2 7v10l10 5 10-5V7L12 2z"/>
  </symbol>

</svg>
```

### Asking Claude to Help

You can ask Claude to do this conversion for you. Here's a good prompt:

> I need to add a new icon to my SVG sprite file. Here's the SVG I want to add:
>
> [paste your SVG here]
>
> Please convert this into a `<symbol>` element with the id `icon-my-name`. Remove any fill attributes so it inherits the theme color. Give me the `<symbol>` block I should paste into my sprite.svg file.

---

## <a id="submitting-icons-pr"></a>8. Submitting New Icons via Pull Request

If you want to add new icons to the shared sprite so everyone benefits, submit a Pull Request (PR) to the repository.

### Prerequisites

1. A GitHub account
2. Git installed on your computer
3. Access to the `braven112/mfl.football.v2` repository

### Step-by-Step

**1. Fork or clone the repo:**
```bash
git clone https://github.com/braven112/mfl.football.v2.git
cd mfl.football.v2
```

**2. Create a feature branch:**
```bash
git checkout -b add-icon-my-icon-name
```

**3. Edit the sprite file:**

Open `public/assets/icons/sprite.svg` in a text editor and add your `<symbol>` (see Section 7 above).

**4. (Optional) Update the icon gallery search data:**

If you want your icon to be searchable in the gallery, you can add synonyms and category tags in `src/pages/theleague/icons.astro`:

- Add an entry to the `synonyms` object (around line 28):
  ```js
  'icon-my-custom-icon': ['keyword1', 'keyword2', 'keyword3'],
  ```

- Add the icon id to relevant category arrays in the `categories` object (around line 118):
  ```js
  gameday: [
    // ...existing icons...
    'icon-my-custom-icon',
  ],
  ```

**5. Commit and push:**
```bash
git add public/assets/icons/sprite.svg
git add src/pages/theleague/icons.astro   # only if you updated synonyms/categories
git commit -m "Add icon-my-custom-icon to SVG sprite"
git push -u origin add-icon-my-icon-name
```

**6. Open a Pull Request:**
```bash
gh pr create --title "Add icon-my-custom-icon" --body "Adds a new icon for [describe what it's for]. Preview the icon in the gallery at /theleague/icons."
```

Or open the PR through GitHub's web interface.

### Asking Claude to Help Write the PR

You can paste your new SVG into Claude and ask:

> I want to add this SVG icon to the mfl.football.v2 repo's sprite file at `public/assets/icons/sprite.svg`. The icon should be called `icon-my-name`.
>
> 1. Convert it to a `<symbol>` element
> 2. Show me the search synonyms to add in `src/pages/theleague/icons.astro`
> 3. Suggest which categories it belongs in
> 4. Give me the git commands to commit and create a PR

---

## <a id="font-differences"></a>9. Font Differences Between the Two CSS Files

| CSS File | Heading Font | Body Font | How it's loaded |
|---|---|---|---|
| `dark_main.css` | UFC Sans Condensed | UFC Sans Condensed | `@font-face` with local WOFF2 files (`/assets/fonts/UFCSans-CondensedMedium.woff2` and `UFCSans-CondensedBold.woff2`) |
| `dark_din_main.css` | DIN (via Typekit) | DIN (via Typekit) | `@import url("https://use.typekit.net/wpa6ggf.css")` — loaded from Adobe Fonts |

Both files share the **exact same CSS variables and component styles**. The only difference is the font. If you override `--headline-font` and `--body-font` in your Homepage Message, you can use any font you want regardless of which base file you chose.

---

## <a id="tips"></a>10. Tips and Gotchas

### Only override what you need
You don't need to copy all 80+ variables. Only include the ones you're changing. The base stylesheet handles everything else.

### The accent color is used everywhere
`--accent-color` (`#c9a94e` gold) is the most impactful single variable. It drives headings, icons, buttons, the sub-navigation, calendar "today" highlight, logo, and more. Changing it is the fastest way to rebrand.

If you change `--accent-color`, you'll likely also want to update these related variables to match:
- `--dark-accent-color` (darker shade for hover)
- `--h1-color` through `--h6-color`
- `--caption-color` / `--headline-font-color`
- `--icon-color` / `--icon-color-hover` / `--icon-text-color`
- `--button-bg-color` / `--button-bg-color-hover`
- `--secondary-menu-border-color` / `--secondary-menu-bg-color`
- `--today-bg-color` / `--today-border-color`
- `--logo-main-color` / `--logo-text-color`

### Dark mode contrast
When picking custom colors, remember you're on a dark background (`#121212`). Use lighter colors for text and keep enough contrast for readability. The [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) is a good tool.

### Test in multiple MFL reports
MFL has many different report pages (rosters, standings, live scoring, draft, etc.). After making changes, spot-check a few different pages to make sure your overrides look good across the board.

### CSS specificity
Your `<style>` block in a Homepage Message overrides the base CSS because it comes later in the page. If something isn't overriding, make sure you're targeting `:root` — not a class or element selector.

### Homepage Messages are per-league
Your overrides apply to the league where you added the Homepage Message. Different leagues can have different overrides while sharing the same base CSS file.
