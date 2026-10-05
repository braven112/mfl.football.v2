import { createElement } from 'react';
import type { ReactElement } from 'react';
import LvWeekPicker from '../../src/components/shared/live/LvWeekPicker';
import { themeModes } from '../../.storybook/modes';

/**
 * The board's week selector. It navigates rather than fetches (`?week=` is the
 * single source of which week is on screen); `onSelect` is the hook a story
 * uses so choosing a week does not navigate the canvas away.
 *
 * The ceiling is the NFL REGULAR season (18), not `MAX_WEEK` (22): MFL has no
 * fantasy matchup for an NFL playoff week, so those options would each open
 * an empty board.
 */
export default {
  title: 'Live/WeekPicker',
  component: LvWeekPicker,
  parameters: {
    renderer: 'react',
    layout: 'padded',
    chromatic: { modes: themeModes },
  },
  decorators: [
    (Story: () => ReactElement) => createElement('div', { className: 'lv' }, createElement(Story)),
  ],
};

export const MidSeason = { args: { week: 7, onSelect: () => {} } };
