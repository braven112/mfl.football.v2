import { createElement } from 'react';
import type { ReactElement } from 'react';
import LvStandings from '../../src/components/shared/live/LvStandings';
import { LIVE_MATCHUP, LIVE_STANDINGS } from '../fixtures/live-kit';
import { allModes, themeModes } from '../../.storybook/modes';

/**
 * One league's standings — MFL's rows in MFL's order, plus the two labelled
 * what-if views.
 *
 * `LIVE_STANDINGS` is built so `LIVE_MATCHUP` visibly moves it: the viewer
 * climbs 4th → 2nd (▲2) and its opponent drops 2nd → 4th (▼2) in the Live
 * view, while Final shows MFL's table untouched. Those two stories together
 * are the picture of the rule this component exists to keep
 * (`docs/claude/rules/standings-brackets-draft-order.md`).
 *
 * MODES. The viewer's row tint and the active view tab both read
 * `--league-accent`, so `Live` — which shows both — opts UP to all four
 * modes. The others stay on the cheap pair: modes widen, they never narrow
 * (Trap 8 in docs/claude/rules/storybook.md).
 */
export default {
  title: 'Live/Standings',
  component: LvStandings,
  parameters: {
    renderer: 'react',
    layout: 'padded',
    chromatic: { modes: themeModes },
  },
  decorators: [
    (Story: () => ReactElement) =>
      createElement('div', { className: 'lv', style: { maxWidth: '40rem' } }, createElement(Story)),
  ],
};

/** The default view: this week added as it stands, with the moves marked. */
export const Live = {
  args: { rows: LIVE_STANDINGS, leagueName: 'TheLeague', matchups: [LIVE_MATCHUP] },
  parameters: { chromatic: { modes: allModes } },
};

/** MFL's own order, untouched — the only official view. */
export const Final = {
  args: { rows: LIVE_STANDINGS, leagueName: 'TheLeague', matchups: [LIVE_MATCHUP], initialMode: 'final' },
};

/**
 * The read failed. Never an empty table: "missing, not zeros" is the same
 * distinction the scores tab keeps between `unavailable` and `no-matchup`.
 */
export const Unavailable = { args: { rows: null, leagueName: 'TheLeague' } };
