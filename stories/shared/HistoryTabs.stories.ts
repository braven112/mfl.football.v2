import HistoryTabs from '../../src/components/shared/league-history/HistoryTabs.astro';
import { themeModes } from '../../.storybook/modes';

/**
 * The League History section tabs (Home, Record Book, Franchises). Unrelated views, so the
 * kit's underline tab bar rather than pills; the current tab carries the
 * accent underline.
 */
export default {
  title: 'Shared/League History/HistoryTabs',
  component: HistoryTabs,
  parameters: { chromatic: { modes: themeModes } },
  args: { leagueSlug: 'theleague' },
};

export const Home = { args: { current: 'home' } };

export const RecordBook = { args: { current: 'record-book' } };

export const Franchises = { args: { current: 'franchises' } };
