import RivalryTrades from '../../src/components/shared/rivalries/RivalryTrades.astro';
import { themeModes } from '../../.storybook/modes';

/**
 * Trades between a rivalry's two franchises, on the League History rivalry
 * page: each deal's date, what each side sent (named as it was that season),
 * and the trade note. Follows the page's view: current owners' deals, or all.
 */
export default {
  title: 'Shared/League History/RivalryTrades',
  component: RivalryTrades,
  parameters: { chromatic: { modes: themeModes } },
};

const teams = [
  { franchiseId: '0001', name: 'Pacific Pigskins', nameShort: 'Pigskins' },
  { franchiseId: '0012', name: 'Vitside Mafia', nameShort: 'Mafia' },
];
const history = {
  playerNames: {
    '13604': { name: 'Davante Adams', position: 'WR', team: 'LV' },
    '14836': { name: 'Josh Allen', position: 'QB', team: 'BUF' },
  },
  franchises: {
    '0001': {
      currentNameShort: 'Pigskins',
      trades: [
        {
          year: 2024,
          timestamp: 1727740800,
          partnerId: '0012',
          gaveUp: ['13604'],
          received: ['14836'],
          comments: 'Win-now move before the deadline.',
          bothAttributed: true,
        },
      ],
    },
    '0012': { currentNameShort: 'Mafia' },
  },
};

export const CurrentOwners = {
  args: { history, teams, a: '0001', b: '0012', ownerOnly: true },
};
