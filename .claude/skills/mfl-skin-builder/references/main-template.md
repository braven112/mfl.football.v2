# Main Entry File Template

The main SCSS entry file (`{name}_main.scss`) imports fonts, reset, design tokens, then all component partials, and finally the skin's globals override at the very end.

**CRITICAL:** The skin's globals file (`_globals-{name}.scss`) MUST be the LAST `@use` in the main entry. This is because all component partials internally load `_globals.scss` → `_variables.scss` (TheLeague defaults), which outputs the default `:root` block. The skin's globals file outputs a second `:root` block with the custom values. CSS cascade means the LAST `:root` wins, so the skin values override the defaults.

---

## Template

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

//// Skin override (MUST be last — CSS cascade makes these :root values win over defaults)
@use "./globals-{name}";
```

---

## Notes

- The `@use "./fonts-{name}"` line references the skin-specific fonts file (`_fonts-{name}.scss`)
- The `_history` partial is commented out in all existing skins — keep it commented
- The `_theleague` partial contains shared component styles used by all skins (not TheLeague-specific despite the name)
- All other partials are shared across all skins and must be included
- Entry files must NOT start with an underscore — the build script (`scripts/build-themes.js`) skips files starting with `_`
- The build script compiles all non-underscore `.scss` files in `src/assets/css/src/` to `public/assets/css/dist/`

---

## Globals File Template

The globals file (`_globals-{name}.scss`) forwards the variables and adds roster-page tokens:

```scss
@forward "color-helpers";
@forward "variables-{name}";  // Use {name} variables

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

---

## Fonts File Template

The fonts file (`_fonts-{name}.scss`) imports Google Fonts:

```scss
@import url('https://fonts.googleapis.com/css2?family={HeadlineFont}:wght@400..900&family={BodyFont}:wght@300..900&display=swap');
```

**Google Fonts URL format notes:**
- Replace spaces in font names with `+` (e.g., `Roboto+Slab`)
- Variable-weight fonts use `wght@{min}..{max}` syntax
- Non-variable fonts list individual weights: `wght@300;400;700`
- The `display=swap` parameter ensures text is visible while fonts load
- Some fonts support italic: add `ital,wght@0,300..900;1,300..900`
- Check the Google Fonts website to confirm the correct URL format for each font
