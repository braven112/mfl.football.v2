import { createElement } from 'react';
import type { ReactElement } from 'react';
import LvWinProbBar from '../../src/components/shared/live/LvWinProbBar';
import { liveSurfaceModes, themeModes } from '../../.storybook/modes';

/**
 * The shared live-scoring kit's win-probability bar.
 *
 * ── THE ONE THING THAT MAKES THIS STORY DIFFERENT ─────────────────────────
 * Every other story in `stories/` renders an `.astro` component. This is the
 * first over a REACT component, and that changes two mechanical things:
 *
 *  1. `parameters.renderer` must name `react`. `@storybook-astro/renderer`'s
 *     `render()` looks for an `isAstroComponentFactory` marker, finds none on
 *     a plain function component, and falls through to the renderer named in
 *     parameters — which the framework's preview sets to `'astro'` globally.
 *     There is no `astro` entry in the fallback registry (the registry is
 *     built from the Astro integrations, so ours holds exactly `react`), so
 *     the story throws `Renderer 'astro' not found` at CAPTURE time. Storybook
 *     still builds and still exits 0; only Chromatic sees it, as a component
 *     error rather than a diff. That is what failed build 455, 18 times.
 *  2. A decorator must return a REACT ELEMENT, not a DOM node. Building the
 *     wrapper with `document.createElement` is also the trap `preview.ts`
 *     documents at length: decorators are composed during the Node prerender
 *     pass, where `document` does not exist.
 *
 * ── WHY ALL SIX SURFACES ──────────────────────────────────────────────────
 * This is the component whose colours are resolved against a per-surface card
 * ground: TheLeague's `#262626`, the AFL's `#16283c` and MFL Live's `#1e2126`
 * are three different answers for the same franchise, and the bar is where
 * they show. That is exactly the axis `.storybook/modes.ts` says to spend
 * league modes on — a component whose own styles read a league-scoped value.
 *
 * The colours arrive as the four custom properties the server resolves
 * (`--t0-light/-dark`, `--t1-light/-dark`); the stylesheet aliases them per
 * theme. The stories set them inline, which is what a real card does.
 *
 * ── MODES WIDEN, THEY NEVER NARROW ────────────────────────────────────────
 * Storybook DEEP-MERGES parameters, so a story-level `modes` map is unioned
 * with the component-level one rather than replacing it. The default here is
 * therefore the CHEAP one (`themeModes`, 2 snapshots) and the stories that
 * genuinely need every ground opt UP to `liveSurfaceModes`. Written the other
 * way round, `Mini`'s attempt to drop back to two silently still cost six.
 */
export default {
  title: 'Live/WinProbBar',
  component: LvWinProbBar,
  parameters: {
    // Load-bearing: see the header. Without it every snapshot errors.
    renderer: 'react',
    layout: 'padded',
    chromatic: { modes: themeModes },
  },
};

/** A card's worth of colour vars, as the assembler ships them. */
const colors: Record<string, string> = {
  '--t0-light': '#1c497c',
  '--t1-light': '#c41e3a',
  '--t0-dark': '#6f9fd8',
  '--t1-dark': '#ef6d85',
};

/**
 * The matchup wrapper a real card provides: `.lv` for the tone tokens and
 * `.lv-matchup` for the per-theme `--t0` / `--t1` aliasing. React passes
 * custom properties through `style` unchanged.
 */
const wrap = (args: Record<string, unknown>, modes?: Record<string, unknown>) => ({
  args,
  ...(modes ? { parameters: { chromatic: { modes } } } : {}),
  decorators: [
    (Story: () => ReactElement) =>
      createElement(
        'div',
        { className: 'lv lv-matchup', style: colors },
        createElement(Story),
      ),
  ],
});

/** The even split — the seam sits dead centre and both labels read 50%. */
export const Even = wrap(
  { p0: 0.5, side0Name: 'Pacific Pigskins', side1Name: 'Motor City' },
  liveSurfaceModes,
);

/** A blowout with the yet-to-play counts folded into the labels. */
export const Lopsided = wrap(
  {
    p0: 0.93,
    side0Name: 'Pacific Pigskins',
    side1Name: 'Motor City',
    side0YetToPlay: 0,
    side1YetToPlay: 4,
  },
  liveSurfaceModes,
);

/**
 * The collapsed-card variant: bar only, no labels. Two modes — the mini bar
 * carries the same colours as the full one, so the extra grounds buy nothing
 * the two stories above do not already cover.
 */
export const Mini = wrap({
  p0: 0.62,
  side0Name: 'Pacific Pigskins',
  side1Name: 'Motor City',
  mini: true,
});
