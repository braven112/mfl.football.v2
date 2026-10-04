import HistoryFixForm from '../../src/components/shared/league-history/HistoryFixForm.astro';
import { allModes } from '../../.storybook/modes';

/**
 * The admin's fix for one season's champion (/history/mfl/<id>). Rendered
 * closed on the site; these show its options and the "fixed" state.
 */
const franchises = [
  { id: '0001', name: 'Croc' },
  { id: '0002', name: 'Demons' },
  { id: '0003', name: 'Griddy' },
];

export default {
  title: 'Shared/League History/HistoryFixForm',
  component: HistoryFixForm,
  parameters: { chromatic: { modes: allModes } },
};

export const Unfixed = {
  args: { leagueId: '54321', year: 2025, franchises, championId: '0001', runnerUpId: '0002', hasOverride: false },
};

export const FixedByAdmin = {
  args: { leagueId: '54321', year: 2025, franchises, championId: '0002', runnerUpId: '0001', hasOverride: true },
};

export const NoTeamsListed = {
  args: { leagueId: '54321', year: 2003, franchises: [], championId: null, runnerUpId: null, hasOverride: false },
};
