import { createElement } from 'react';
import type { ReactElement } from 'react';
import LvHauntedScene from '../../src/components/shared/live/LvHauntedScene';
import { themeModes } from '../../.storybook/modes';

/**
 * The Halloween header's haunted house stirring: its glow swells and fades and
 * its windows flicker each time a score on the board changes.
 *
 * On Live Scoring this layer sits over the header's haunted-house background,
 * so the story draws the same background under it. Change `pulse` in the
 * controls to replay the animation, as a score change does on the board.
 */
export default {
  title: 'Live/Haunted Scene',
  component: LvHauntedScene,
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
              "#0a0a0c url('/assets/seasonal/halloween/haunted-house.svg') right bottom / auto 100% no-repeat",
          },
        },
        createElement(Story),
      ),
  ],
};

export const ScoreChange = {
  args: { pulse: '42.5,38.1' },
};
