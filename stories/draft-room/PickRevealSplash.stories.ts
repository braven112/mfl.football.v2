import { PickRevealSplash } from '../../src/components/shared/draft-room/PickRevealSplash';
import { SPLASH_QUEUE } from '../fixtures/draft-room';
import { themeModes } from '../../.storybook/modes';
import { draftRoomDecorator } from './decorator';

/**
 * The full-screen card announcing a pick, tinted by the drafting franchise.
 *
 * NO SNAPSHOT, deliberately. The card dismisses itself on a real 3.6s timer
 * (`DISPLAY_MS`) and then animates out, so whether a capture shows it, shows
 * it leaving, or shows nothing depends on how long the capture takes — a
 * test that fails at random. Same call as `BrandedLoader/CyclingNarration`:
 * covering it properly needs the component to take an injectable hold time,
 * which is a component change, not a story change. It stays here as a
 * workbench to look at.
 */
export default {
  title: 'Draft Room/PickRevealSplash',
  component: PickRevealSplash,
  parameters: {
    renderer: 'react',
    layout: 'fullscreen',
    chromatic: { modes: themeModes, disableSnapshot: true },
  },
  decorators: [draftRoomDecorator()],
};

export const PickIsIn = { args: { queue: SPLASH_QUEUE, onConsume: () => {} } };
