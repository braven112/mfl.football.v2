import LvWinProbBar from '../../src/components/shared/live/LvWinProbBar';
import { liveSurfaceModes, themeModes } from '../../.storybook/modes';

/**
 * The shared live-scoring kit's win-probability bar.
 *
 * Snapshotted across every SURFACE, not just light and dark, because this is
 * the component whose colours are resolved against a per-surface card ground:
 * TheLeague's `#262626`, the AFL's `#16283c` and MFL Live's `#1e2126` are three
 * different answers for the same franchise, and the bar is where they show.
 * That is exactly the axis `.storybook/modes.ts` says to spend `leagueModes`
 * on — a component whose own styles read a league-scoped value.
 *
 * The colours arrive as the four custom properties the server resolves
 * (`--t0-light/-dark`, `--t1-light/-dark`); the stylesheet aliases them per
 * theme. The stories set them inline, which is what a real card does.
 */
export default {
  title: 'Live/WinProbBar',
  component: LvWinProbBar,
  parameters: {
    layout: 'padded',
    chromatic: { modes: liveSurfaceModes },
  },
};

/** A card's worth of colour vars, as the assembler ships them. */
const colors = {
  '--t0-light': '#1c497c',
  '--t1-light': '#c41e3a',
  '--t0-dark': '#6f9fd8',
  '--t1-dark': '#ef6d85',
};

const wrap = (args: Record<string, unknown>) => ({
  args,
  decorators: [
    (story: () => unknown) => {
      const el = document.createElement('div');
      el.className = 'lv lv-matchup';
      Object.entries(colors).forEach(([k, v]) => el.style.setProperty(k, v));
      el.appendChild(story() as Node);
      return el;
    },
  ],
});

export const Even = wrap({
  p0: 0.5,
  side0Name: 'Pacific Pigskins',
  side1Name: 'Motor City',
});

export const Lopsided = wrap({
  p0: 0.93,
  side0Name: 'Pacific Pigskins',
  side1Name: 'Motor City',
  side0YetToPlay: 0,
  side1YetToPlay: 4,
});

/** The collapsed-card variant: bar only, no labels. */
export const Mini = {
  ...wrap({ p0: 0.62, side0Name: 'Pacific Pigskins', side1Name: 'Motor City', mini: true }),
  parameters: { chromatic: { modes: themeModes } },
};
