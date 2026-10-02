import { PlayerPoolPanel } from '../../src/components/shared/draft-room/PlayerPoolPanel';
import { DRAFT_PICKS, DRAFT_PLAYERS, DRAFT_QUEUE, USER_PICK_ON_CLOCK } from '../fixtures/draft-room';
import { themeModes } from '../../.storybook/modes';
import { draftRoomDecorator } from './decorator';

/**
 * The available-player pool: search, position filter, rookies toggle, and a
 * row per player with RSP tier and ADP. Drafted players drop out (the
 * fixture's picks take eight of twelve), so four rows remain.
 */
export default {
  title: 'Draft Room/PlayerPoolPanel',
  component: PlayerPoolPanel,
  parameters: {
    renderer: 'react',
    layout: 'padded',
    chromatic: { modes: themeModes },
  },
  decorators: [draftRoomDecorator('26rem')],
};

const noop = () => {};

export const RookieDraft = {
  args: {
    players: DRAFT_PLAYERS,
    picks: DRAFT_PICKS,
    queue: DRAFT_QUEUE,
    searchQuery: '',
    positionFilter: null,
    onSearchChange: noop,
    onPositionFilterChange: noop,
    onAddToQueue: noop,
    rookiesOnly: true,
    onRookiesOnlyChange: noop,
    draftContext: 'rookie',
    isUserTurn: true,
    onSubmitPick: noop,
    currentPick: USER_PICK_ON_CLOCK,
  },
};
