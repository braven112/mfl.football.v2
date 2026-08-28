import ThinkingDots from '../../src/components/shared/loading/ThinkingDots.astro';

/**
 * Three bouncing dots for AI / "voice is working" waits. Dots take
 * `var(--league-accent)`, so this re-skins per league like Spinner does.
 *
 * The label is optional and changes the DOM shape (the text span only exists
 * when a label is passed), which is why both states are pinned.
 */
export default {
  title: 'Loading/ThinkingDots',
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
