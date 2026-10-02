import { DraftBoardPanel } from '../../src/components/shared/draft-room/DraftBoardPanel';
import {
  CURRENT_PICK_NUMBER,
  DRAFT_PICKS,
  DRAFT_PLAYERS_BY_ID,
  DRAFT_TEAMS,
  USER_TEAM_ID,
} from '../fixtures/draft-room';
import { allModes, phoneModes, themeModes } from '../../.storybook/modes';
import { draftRoomDecorator } from './decorator';

/**
 * The draft board — one round at a time, a cell per pick (BoardCell).
 *
 * The fixture's round 2 puts every cell state on screen at once: two made
 * picks, the viewer ON THE CLOCK at 2.03, and three still to come. Round 1
 * (`CompletedRound`) carries the traded pick's badge and a DEF's NFL mark.
 *
 * MODES. The on-the-clock cell, the active round pill and the viewer's column
 * read `--color-primary`, which the league skin re-points (TheLeague blue, AFL
 * red), so `MidRound` takes all four modes. Below 767px the grid is replaced
 * by a stacked list (`.dr-mobile-list`) — a different render, so `MidRound`
 * also takes the two phone modes. They go on the SAME story rather than a
 * separate Phone one: preview.ts applies light + dark to every story and
 * modes only widen, so a Phone story would also re-capture this exact desktop
 * render twice.
 */
export default {
  title: 'Draft Room/DraftBoardPanel',
  component: DraftBoardPanel,
  parameters: {
    renderer: 'react',
    layout: 'padded',
    chromatic: { modes: themeModes },
  },
  decorators: [draftRoomDecorator()],
};

const base = {
  picks: DRAFT_PICKS,
  teams: DRAFT_TEAMS,
  players: DRAFT_PLAYERS_BY_ID,
  totalRounds: 2,
  picksPerRound: DRAFT_TEAMS.length,
  currentPickNumber: CURRENT_PICK_NUMBER,
  userTeamId: USER_TEAM_ID,
  onRoundChange: () => {},
};

/** Round 2: made picks, the viewer on the clock, picks to come. */
export const MidRound = {
  args: { ...base, activeRound: 2 },
  parameters: { chromatic: { modes: { ...allModes, ...phoneModes } } },
};

/** Round 1, complete: the traded 1.03 and the DEF pick. */
export const CompletedRound = { args: { ...base, activeRound: 1 } };
