import { createElement } from 'react';
import type { ReactElement } from 'react';
import LvLeaders from '../../src/components/shared/live/LvLeaders';
import { LIVE_LEADERS, LIVE_META } from '../fixtures/live-kit';
import { themeModes } from '../../.storybook/modes';

/**
 * The week's top scorers — teams, then individuals.
 *
 * One story, because one fixture already puts every rendered branch on screen
 * (see `LIVE_LEADERS`): a crest and an initials-only team, "1 to play", a
 * player two franchises both start, one still playing, and an id the identity
 * map does not know — which must read "Player 99999" rather than drop a real
 * performance off the board. The "nothing played yet → render nothing" branch
 * is a blank canvas and is covered by `live-kit-leaves` instead.
 *
 * themeModes: the strip reads no league token.
 */
export default {
  title: 'Live/Leaders',
  component: LvLeaders,
  parameters: {
    // See Trap 8 — a story over a non-`.astro` component must name its renderer.
    renderer: 'react',
    layout: 'padded',
    chromatic: { modes: themeModes },
  },
  decorators: [
    (Story: () => ReactElement) =>
      createElement('div', { className: 'lv', style: { maxWidth: '38rem' } }, createElement(Story)),
  ],
};

export const WeekLeaders = { args: { leaders: LIVE_LEADERS, meta: LIVE_META } };
