import TransactionRecord from '../../src/components/shared/transactions/TransactionRecord.astro';
import { allModes } from '../../.storybook/modes';

/**
 * MFL's official record of one move — what sits under "See details" on a
 * Schefter story card on the Transactions page, and the whole card for a move
 * he never wrote up. Players carry no headshot, so a snapshot makes no
 * network request.
 */
export default {
  title: 'Shared/TransactionRecord',
  component: TransactionRecord,
  parameters: { chromatic: { modes: allModes } },
};

const player = (id: string, name: string, position: string, nflTeam: string) => ({
  id,
  player: { name, position, nflTeam },
});

export const ClaimWithDrop = {
  args: {
    kind: 'blind-bid',
    kindLabel: 'Blind bid',
    added: [player('15001', 'Roschon Johnson', 'RB', 'CHI')],
    dropped: [player('15002', 'Darnell Washington', 'TE', 'PIT')],
    tradeSides: null,
    amount: '$475,000',
    dashTitle: 'Not recorded in the feed',
    byCommish: false,
  },
};

export const Trade = {
  args: {
    kind: 'trade',
    kindLabel: 'Trade',
    added: [],
    dropped: [],
    tradeSides: [
      { name: 'Cowboy Up', players: [player('0511', 'Denver Broncos', 'DEF', 'DEN')], picks: ["Cowboy Up's 2027 3rd"] },
      { name: 'Bring The Pain', players: [player('13718', 'Daniel Carlson', 'PK', 'LVR')], picks: ["Bring The Pain's 2027 2nd"] },
    ],
    amount: undefined,
    dashTitle: '',
    byCommish: false,
  },
};
