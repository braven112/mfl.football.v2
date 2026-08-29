import type { StorybookConfig } from '@storybook-astro/framework';

/**
 * Storybook lives entirely outside the shipped app.
 *
 * Stories are kept in the top-level `stories/` directory rather than beside
 * their components ON PURPOSE — three repo guards scan `src/` and would
 * otherwise fail on story fixtures:
 *
 *   - tests/league-literal-guard.test.ts  (scans src/ + scripts/ + workflows/
 *     for '13522' / '19621' / 'data/theleague' — story fixtures use franchise
 *     and league ids freely)
 *   - tests/design-token-guard.test.ts    (scans all of src/ for var(--x)
 *     references with no definition)
 *   - pnpm test:types                     (ratchets the `astro check` error
 *     total at a fixed number and fails if it moves in EITHER direction)
 *
 * Keeping stories out of src/ means none of those baselines move.
 */
const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.@(ts|tsx)'],

  /**
   * MCP server for agents, served at /mcp by the DEV server only (it does not
   * change the static build — same 52 entries with it on or off).
   *
   * Only the `dev` toolset registers here: `docs` needs a component-manifest
   * generator, which the Astro framework does not ship, and `test` needs
   * @storybook/addon-vitest. See docs/claude/rules/storybook.md for the tool
   * list and for the one thing that will mislead you — `get-stories-by-component`
   * does NOT traverse .astro frontmatter imports, so a util or stylesheet that
   * many stories depend on comes back "no stories found".
   */
  addons: ['@storybook/addon-mcp'],

  /**
   * Franchise crests, team icons and the self-hosted UFC Sans faces are
   * referenced by absolute path (/assets/...) exactly as the app serves them
   * from public/.
   *
   * `static/fonts` carries the ONE font the app does not serve from public/:
   * Vend Sans, which production gets from astro.config.ts's font integration
   * — config Storybook never loads (Trap 4). It is mapped to a distinct
   * /storybook-fonts prefix so it is obvious the file is Storybook's and not
   * the app's, and it stays out of public/ so the shipped Vercel bundle is
   * still byte-identical with or without Storybook. See
   * .storybook/preview-layout-globals.css.
   */
  staticDirs: ['../public', { from: './static/fonts', to: '/storybook-fonts' }],

  framework: {
    name: '@storybook-astro/framework',
    options: {},
  },
};

export default config;
