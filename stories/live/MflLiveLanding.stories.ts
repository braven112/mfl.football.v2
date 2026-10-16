import MflLiveLanding from '../../src/components/shared/mfl-live/MflLiveLanding.astro';
import { allModes } from '../../.storybook/modes';

/**
 * MFL Live's landing for a signed-out visitor at /live. Every score on it is
 * an illustration, so the story needs no data; snapshotted in both themes
 * because the page follows the theme while its studio pieces stay dark.
 */
export default {
  title: 'Live/MflLiveLanding',
  component: MflLiveLanding,
  parameters: { layout: 'fullscreen', chromatic: { modes: allModes } },
};

export const SignedOut = {
  args: { seasonYear: 2026, hostname: 'localhost' },
};
