import BrandedLoader from '../../src/components/shared/loading/BrandedLoader.astro';

/**
 * Tier 5 "on the wire" moment for long (10s+) AI waits — the one loading tier
 * that carries league character.
 *
 * NOTE for visual testing: narration cycles client-side on a ~2.5s timer, so
 * this component is inherently non-deterministic. Multi-line stories below are
 * the exact shape that produces flaky snapshots; the single-line stories are
 * the stable ones. Pin `cycleSeconds` high, or snapshot only the single-line
 * variants, when this reaches Chromatic.
 */
export default {
  title: 'Loading/BrandedLoader',
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
 * Non-deterministic on purpose — cycles every 2.5s. Kept as the documentation
 * of the cycling behavior, and as the worked example of a story that needs
 * special handling before it can be snapshotted.
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
};
