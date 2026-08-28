import { definePreview } from '@storybook-astro/framework';
import { themeModes } from './modes';

// Global stylesheets the real app loads from TheLeagueLayout. Tokens first —
// everything else resolves var(--*) against them.
import '../src/styles/tokens.css';
import '../src/styles/tokens-dark.css';
import '../src/styles/utilities.css';

/**
 * Component stylesheets MUST be imported here, not relied upon from the
 * component.
 *
 * Two separate reasons, and both bite silently:
 *
 *  1. Some components never import their own CSS — the page does. The playoff
 *     heroes say so in their own header comments ("loaded once by
 *     SeasonDailyHero").
 *  2. Components that DO import their CSS in frontmatter (the loading tier
 *     does: `import '../../../styles/loading.css'`) still don't get it. The
 *     story module bundled for the canvas carries only a component marker, not
 *     the component's real module graph, so the frontmatter CSS import never
 *     reaches the browser. The story renders unstyled — correct DOM, no rules
 *     — which looks like a broken component rather than a missing stylesheet.
 *
 * Rule of thumb: if a story looks unstyled, add its stylesheet here.
 */
import '../src/styles/playoff-round-hero.css';
import '../src/styles/loading.css';

/**
 * Theme and league are BOTH pure CSS in this codebase:
 *
 *   - light/dark  -> `html.dark`                 (src/styles/tokens-dark.css)
 *   - league skin -> `html[data-league="..."]`   (src/styles/tokens.css:703)
 *
 * Nothing is decided in frontmatter, which is why a story pre-rendered once
 * still re-skins correctly across all four combinations — and why these map
 * cleanly onto Chromatic modes later.
 *
 * The SSR guard below is LOAD-BEARING, not defensive. `.astro` stories are
 * pre-rendered at build time in Node (the Container API), and decorators are
 * composed during that pass. An unguarded `document` reference throws there,
 * and storybook-astro's response is to DROP the story from the static build —
 * while the build still exits 0. That reaches Chromatic as "no snapshots"
 * rather than as an error. Skipping the DOM work during prerender is correct
 * anyway: theme and league are applied to <html> by CSS at view time, in the
 * browser, where this function actually runs.
 */
function applyGlobals(theme: string, league: string) {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.classList.toggle('dark', theme === 'dark');
  html.setAttribute('data-league', league);
}

const preview = definePreview({
  globalTypes: {
    theme: {
      description: 'Color theme (html.dark)',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
    league: {
      description: 'League skin (html[data-league])',
      defaultValue: 'theleague',
      toolbar: {
        title: 'League',
        icon: 'globe',
        items: [
          { value: 'theleague', title: 'TheLeague' },
          { value: 'afl', title: 'AFL' },
          { value: 'bb1', title: 'Best Ball' },
        ],
        dynamicTitle: true,
      },
    },
  },

  decorators: [
    (story, context) => {
      applyGlobals(
        String(context.globals.theme ?? 'light'),
        String(context.globals.league ?? 'theleague'),
      );
      return story();
    },
  ],

  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/ } },
    backgrounds: { disable: true },

    // Overview is the landing page and is pinned first; everything else keeps
    // its natural (alphabetical) order.
    options: {
      storySort: { order: ['Overview', '*'] },
    },

    chromatic: {
      // Every story is snapshotted light + dark. Cross-league components opt
      // into the AFL modes at the component level — see .storybook/modes.ts
      // for the snapshot-budget reasoning.
      modes: themeModes,

      // External ESPN headshots load in the playoff heroes. Chromatic waits for
      // network idle, but a small settle beat keeps a slow CDN response from
      // being captured mid-load as a false diff.
      delay: 300,
    },
  },
});

export default preview;
