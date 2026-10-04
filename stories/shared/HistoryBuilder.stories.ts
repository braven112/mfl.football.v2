import HistoryBuilder from '../../src/components/shared/league-history/HistoryBuilder.astro';
import { allModes } from '../../.storybook/modes';

/**
 * League History's build form (/history). The build loop is a client script
 * that only runs on the site, so the snapshot is the form's resting state.
 */
export default {
  title: 'Shared/League History/HistoryBuilder',
  component: HistoryBuilder,
  parameters: { chromatic: { modes: allModes } },
};

export const SetupForm = { args: {} };
