import { createElement } from 'react';
import type { ReactElement } from 'react';
import LvCabinScene from '../../src/components/shared/live/LvCabinScene';
import { themeModes } from '../../.storybook/modes';

/**
 * The Christmas Week header's snowed-in cabin stirring: snow falls all the
 * time, and each time a score on the board changes the glow swells, the
 * windows flicker and the chimney puffs.
 *
 * On Live Scoring this layer sits over the header's cabin background, so the
 * story draws the same background under it. Change `pulse` in the controls to
 * replay the animation, as a score change does on the board.
 */
export default {
  title: 'Live/Cabin Scene',
  component: LvCabinScene,
  parameters: {
    renderer: 'react',
    layout: 'fullscreen',
    chromatic: { modes: themeModes },
  },
  decorators: [
    (Story: () => ReactElement) =>
      createElement(
        'div',
        {
          style: {
            position: 'relative',
            height: '10rem',
            background:
              "#0d1424 url('/assets/seasonal/christmas/snowed-in-cabin.svg') right bottom / auto 100% no-repeat",
          },
        },
        createElement(Story),
      ),
  ],
};

export const ScoreChange = {
  args: { pulse: '42.5,38.1' },
};
