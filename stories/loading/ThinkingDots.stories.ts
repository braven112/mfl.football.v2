import ThinkingDots from '../../src/components/shared/loading/ThinkingDots.astro';
import { allModes } from '../../.storybook/modes';

/**
 * Three bouncing dots for AI / "voice is working" waits. Dots take
 * `var(--league-accent)`, so this re-skins per league like Spinner does.
 *
 * The label is optional and changes the DOM shape (the text span only exists
 * when a label is passed), which is why both states are pinned.
 */
export default {
  title: 'Loading/ThinkingDots',
  parameters: {
    // Genuinely cross-league: the accent reads var(--league-accent), so the
    // AFL skin is a real shipping combination worth snapshotting.
    chromatic: { modes: allModes },
  },
  component: ThinkingDots,
};

export const WithLabel = {
  args: { label: 'Schefter is on the wire' },
};

export const DotsOnly = {
  args: {},
};

export const RogerThinking = {
  args: { label: 'Roger is checking the constitution' },
};
