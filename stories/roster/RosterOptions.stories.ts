import RosterOptions from '../../src/components/shared/rosters/RosterOptions.astro';
import { phoneModes, themeModes } from '../../.storybook/modes';

/**
 * The Rosters page's Year picker (and, on a page with rankings, My Rank),
 * behind ONE sliders button on a phone. Every league's Rosters page renders
 * it. Above the phone breakpoint the button is gone and the controls sit
 * inline; the phone stories snapshot the closed button.
 *
 * No `rankingsLeague` here: MyRankEditor hides its own trigger until the
 * owner has two boards in browser storage, so a story would snapshot nothing.
 */

const YEARS = [2026, 2025, 2024, 2023, 2022];

export default {
  title: 'Roster/RosterOptions',
  component: RosterOptions,
  parameters: {
    chromatic: { modes: themeModes },
  },
};

export const Default = {
  args: { years: YEARS, selectedYear: 2026, selectId: 'story-year-select' },
};

/** A past season picked, as a `?year=` link opens it. */
export const PastSeason = {
  args: { years: YEARS, selectedYear: 2023, selectId: 'story-year-select-past' },
};

/** Phone width: the sliders button alone, controls tucked behind it. */
export const Phone = {
  args: { years: YEARS, selectedYear: 2026, selectId: 'story-year-select-phone' },
  parameters: { chromatic: { modes: phoneModes } },
};
