import Spinner from '../../src/components/shared/loading/Spinner.astro';

/**
 * Tier 2/3 inline loading indicator.
 *
 * The accent is `var(--league-accent)`, defined at `:root` in tokens.css and
 * overridden under `html[data-league="afl"]` / `["bb1"]`. Flip the League
 * toolbar control and the spinner re-skins with no code branch — that is the
 * property worth pinning in a visual test.
 */
export default {
  title: 'Loading/Spinner',
  component: Spinner,
};

export const Default = {
  args: { label: 'Loading' },
};

export const Compact = {
  args: { size: 'compact', label: 'Loading news' },
};

export const Large = {
  args: { size: 'large', label: 'Loading scoreboard' },
};
