import { createElement } from 'react';
import type { ReactElement } from 'react';
import LvNflGameDetail from '../../src/components/shared/live/LvNflGameDetail';
import { LIVE_BOX, LIVE_GAMES, LIVE_META, LIVE_MATCHUP } from '../fixtures/live-kit';
import { phoneModes } from '../../.storybook/modes';
import type { LivePanel } from '../../src/types/live';
import type { PlayerMeta } from '../../src/types/live-scoring';
import type { PositionRuleSet } from '../../src/utils/live/scoring-rules';

/**
 * The NFL game drill-in at phone width: tap a card on the NFL games rail and
 * the board swaps for this — the two clubs side by side, every
 * fantasy-eligible player on each, scored by the league on screen.
 *
 * The same paired rows as a fantasy matchup's drill-in (`LvLineup`), so the
 * snapshot that matters is the one the matchup story already guards against:
 * nothing may run off either edge at 390px. What is new here is the
 * fantasy-team mark tucked onto the headshot's corner, the FA tag on the meta
 * line, and the viewer's own player's faint highlight — all three appear in
 * this one shot (Jalen Hurts and Mike Washington Jr. are the viewer's side;
 * the PHI tight end is a free agent).
 *
 * The player pool is handed in (`pool`) rather than fetched, because a story
 * has no API behind it. Rendered without a `.lv-page` ancestor, as MFL Live
 * draws it, for the reason `LvMatchupDetail.stories.ts` gives.
 */
const panel: LivePanel = {
  leagueId: '13522',
  leagueName: 'The League',
  slug: 'theleague',
  registered: true,
  viewerFranchiseId: LIVE_MATCHUP.sides[0].franchiseId,
  status: 'ok',
  matchups: [LIVE_MATCHUP],
};

const freeAgent: PlayerMeta = {
  id: 'fa1',
  name: 'Grant Calcaterra',
  position: 'TE',
  nflTeam: 'PHI',
  headshot: '',
  espnId: null,
  projected: 0,
};

const rules = new Map<string, PositionRuleSet[]>([
  [
    '13522',
    [
      {
        positions: ['QB', 'RB', 'WR', 'TE'],
        rules: [
          { event: ['CC'], lo: 0, hi: 99, kind: 'per', points: 1, every: 1 },
          { event: ['CY'], lo: -99, hi: 999, kind: 'per', points: 0.1, every: 1 },
        ],
      },
      { positions: ['PK', 'Def'], rules: [] },
    ] as unknown as PositionRuleSet[],
  ],
]);

export default {
  title: 'Live/NflGameDetail',
  component: LvNflGameDetail,
  parameters: {
    // See Trap 8 — a React story must name its renderer.
    renderer: 'react',
    layout: 'fullscreen',
    chromatic: { modes: phoneModes },
  },
};

export const PhoneWidth = {
  args: {
    game: LIVE_GAMES.KC,
    panels: [panel],
    meta: LIVE_META,
    gamesByTeam: LIVE_GAMES,
    boxScore: {
      ...LIVE_BOX,
      fa1: { playerId: 'fa1', nflTeam: 'PHI', statLine: '2 rec (3 tgt), 31 yds', gameId: '4011', stats: { CC: 2, CY: 31 } },
    },
    detailStatus: 'ok',
    rules,
    rostersComplete: true,
    year: 2026,
    interactive: false,
    kickoffClock: null,
    pool: [freeAgent],
    onBack: () => {},
  },
  decorators: [
    (Story: () => ReactElement) =>
      createElement('div', { className: 'lv' }, createElement(Story)),
  ],
};
