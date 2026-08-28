import LineupGameStrip from '../../src/components/shared/LineupGameStrip.astro';
import { allModes } from '../../.storybook/modes';
import { singleGame, doubleHeader, bandOnly, finalScore } from '../fixtures/lineup-cards';

/**
 * The matchup strip above both leagues' Set Lineup pages.
 *
 * Pure: `cards` plus `week`, no feed reads and no auth. It branches on card
 * count (single card vs swipeable strip) and on whether either side
 * composites, so all four shapes are pinned here — including the band-only
 * degraded card, which in production only appears when nobody on either
 * roster has a usable cutout.
 *
 * Snapshotted in both leagues because both render it, and the panel accents
 * come from franchise colors passed in rather than from the theme.
 */
export default {
  title: 'Shared/LineupGameStrip',
  component: LineupGameStrip,
  parameters: {
    layout: 'fullscreen',
    chromatic: { modes: allModes },
  },
};

export const SingleGame = {
  args: { cards: singleGame, week: 12 },
};

/** Two games — the strip becomes swipeable. Different layout, same data shape. */
export const DoubleHeader = {
  args: { cards: doubleHeader, week: 12 },
};

/** `faceoff: null` on both sides — the band-only fallback. */
export const BandOnly = {
  args: { cards: bandOnly, week: 12 },
};

/** A completed week: `statSource: 'actual'`, so the meta reads pts not proj. */
export const FinalScore = {
  args: { cards: finalScore, week: 11 },
};

/**
 * No games at all. A bye or an unscheduled week has to render as nothing
 * rather than as a broken empty strip.
 */
export const NoGames = {
  args: { cards: [], week: 14 },
};
