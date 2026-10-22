import { createElement } from 'react';
import type { ReactElement } from 'react';
import LvHauntedStats from '../../src/components/shared/live/LvHauntedStats';
import { themeModes } from '../../.storybook/modes';

/**
 * The Halloween header's Monster of the Week and Scariest Game cards.
 *
 * Shown over the haunted scene on Live Scoring while the Halloween season is
 * open; the scene itself is page CSS, so these stories set a near-black ground
 * to read the cards as they appear there. One card renders alone when the
 * other has no answer, and nothing renders when neither does.
 */
export default {
  title: 'Live/Haunted Stats',
  component: LvHauntedStats,
  parameters: {
    renderer: 'react',
    layout: 'padded',
    chromatic: { modes: themeModes },
  },
  decorators: [
    (Story: () => ReactElement) =>
      createElement(
        'div',
        { className: 'lv', style: { maxWidth: '38rem', background: '#0a0a0c', padding: '1rem' } },
        createElement(Story),
      ),
  ],
};

export const Both = {
  args: {
    stats: {
      monster: { playerId: '1', name: 'James Cook', points: 20.9, owners: 'Ninjas' },
      scariest: {
        names: ['Pigskins', 'Ninjas'],
        margin: 7,
        yetToPlay: 2,
        final: false,
        leagueId: 'demo',
        pairing: '0001-0002',
      },
    },
    onOpenScariest: () => {},
  },
};

export const ScariestOnlyFinal = {
  args: {
    stats: {
      monster: null,
      scariest: {
        names: ['Dead Cap', 'The Dream'],
        margin: 3.3,
        yetToPlay: 0,
        final: true,
        leagueId: 'demo',
        pairing: '0003-0004',
      },
    },
  },
};

/** The night before kickoff: neither card has an answer yet, so both wait. */
export const BeforeKickoff = {
  args: {
    stats: { monster: null, scariest: null },
    onOpenScariest: () => {},
  },
};
