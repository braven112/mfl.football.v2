# Site styles — every page in every style

Owner's model (Oct 2026). A league's site is the product of four independent
choices: the **style** (Editorial, Primetime, later more), the **colour theme**
(`src/themes/*.json`), **light/dark**, and the **MFL league** itself. A style
can change more than colour and type — a page may lay itself out differently
in a style — but every page must be buildable in every style.

Decisions:

- The style is chosen league by league (`siteTheme` in `leagues-data.mjs`).
  Today only Archie's is Primetime.
- The style is SITE-WIDE, not per page. Pages may still carry a
  page-specific layout within a style, and a league may have its own pieces
  as needed.
- Type goes with the style. Colour themes carry no fonts.
- Primetime has no editorial borders: no stripe beside a section title, no
  outline on a card.

## How a style reaches a component

1. `TheLeagueLayout` sets `<html data-site-theme="…">` from
   `resolveSiteTheme(slug, Astro.locals.siteThemePreview)`.
2. `src/styles/site-styles/<id>.json` gives each `--style-*` token a value or
   `null`; `scripts/generate-site-styles.mjs` compiles them into
   `src/styles/site-styles.generated.css`, imported by every layout and by
   Storybook.
3. Components write `var(--style-x, <their own value>)`. Editorial is all
   null, so it IS the components' own values.
4. Unstyled `h1`/`h2` pick up the heading tokens from `polish.css` at zero
   specificity.

The contract is `src/config/style-tokens.mjs`. Rules and guards:
`docs/claude/rules/theming-and-assets.md` § "Site styles".

## Phases

1. **Foundation (shipped, #1402).** Token contract, style files, generator,
   `data-site-theme` on every league page, headings and section titles
   tokenized across ~100 blocks, the old `homeStyle` flag folded into
   `siteTheme`, Storybook Style toolbar, guards. TheLeague and the AFL render
   pixel-identically; all of Archie's turns Primetime.
2. **Card shape.** `--style-card-border` and `--style-card-shadow` on ~110
   card, panel and tile blocks. Primetime cards lose their outline and keep
   a soft shadow so they still stand out from the page (owner's call, Oct
   2026). Editorial is unchanged.
3. **Page layouts, by traffic.** Rosters, Live Scoring, Set Lineup, then the
   rest: where Primetime wants a different emphasis, a page-specific layout
   within the style, keyed off the same attribute.
4. **A third style.** The test of the system: adding one is a style file plus
   any page layouts it wants, with no component edits for the token layer.
