import MadQualifiers from '../../src/components/shared/package-league/MadQualifiers.astro';
import { themeModes } from '../../.storybook/modes';
import { madRows, madTiers } from '../fixtures/mad-qualifiers';

/**
 * MAD POWER 99 — the archies homepage's playoff card: three tiers of crest
 * tiles (pink / purple / cyan, the league's MFL widget colours), the red cut
 * line, and the link to the field. Worth a story because the tier colours are
 * literals that must read on BOTH the light card and the dark one.
 */
export default {
  title: 'Shared/Package league/MadQualifiers',
  component: MadQualifiers,
  parameters: { chromatic: { modes: themeModes } },
};

const base = { tiers: madTiers, rows: madRows, playoffSize: 30, fullHref: '#full-standings' };

export const Guest = { args: base };

/** A signed-in owner whose team qualified: their tile is outlined. */
export const SignedInQualifier = { args: { ...base, highlightFranchiseId: madTiers[1].ids[0] } };
