import { createElement } from 'react';
import NflSeasonQuirks from '../../src/components/shared/NflSeasonQuirks';
import { themeModes } from '../../.storybook/modes';
// The page route imports this sheet; a story has to bring it itself.
import '../../src/styles/schedule-release.css';

/**
 * The "Quirks of the NFL season" note on the Schedule Release page: the opener,
 * Christmas games and every Tuesday/Wednesday/Friday game. Data is the
 * committed src/data/nfl/season-quirks.mjs, so 2026 is a real season (two
 * Wednesday games, a Christmas Friday) and 2099 is one the NFL has not
 * published — the empty state owners see before mid-May.
 */
export default {
  title: 'Shared/Schedule Release/NFL Season Quirks',
  component: NflSeasonQuirks,
  parameters: { renderer: 'react', layout: 'padded', chromatic: { modes: themeModes } },
};

const wrap = (props: { year: number; showWaivers?: boolean }) =>
  createElement('div', { className: 'rel', style: { padding: 0 } }, createElement(NflSeasonQuirks, props));

export const Owner = { render: () => wrap({ year: 2026 }) };
export const Commissioner = { render: () => wrap({ year: 2026, showWaivers: true }) };
export const NotPublishedYet = { render: () => wrap({ year: 2099 }) };
