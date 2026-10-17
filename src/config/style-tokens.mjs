/**
 * The site-style contract: every token a site STYLE (src/styles/site-styles/
 * <id>.json) owns. A style is the visual language a league's whole site speaks
 * (Editorial, Primetime); a league picks one with `siteTheme` in the registry.
 * It sits beside, and never overlaps, the league's colour THEME
 * (src/config/theme-tokens.mjs): the theme decides colours, the style decides
 * type, shape and the house furniture (the editorial stripe on a section
 * title, italic broadcast caps on a heading). Type goes with the style.
 *
 * Every style names EVERY token here. `null` means "the component's own
 * value": consumers always write `var(--style-x, <their own value>)`, so a
 * style that leaves a token null renders exactly what the component rendered
 * before the token existed. Editorial is the site's original look, which is
 * why it leaves almost everything null — it IS the components' own values.
 *
 * A token here is declared ONLY by the generated style CSS
 * (src/styles/site-styles.generated.css), on `html[data-site-theme]`, which
 * the layout sets for the whole page. Plan: docs/plans/site-styles.md.
 * Guard: tests/site-styles.test.ts.
 *
 * @type {ReadonlyArray<{ label: string, tokens: ReadonlyArray<{ name: string, use: string }> }>}
 */
export const STYLE_TOKEN_GROUPS = [
  {
    label: 'Headings',
    tokens: [
      { name: '--style-heading-font', use: 'Page and section headings (h1, h2) with no font of their own — polish.css.' },
      { name: '--style-heading-style', use: 'font-style of those headings (italic for broadcast caps).' },
      { name: '--style-heading-transform', use: 'text-transform of those headings.' },
      { name: '--style-heading-tracking', use: 'letter-spacing of those headings.' },
    ],
  },
  {
    label: 'Section titles',
    tokens: [
      { name: '--style-section-rule', use: 'The rule beside a section title (Editorial: the 2px primary stripe). A border-left value.' },
      { name: '--style-section-rule-gap', use: 'padding-left between that rule and the title.' },
      { name: '--style-section-font', use: 'font-family of a section title.' },
      { name: '--style-section-size', use: 'font-size of a section title.' },
      { name: '--style-section-style', use: 'font-style of a section title.' },
      { name: '--style-section-tracking', use: 'letter-spacing of a section title.' },
    ],
  },
];

/** Every style token, flat. */
export const STYLE_TOKENS = STYLE_TOKEN_GROUPS.flatMap((g) => g.tokens.map((t) => t.name));
