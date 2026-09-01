import { definePreview } from '@storybook-astro/framework';
import { themeModes } from './modes';
import { buildTeamAccentCss } from '../src/utils/team-accent-css';
import { buildNflLogoDarkCss } from '../src/utils/nfl-logo-dark-css';
import { buildCollegeLogoDarkCss } from '../src/utils/college-logo-dark-css';
import { buildAllTeamIconDarkCss } from '../src/utils/team-icon-dark-styles';

// Global stylesheets the real app loads from TheLeagueLayout. Tokens first —
// everything else resolves var(--*) against them.
import '../src/styles/tokens.css';
import '../src/styles/tokens-dark.css';
import '../src/styles/utilities.css';

/**
 * The global rules TheLeagueLayout owns, which a story never gets: the fonts
 * plus everything that applies them (html/body font-family, the h1-h4
 * --font-display rule, code, links). Storybook loads neither astro.config.ts
 * (so `--font-vend-sans` never exists) nor the layout's <style> block (so
 * nothing applied --font-family-base or --font-display in the first place),
 * which left every story rendering in Times New Roman with zero web fonts
 * loaded and every anchor on the UA default blue. See the file header.
 */
import './preview-layout-globals.css';

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
import '../src/styles/player-cell.css';
import '../src/styles/player-modal-band.css';
import '../src/styles/player-news.css';
import '../src/styles/theme-image.css';

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

/**
 * Head-injected layout styles — the layout's job in production, ours here.
 *
 * `TheLeagueLayout` renders four style components into <head>, and a story gets
 * NONE of them. All four are plain builder functions with no Node
 * dependencies, so we call the SAME functions the layout does and there is one
 * source of truth per sheet.
 *
 * `TheLeagueLayout` renders `<TeamAccentStyles />`, which defines
 * `--team-accent-<franchiseId>` for every franchise in every league with an
 * `html.dark` override, each forced to clear 3:1 on its theme's card surface.
 * Storybook renders components WITHOUT that layout, so every one of those
 * tokens was undefined and anything tinting by franchise silently fell back to
 * one flat blue. Baselining that fallback would bake wrong colors into
 * Chromatic and make it blind to exactly the accent regressions it exists to
 * catch (see docs/claude/rules/theming-and-assets.md for the dark-mode case
 * that shipped invisible rank numbers).
 *
 * NOTE no story currently reads these tokens — the one that did
 * (Shared/PeckingOrderIssue) was removed, because it rendered live franchise
 * crests and so re-diffed every time an owner changed a logo. The injection
 * stays: it is layout parity, it costs nothing while nothing consumes it, and
 * the next franchise-tinted story would otherwise re-open the same hole.
 *
 * The logo sheets matter for a second, less obvious reason. They carry
 * `img.nfl-logo-failed { visibility: hidden; }`, the rule that hides a logo
 * whose src never resolved. Without it, every `src=""` placeholder the client
 * script fills on open renders as a BROKEN IMAGE ICON — which would have been
 * baselined into the PlayerDetailsModal snapshots as permanent noise.
 *
 * `TeamIconDarkStyles` was the one gap here, and it is now closed the way the
 * gap note said it had to be. Its rules were not a zero-argument builder but a
 * COMPOSITION — four builder calls across both leagues' configs and two icon
 * directories — so reproducing it inline was the drift risk these shared
 * builders exist to avoid. The composition moved to
 * `src/utils/team-icon-dark-styles.ts`, which the layout component and this
 * file both call. Until then every franchise crest rendered its LIGHT artwork
 * in dark-mode stories: 51 rules and ~7.4 KB of swap-and-stroke CSS missing,
 * covering 11 of TheLeague's 16 franchises and 10 of the AFL's 24.
 *
 * Injected once, client-side only — the SSR prerender pass has no document.
 */
function injectLayoutStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('sb-layout-styles')) return;
  const el = document.createElement('style');
  el.id = 'sb-layout-styles';
  el.textContent = [
    buildTeamAccentCss(),
    buildNflLogoDarkCss(),
    buildCollegeLogoDarkCss(),
    buildAllTeamIconDarkCss(),
  ].join('\n');
  document.head.appendChild(el);
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
      injectLayoutStyles();
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

      // A short settle beat before capture. The fixtures are fully offline
      // (headshots are inline data URIs, crests come from staticDirs), so this
      // is only covering font application and layout settle, not a network
      // round trip.
      delay: 300,
    },
  },
});

export default preview;
