import type { StorybookConfig } from '@storybook-astro/framework';
import { react } from '@storybook-astro/framework/integrations';

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
   * `static/nfl-dark` carries the dark NFL logo cuts, and `static/fonts` the
   * ONE font the app does not serve from public/:
   * Vend Sans, which production gets from astro.config.ts's font integration
   * — config Storybook never loads (Trap 4). It is mapped to a distinct
   * /storybook-fonts prefix so it is obvious the file is Storybook's and not
   * the app's, and it stays out of public/ so the shipped Vercel bundle is
   * still byte-identical with or without Storybook. See
   * .storybook/preview-layout-globals.css.
   */
  staticDirs: [
    '../public',
    { from: './static/fonts', to: '/storybook-fonts' },
    /**
     * ESPN's dark NFL logo cuts. Production mirrors these into public/ during
     * prebuild (gitignored); `storybook build` never runs prebuild, so without
     * this committed copy the dark-mode swap fell back to fetching them from
     * a.espncdn.com at capture time and Chromatic failed on CDN weather.
     * See .storybook/nfl-dark-mirror.ts.
     */
    { from: './static/nfl-dark', to: '/storybook-nfl-dark' },
  ],

  /**
   * `options.integrations` is the ONLY place the framework learns which UI
   * frameworks this app renders, and it does NOT read `astro.config.ts` for
   * them. It feeds two things:
   *
   *   - the Astro Container's client/server renderers, so a React island
   *     inside an `.astro` story actually renders; and
   *   - `virtual:storybook-renderer-fallback`, the registry a story consults
   *     when its component is NOT an Astro component.
   *
   * Left empty, that registry is an empty module — and a story over a React
   * component dies at CAPTURE time with
   * `Renderer 'astro' not found. Available renderers:` and nothing after the
   * colon, because there are none. `storybook build` still exits 0, so the
   * only place it shows is Chromatic, as a component ERROR rather than a
   * diff. That is what failed Chromatic build 455 eighteen times once the
   * live-scoring kit added the repo's first React-component story.
   *
   * `react()` here mirrors `integrations: [react()]` in `astro.config.ts`.
   * Adding a framework to one means adding it to the other.
   */
  framework: {
    name: '@storybook-astro/framework',
    options: { integrations: [react()] },
  },
};

export default config;
