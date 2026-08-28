import LineupGameStrip from '../../src/components/shared/LineupGameStrip.astro';
import { themeModes } from '../../.storybook/modes';
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
 * Snapshotted light + dark only. Both leagues render it, but the panel accents
 * come from franchise colors passed in as args rather than from the skin, so
 * there is no league axis for a mode to express.
 */
export default {
  title: 'Shared/LineupGameStrip',
  component: LineupGameStrip,
  parameters: {
    layout: 'fullscreen',
    // themeModes, NOT allModes. Both leagues render this, but the component's
    // styles read no league-scoped token — panel accents come from franchise
    // colors passed in as args, not from the skin — so an AFL snapshot would
    // be pixel-identical. 10 snapshots a build, not 20.
    chromatic: { modes: themeModes },
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
