import MyTeamThisWeek from '../../src/components/shared/hp-sections/MyTeamThisWeek.astro';
import { themeModes, leagueModes } from '../../.storybook/modes';

/**
 * The homepage My Team card in season — shared by TheLeague and the AFL.
 *
 * The lineup line has four states and only three of them render: `set`,
 * `not-set`, and `set` with problems. `unknown` (MFL could not be read) shows
 * NO line at all, on purpose — a failed read must never be shown as "not set"
 * (docs/claude/rules/lineups.md). The Set Lineup shortcut turns primary
 * exactly when the line asks for work.
 */
export default {
  title: 'Shared/MyTeamThisWeek',
  component: MyTeamThisWeek,
  parameters: { chromatic: { modes: themeModes } },
};

const capTile = { label: 'Cap Space', value: '$9.1M', sub: '80% used', href: '#', icon: 'banknote' };
const week = {
  week: 5,
  games: [{ opponentId: '0012', isHome: true }],
  record: { wins: 2, losses: 5, ties: 0 },
  pointsFor: 393.7,
};

export const LineupSet = {
  args: {
    leagueSlug: 'theleague',
    teamName: 'Computer Jocks',
    data: { ...week, lineup: { state: 'set', problems: [], emptySlots: 0 } },
    rosterCount: 20,
    rosterLimit: 22,
    extraTile: capTile,
  },
};

export const NeedsAttention = {
  args: {
    ...LineupSet.args,
    data: {
      ...week,
      lineup: {
        state: 'set',
        problems: [
          { playerId: '1', name: 'Tetairoa McMillan', position: 'WR', type: 'BYE' },
          { playerId: '2', name: 'JaMarr Chase', position: 'WR', type: 'OUT' },
        ],
        emptySlots: 1,
      },
    },
  },
};

export const NotSet = {
  args: { ...LineupSet.args, data: { ...week, lineup: { state: 'not-set', problems: [], emptySlots: 0 } } },
};

/** A doubleheader week names both opponents; a browsing non-owner sees no lineup line. */
export const DoubleheaderNotOwner = {
  args: {
    ...LineupSet.args,
    data: { ...week, games: [{ opponentId: '0012', isHome: true }, { opponentId: '0003', isHome: false }], lineup: null },
  },
};

export const Afl = {
  args: {
    leagueSlug: 'afl-fantasy',
    teamName: 'Smokane FC',
    data: { ...week, games: [{ opponentId: '0018', isHome: false }], record: { wins: 5, losses: 1, ties: 0 }, pointsFor: 593.3, lineup: { state: 'set', problems: [], emptySlots: 0 } },
    rosterCount: 17,
    rosterLimit: 28,
    extraTile: { label: 'Tier', value: 'Premier', sub: 'American League conf.', href: '#', icon: 'trophy' },
  },
  parameters: { chromatic: { modes: leagueModes } },
};
