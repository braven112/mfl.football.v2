import TeamLogoBuilder from '../../src/components/shared/TeamLogoBuilder.astro';
import { mflModes } from '../../.storybook/modes';

/**
 * The team logo prompt builder — the form on MFL Live's `/live/team-logo`
 * and on the public free tool `/fantasy-football-logo-maker`.
 *
 * Every choice rewrites the prompt below it (the client script imports
 * `src/utils/team-logo-prompt.ts`). `SignedIn` shows the name field opening
 * on the owner's first team, with their other teams as suggestions.
 *
 * Light + dark under `mflModes` (`data-league="mfl"`), the palette MFL Live
 * renders it in; on the marketing page its `--tlogo-*` tokens fall back to
 * the shell's own.
 */
export default {
  title: 'Shared/MFL Live/Team logo builder',
  component: TeamLogoBuilder,
  parameters: {
    chromatic: { modes: mflModes },
  },
  args: {},
};

export const SignedOut = {};

export const SignedIn = {
  args: {
    initialName: 'Pacific Pigskins',
    teams: [
      { name: 'Pacific Pigskins', league: 'The League' },
      { name: 'Smokane FC', league: 'AFL' },
    ],
  },
};
