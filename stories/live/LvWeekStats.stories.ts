import { createElement } from 'react';
import type { ReactElement } from 'react';
import LvWeekStats from '../../src/components/shared/live/LvWeekStats';
import { themeModes } from '../../.storybook/modes';

/**
 * The Live Scoring header's two stat cards: Player of the Week and Nail-Biter
 * year-round, renamed by a seasonal theme (`season`): Halloween's Monster of
 * the Week and Scariest Game, Christmas's Star of the Week and Naughty or Nice.
 * The year-round cards use the board's own card tokens; the seasonal re-skin
 * is page CSS keyed on <html data-season>, so the seasonal stories only show
 * the names. A card with no answer yet renders waiting rather than vanishing.
 */
export default {
  title: 'Live/Week Stats',
  component: LvWeekStats,
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

const both = {
  star: { playerId: '1', name: 'James Cook', points: 20.9, owners: 'Ninjas' },
  closest: {
    names: ['Pigskins', 'Ninjas'] as [string, string],
    margin: 7,
    yetToPlay: 2,
    final: false,
    leagueId: 'demo',
    pairing: '0001-0002',
  },
};

export const Both = {
  args: { stats: both, onOpenClosest: () => {} },
};

export const ClosestOnlyFinal = {
  args: {
    stats: {
      star: null,
      closest: {
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
    stats: { star: null, closest: null },
    onOpenClosest: () => {},
  },
};

export const HalloweenNames = {
  args: { stats: both, season: 'halloween', onOpenClosest: () => {} },
};

export const ChristmasNames = {
  args: { stats: both, season: 'christmas', onOpenClosest: () => {} },
};
