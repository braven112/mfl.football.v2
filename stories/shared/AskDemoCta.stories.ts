import AskDemoCta from '../../src/components/shared/league-history/AskDemoCta.astro';
import { allModes } from '../../.storybook/modes';

/**
 * "Try Ask the History": the mfl.football button that sends a visitor to the
 * public demo league's ask screen (guest-ask.ts). It takes no props; the
 * league and the free-question count come from the demo's own constants.
 */
export default {
  title: 'Shared/League History/Try Ask the History',
  component: AskDemoCta,
  parameters: { chromatic: { modes: allModes } },
};

export const Default = {};
