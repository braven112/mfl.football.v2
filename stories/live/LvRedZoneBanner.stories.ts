import { createElement } from 'react';
import type { ReactElement } from 'react';
import LvRedZoneBanner from '../../src/components/shared/live/LvRedZoneBanner';
import { RED_ZONE_ALERTS } from '../fixtures/live-kit';
import { themeModes } from '../../.storybook/modes';

/**
 * The red-zone strip: whose players are in a drive inside the 20, right now.
 *
 * Two drives, one with down and distance and one without — ESPN omits it, and
 * absent must read as absent. The banner is never animated beyond a single
 * entrance fade (photosensitivity), so the capture is deterministic.
 */
export default {
  title: 'Live/RedZoneBanner',
  component: LvRedZoneBanner,
  parameters: {
    renderer: 'react',
    layout: 'padded',
    chromatic: { modes: themeModes },
  },
  decorators: [
    (Story: () => ReactElement) =>
      createElement('div', { className: 'lv', style: { maxWidth: '40rem' } }, createElement(Story)),
  ],
};

/** A league board: one league, so no league name on each row. */
export const LeagueBoard = { args: { alerts: RED_ZONE_ALERTS } };

/** The cross-league board, where "your players" span leagues and each row names its own. */
export const CrossLeague = { args: { alerts: RED_ZONE_ALERTS, showLeague: true } };
