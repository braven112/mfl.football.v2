import Skeleton from '../../src/components/shared/loading/Skeleton.astro';

/**
 * Tier 4 content placeholder. Brand-neutral by design (no accent), so unlike
 * Spinner this one should look IDENTICAL across the League toolbar values —
 * a diff between leagues here is a bug, not a skin.
 */
export default {
  title: 'Loading/Skeleton',
  component: Skeleton,
};

export const Block = {
  args: { height: '5rem' },
};

export const Text = {
  args: { variant: 'text', width: '80%' },
};

export const Title = {
  args: { variant: 'title' },
};

export const Circle = {
  args: { variant: 'circle', height: '40px' },
};

/** The stacked-list shape — `count > 1` renders a different wrapper element. */
export const List = {
  args: { height: '3rem', count: 4, label: 'Loading trades' },
};
