/**
 * The theme contract — every token a league theme (src/themes/<id>.json)
 * owns. A theme must name EVERY token here in both `light` and `dark`, so a
 * league's palette can never be half-defined and fall back to another
 * league's colors (the missing-token trap in
 * docs/claude/rules/theming-and-assets.md). `null` is an explicit "this theme
 * leaves it unset" and is emitted as nothing.
 *
 * A token listed here is declared ONLY by the generated theme CSS
 * (src/styles/league-themes.generated.css) — never in tokens.css /
 * tokens-dark.css, which hold the shared, un-themed defaults.
 *
 * Phase 1 (docs/plans/league-themes.md) seeded this list with exactly the
 * tokens some league overrode before themes existed, Archie's palette layer
 * included. It grows as more of the palette moves into themes.
 * Guard: tests/league-themes.test.ts.
 */
/**
 * The contract in sections, in the order the theme review page shows them.
 * @type {ReadonlyArray<{ label: string, tokens: readonly string[] }>}
 */
export const THEME_TOKEN_GROUPS = [
  {
    label: 'Surfaces',
    tokens: [
      '--card-bg',
      '--card-border',
      '--card-surface',
      '--color-surface-1',
      '--color-surface-2',
      '--color-surface-3',
      '--content-bg',
      '--content-bg-accent',
      '--content-bg-muted',
      '--input-bg',
      '--inverse-bg',
      '--page-bg',
      '--table-border',
      '--table-header-bg',
      '--table-row-bg',
      '--table-row-bg-alt',
      '--table-row-bg-hover',
    ],
  },
  {
    label: 'Text',
    tokens: [
      '--accent-content-text-color',
      '--color-text-primary',
      '--color-text-secondary',
      '--content-text-muted',
      '--input-placeholder',
      '--input-text',
      '--page-text',
    ],
  },
  {
    label: 'Borders',
    tokens: [
      '--color-border-default',
      '--color-border-subtle',
      '--content-border',
      '--content-border-color',
      '--input-border',
    ],
  },
  {
    label: 'Neutral ramp',
    tokens: [
      '--color-gray-100',
      '--color-gray-200',
      '--color-gray-300',
      '--color-gray-400',
      '--color-gray-50',
      '--color-gray-500',
      '--color-gray-600',
      '--color-gray-700',
      '--color-gray-800',
      '--color-gray-900',
    ],
  },
  {
    label: 'Primary and buttons',
    tokens: [
      '--btn-icon-text-focus',
      '--btn-primary-bg',
      '--btn-primary-bg-hover',
      '--btn-primary-border',
      '--btn-primary-border-hover',
      '--btn-primary-text',
      '--color-primary',
      '--color-primary-dark',
      '--color-primary-light',
      '--color-primary-fill',
      '--input-border-focus',
      '--on-color-primary',
      '--shadow-btn-hover',
      '--shadow-focus-ring',
    ],
  },
  {
    label: 'Call to action',  // the shared .cta fill (src/styles/cta.css)
    tokens: [
      '--cta-fill',
      '--cta-fill-hover',
      '--on-cta-fill',
    ],
  },
  {
    label: 'Secondary',
    tokens: [
      '--btn-secondary-bg',
      '--btn-secondary-bg-hover',
      '--btn-secondary-text',
      '--color-secondary',
      '--color-secondary-dark',
      '--color-secondary-light',
    ],
  },
  {
    label: 'Accent and links',
    tokens: [
      '--color-accent',
      '--league-accent',
      '--league-accent-fg',
      '--link-color',
      '--link-color-accent',
      '--link-color-accent-hover',
      '--link-color-focus',
      '--link-color-hover',
      '--on-league-accent',
      '--league-accent-hover',
      '--on-color-accent',
    ],
  },
  {
    label: 'Header, breadcrumb strip and wordmark',
    tokens: [
      '--breadcrumb-bar-bg',
      '--breadcrumb-bar-border',
      '--header-nav-icon-color',
      '--header-nav-icon-hover-color',
      '--header-nav-label-color',
      '--header-nav-label-hover-color',
      '--logo-name-primary-color',
      '--logo-secondary-color',
    ],
  },
  {
    // The hero vocabulary every shared hero reads. Null --hero-gradient /
    // --hero-highlight / --hero-pill-* / --hero-cta-ink keep the composite
    // hero's per-variant defaults (TheLeague's blue ramp).
    label: 'Heroes',
    tokens: [
      '--hero-ink',
      '--hero-surface',
      '--hero-accent',
      '--hero-glow',
      '--hero-urgent',
      '--hero-gradient',
      '--hero-anchor',
      '--hero-highlight',
      '--hero-pill-bg',
      '--hero-pill-border',
      '--hero-cta-ink',
      '--hero-action',
      '--on-hero-action',
    ],
  },
  {
    label: 'Text selection',
    tokens: [
      '--selection-bg',
      '--selection-text',
    ],
  },
  {
    label: 'Side nav',
    tokens: [
      '--nav-active-bg',
      '--nav-active-text',
      '--nav-bg',
      '--nav-bg-subtle',
      '--nav-border',
      '--nav-border-subtle',
      '--nav-focus-ring',
      '--nav-footer-bg',
      '--nav-footer-border',
      '--nav-hover-bg',
      '--nav-scrollbar-thumb',
      '--nav-scrollbar-thumb-hover',
      '--nav-switcher-bg',
      '--nav-text',
      '--nav-text-muted',
      '--nav-verify-bg',
      '--nav-verify-border',
      '--nav-verify-hover-bg',
      '--nav-verify-text',
    ],
  },
  {
    label: 'Badges',
    tokens: [
      '--badge-info-bg',
      '--badge-info-text',
    ],
  },
  {
    label: 'Content box tints',
    tokens: [
      '--accent-content-bg-color',
      '--accent-content-border-color',
      '--primary-content-boxshadow-color',
    ],
  },
  {
    label: 'Shared cards that read a league color',
    tokens: [
      '--league-mini-hero-surface',
      '--league-phase-regular-season',
      '--league-selected-fill',
      '--league-stat-fill',
      '--on-league-phase-regular-season',
      '--on-league-stat-fill',
    ],
  },
  {
    label: 'Raw palette',  // league-named; renamed to roles in phase 2
    tokens: [
      '--afl-gold',
      '--afl-gold-text',
      '--afl-navy',
      '--afl-trophy-gold',
      '--afl-trophy-gold-light',
      '--bb-green',
      '--league-palette-accent',
      '--league-palette-accent-soft',
      '--league-palette-ink',
      '--league-palette-ink-raised',
      '--league-palette-line',
      '--league-palette-on-accent',
      '--league-palette-on-ink',
      '--league-palette-text-faint',
      '--league-palette-text-muted',
      '--mfl-ink',
      '--mfl-ink-deep',
    ],
  },
];

/** Every themed token, flat. */
export const THEMED_TOKENS = THEME_TOKEN_GROUPS.flatMap((g) => g.tokens);
