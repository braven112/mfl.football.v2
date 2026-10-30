import LogoResizer from '../../src/components/shared/LogoResizer.astro';
import { mflModes } from '../../.storybook/modes';

/**
 * The free logo resizer — on `/fantasy-football-logo-resizer`, and under the
 * prompt on the free logo maker and MFL Live's `/live/team-logo`.
 *
 * Before a logo is dropped in only the drop zone shows; the size grid fills
 * in the browser once an image is loaded, so the story shows the empty
 * state. `UnderThePrompt` is how the two logo maker pages render it.
 *
 * Light + dark under `mflModes` (`data-league="mfl"`); on the marketing page
 * its `--lrs-*` tokens fall back to the shell's own.
 */
export default {
  title: 'Shared/MFL Live/Logo resizer',
  component: LogoResizer,
  parameters: {
    chromatic: { modes: mflModes },
  },
  args: {},
};

export const OwnPage = {};

export const UnderThePrompt = {
  args: {
    title: 'Got your logo? Drop it here for every size',
    pageHref: '/fantasy-football-logo-resizer',
  },
};
