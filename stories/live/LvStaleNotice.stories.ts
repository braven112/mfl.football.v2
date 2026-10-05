import { createElement } from 'react';
import type { ReactElement } from 'react';
import LvStaleNotice from '../../src/components/shared/live/LvStaleNotice';
import { minutesAgo } from '../fixtures/live-kit';
import { themeModes } from '../../.storybook/modes';

/**
 * "These scores are the last ones we could confirm."
 *
 * The strip that makes a held panel honest — without it a stale panel looks
 * exactly like a live one. It ticks every second, so the fixture age is two
 * and a half minutes: "2m ago" holds for thirty seconds either side of the
 * capture.
 */
export default {
  title: 'Live/StaleNotice',
  component: LvStaleNotice,
  parameters: {
    renderer: 'react',
    layout: 'padded',
    chromatic: { modes: themeModes },
  },
  decorators: [
    (Story: () => ReactElement) =>
      createElement('div', { className: 'lv', style: { maxWidth: '38rem' } }, createElement(Story)),
  ],
};

export const Held = { args: { heldSince: minutesAgo(2.5) } };
