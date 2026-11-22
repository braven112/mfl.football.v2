import MyRanksBlendForm from '../../src/components/shared/MyRanksBlendForm.astro';
import { allModes } from '../../.storybook/modes';

/**
 * The Blend slider on the site owner's My Rankings page: how much of his
 * auction / AFL draft board is redraft versus dynasty. Saves only the number.
 */
export default {
  title: 'Shared/My Rankings/Blend slider',
  component: MyRanksBlendForm,
  parameters: { chromatic: { modes: allModes } },
};

export const TheLeague = { args: { slug: 'theleague', pct: 50 } };
export const AFL = { args: { slug: 'afl-fantasy', pct: 70 } };
