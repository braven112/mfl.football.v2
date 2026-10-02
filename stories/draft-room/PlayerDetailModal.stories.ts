import { PlayerDetailModal } from '../../src/components/shared/draft-room/PlayerDetailModal';
import { DRAFT_PLAYERS_BY_ID, USER_PICK_ON_CLOCK } from '../fixtures/draft-room';
import { themeModes } from '../../.storybook/modes';
import { draftRoomDecorator } from './decorator';

/**
 * The player sheet opened from the pool: scouting, ADP delta against the pick
 * on the clock, and the queue / draft actions.
 *
 * It has a story of its own because the coverage classifier would otherwise
 * count it "covered" through PlayerPoolPanel, which imports it but only
 * renders it after a click — no snapshot of the pool ever shows it.
 */
export default {
  title: 'Draft Room/PlayerDetailModal',
  component: PlayerDetailModal,
  parameters: {
    renderer: 'react',
    layout: 'fullscreen',
    chromatic: { modes: themeModes },
  },
  decorators: [draftRoomDecorator()],
};

const noop = () => {};

/** On the clock, not yet queued: both actions offered. */
export const OnTheClock = {
  args: {
    player: DRAFT_PLAYERS_BY_ID.get('r9'),
    currentPick: USER_PICK_ON_CLOCK,
    isQueued: false,
    isUserTurn: true,
    onClose: noop,
    onAddToQueue: noop,
    onDraft: noop,
  },
};
