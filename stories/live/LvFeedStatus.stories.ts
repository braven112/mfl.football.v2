import { createElement } from 'react';
import LvFeedStatus from '../../src/components/shared/live/LvFeedStatus';
import { minutesAgo } from '../fixtures/live-kit';
import { themeModes } from '../../.storybook/modes';

/**
 * The freshness pill — the element that proves the page is still working.
 *
 * All four tones in ONE story (two snapshots, not eight): each pill is a few
 * words, and side by side the error tone is visibly the odd one out.
 *
 * DETERMINISM. The pill ticks every second from `Date.now()`, so its fixture
 * ages are whole minutes plus thirty seconds (`minutesAgo`) — "3m ago" cannot
 * roll over between the story loading and the capture. "Connecting" has no age
 * at all: nothing has landed yet.
 */
export default {
  title: 'Live/FeedStatus',
  component: LvFeedStatus,
  parameters: {
    renderer: 'react',
    layout: 'padded',
    chromatic: { modes: themeModes },
  },
};

export const AllTones = {
  render: () => {
    const landed = minutesAgo(3.5);
    return createElement(
      'div',
      { className: 'lv', style: { display: 'grid', gap: '0.75rem', justifyItems: 'start' } },
      // Live: a real NFL game in progress, the feed answered 3 minutes ago.
      createElement(LvFeedStatus, { feeds: [{ status: 'ok', fetchedAt: landed }], anyLive: true, gamesLive: 2 }),
      // Tracking: the feed is fine, nothing is being played.
      createElement(LvFeedStatus, { feeds: [{ status: 'ok', fetchedAt: landed }], anyLive: false, gamesLive: 0 }),
      // Reconnecting: the last poll failed — the age is the last GOOD poll's.
      createElement(LvFeedStatus, {
        feeds: [{ status: 'error', fetchedAt: landed }, { status: 'ok', fetchedAt: minutesAgo(5.5) }],
        anyLive: true,
        gamesLive: 1,
      }),
      // Connecting: nothing has landed yet, so there is no age to show.
      createElement(LvFeedStatus, { feeds: [{ status: 'loading', fetchedAt: 0 }], anyLive: false, gamesLive: 0 }),
    );
  },
};
