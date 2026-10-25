import HistoryAnswer from '../../src/components/shared/league-history/HistoryAnswer.astro';
import { themeModes } from '../../.storybook/modes';

/**
 * One Ask the History answer: the answer in words, the rows our engine
 * computed, and the receipt of exactly what was counted. On phones the table
 * becomes one labeled card per row.
 */
const table = {
  description: 'Team-seasons, first 10 regular-season games, where W = 9 and L = 1, sorted by PF (lowest first)',
  total: 10,
  columns: [
    { key: 'year', label: 'Season' },
    { key: 'team', label: 'Team' },
    { key: 'owner', label: 'Owner' },
    { key: 'w', label: 'W' },
    { key: 'l', label: 'L' },
    { key: 'pf', label: 'PF' },
    { key: 'finish', label: 'Finish' },
  ],
  rows: [
    { cells: [2008, 'Witch City Warlocks', 'Rick O’Keefe', 9, 1, 1105.32, 'Playoffs'], franchiseId: '0010', ownerSlug: null, year: 2008 },
    { cells: [2019, 'Pacific Pigskins', 'Brandon Shields', 9, 1, 1125.98, 'Playoffs'], franchiseId: '0001', ownerSlug: null, year: 2019 },
    { cells: [2008, 'Bring The Pain', 'Todd Gibel', 9, 1, 1169, 'Runner-up'], franchiseId: '0008', ownerSlug: null, year: 2008 },
  ],
  summary: {},
};

export default {
  title: 'Shared/League History/HistoryAnswer',
  component: HistoryAnswer,
  parameters: { chromatic: { modes: themeModes } },
  args: {
    question: 'Has a team ever started 9-1 with fewer total points?',
    answer:
      'Yes. Ten teams have started 9-1, and the 2008 Witch City Warlocks did it with the fewest points: 1,105.32 through ten games.',
    table,
    base: '/theleague',
  },
};

export const WithTable = {};

export const NoData = {
  args: {
    question: 'Who threw the most touchdowns in a playoff game?',
    answer: 'The history record has team scores, not player stats, so it cannot answer that one yet.',
    table: null,
  },
};
