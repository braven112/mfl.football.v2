import BrandedLoader from '../../src/components/shared/loading/BrandedLoader.astro';
import { allModes } from '../../.storybook/modes';

/**
 * Tier 5 "on the wire" moment for long (10s+) AI waits — the one loading tier
 * that carries league character.
 *
 * Narration cycles client-side on a ~2.5s timer, so any story with more than
 * one narration line is inherently non-deterministic. The single-line stories
 * are stable and snapshotted; the cycling one opts OUT of snapshots below
 * rather than feeding Chromatic a guaranteed false diff every build.
 */
export default {
  title: 'Loading/BrandedLoader',
  parameters: {
    // Genuinely cross-league: the accent reads var(--league-accent), so the
    // AFL skin is a real shipping combination worth snapshotting.
    chromatic: { modes: allModes },
  },
  component: BrandedLoader,
};

/** Stable: one narration line, nothing to cycle. */
export const Default = {
  args: {
    title: 'Working on it',
    narration: ['Hold tight…'],
  },
};

/** Stable: overlay chrome over a positioned parent, single line. */
export const Overlay = {
  args: {
    title: 'Asking Roger',
    narration: ['Reading the constitution…'],
    overlay: true,
  },
  parameters: {
    layout: 'fullscreen',
  },
};

/**
 * Non-deterministic on purpose — narration cycles every 2.5s, so whichever
 * line Chromatic happens to capture would differ between builds. Kept in
 * Storybook as the documentation of the cycling behavior, but excluded from
 * snapshots: a test that fails at random teaches you to ignore failures.
 *
 * To actually cover this, the component would need `cycleSeconds` honored as
 * an injectable clock. That is a component change, not a story change.
 */
export const CyclingNarration = {
  args: {
    title: 'Schefter is working the phones',
    narration: [
      'Checking the Rolodex…',
      'Confirming with sources…',
      'Getting a second source…',
    ],
  },
  parameters: {
    chromatic: { disableSnapshot: true },
  },
};
