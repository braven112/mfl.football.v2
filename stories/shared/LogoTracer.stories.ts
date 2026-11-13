import LogoTracer from '../../src/components/shared/live/LogoTracer.astro';
import { mflModes } from '../../.storybook/modes';

/**
 * "Make it an SVG" — the free logo tracer, under the prompt builder on the
 * public logo maker, `/team-logo`.
 * Open to everyone, signed in or not, so it has one state at rest.
 */
export default {
  title: 'Shared/MFL Live/Logo tracer',
  component: LogoTracer,
  parameters: {
    chromatic: { modes: mflModes },
  },
};

export const Default = {};
