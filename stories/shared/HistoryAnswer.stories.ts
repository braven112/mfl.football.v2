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

/** A ranking answer: its Record Book board and the Record Book's own charts. */
export const WithChartAndRecord = {
  args: {
    records: [{ title: 'Fewest points in a season', query: 'cat=season&board=fewest-points-season', leader: '1,402.18 · Witch City Warlocks (Rick O’Keefe) · 2008' }],
    table: {
      ...table,
      chart: {
        field: 'pf',
        label: 'PF',
        asc: true,
        rows: table.rows.map((r, i) => ({
          value: r.cells[5] as number,
          display: (r.cells[5] as number).toLocaleString('en-US', { minimumFractionDigits: 2 }),
          name: r.cells[1] as string,
          owner: r.cells[2] as string,
          context: String(r.year),
          year: r.year,
          rank: i + 1,
          franchiseId: r.franchiseId,
          entity: { key: null },
        })),
        population: [
          [1105.32, 2008, null, 'Witch City Warlocks', null],
          [1125.98, 2019, null, 'Pacific Pigskins', null],
          [1169, 2008, null, 'Bring The Pain', null],
          [1201.4, 2012, null, 'Degenerates', null],
          [1244.9, 2016, null, 'Maverick', null],
          [1288.02, 2023, null, 'Da Dangsters', null],
        ],
      },
    },
  },
};

export const NoData = {
  args: {
    question: 'Who threw the most touchdowns in a playoff game?',
    answer: 'The record has every player\'s fantasy points, not touchdowns, so it cannot answer that one.',
    table: null,
  },
};
