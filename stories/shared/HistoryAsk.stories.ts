import HistoryAsk from '../../src/components/shared/league-history/HistoryAsk.astro';
import { getLeagueBySlug } from '../../src/config/leagues';
import { themeModes } from '../../.storybook/modes';

/**
 * Ask the History on the History home: the bar that opens the ask screen,
 * questions to start from, and "The league is asking", this week's most-asked
 * topics. The top topic is a card led by its big stat; the rest are a list
 * with a heat bar for how many owners asked.
 */
const answer = (id: string, question: string, text: string, headline: { value: string; label: string } | null, franchiseId: string) => ({
  id,
  league: 'theleague',
  question,
  answer: text,
  headline,
  table: {
    description: 'Team-seasons',
    total: 1,
    columns: [{ key: 'team', label: 'Team' }],
    rows: [{ cells: ['Team'], franchiseId, ownerSlug: null, year: 2026 }],
    summary: {},
  },
  steps: [],
  askedBy: { franchiseId: '0001', name: null },
  createdAt: '2026-10-26T16:00:00Z',
});

export default {
  title: 'Shared/League History/HistoryAsk',
  component: HistoryAsk,
  parameters: { chromatic: { modes: themeModes } },
  args: {
    league: getLeagueBySlug('theleague'),
    base: '/theleague',
  },
};

/** Before anyone has asked this week or last: the bar and the starters. */
export const NobodyAskingYet = {};

export const TheLeagueIsAsking = {
  args: {
    asking: {
      week: 'this',
      topics: [
        {
          owners: 6,
          answer: answer(
            'a1',
            'Has anyone started 8-1 with fewer points than my Pigskins?',
            'No. The 2026 Pacific Pigskins have the fewest points of any 8-1 start: 952.44.',
            { value: '952.44', label: 'Fewest points by an 8-1 start' },
            '0001',
          ),
        },
        { owners: 4, answer: answer('a2', 'Who has the most titles?', 'Todd Gibel and Jim Kubek, with three each.', { value: '3', label: 'Titles' }, '0008') },
        { owners: 2, answer: answer('a3', 'Biggest blowout ever?', 'The 2015 LBer-DeCleaters won by 125.15.', { value: '125.15', label: 'Margin' }, '0004') },
      ],
    },
  },
};
