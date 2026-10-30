import LogoTracer from '../../src/components/shared/live/LogoTracer.astro';
import { mflModes } from '../../.storybook/modes';

/**
 * "Make it an SVG" — Owner Suite Pro's logo tracer, under the prompt builder
 * on MFL Live's `/live/team-logo`. `Pro` shows the upload button; `Locked`
 * is a signed-in owner without Pro; `SignedOut` offers the MFL sign-in.
 */
export default {
  title: 'Shared/MFL Live/Logo tracer',
  component: LogoTracer,
  parameters: {
    chromatic: { modes: mflModes },
  },
  args: { pro: true },
};

export const Pro = {};

export const Locked = { args: { pro: false } };

export const SignedOut = { args: { pro: false, signInHref: '/login?return=/live/team-logo' } };
