import { DraftQueuePanel } from '../../src/components/shared/draft-room/DraftQueuePanel';
import { DRAFT_PICKS, DRAFT_PLAYERS_BY_ID, DRAFT_QUEUE } from '../fixtures/draft-room';
import { themeModes } from '../../.storybook/modes';
import { draftRoomDecorator } from './decorator';

/**
 * The viewer's queue (QueueRow per player, drag to reorder).
 *
 * The fixture queue holds a player who was TAKEN after being queued (r4), so
 * the drafted-row treatment is on screen beside two live rows.
 */
export default {
  title: 'Draft Room/DraftQueuePanel',
  component: DraftQueuePanel,
  parameters: {
    renderer: 'react',
    layout: 'padded',
    chromatic: { modes: themeModes },
  },
  decorators: [draftRoomDecorator('22rem')],
};

const noop = () => {};
const base = {
  queue: DRAFT_QUEUE,
  players: DRAFT_PLAYERS_BY_ID,
  picks: DRAFT_PICKS,
  autoSubmit: false,
  isSyncingQueue: false,
  isSubmittingPick: false,
  submitError: null,
  onReorder: noop,
  onRemove: noop,
  onSyncToMfl: noop,
  onSubmitPick: noop,
  onToggleAutoSubmit: noop,
};

/** On the clock: the top live row offers the pick. */
export const YourTurn = { args: { ...base, isUserTurn: true } };

/** Waiting: the same queue while another team picks. */
export const Waiting = { args: { ...base, isUserTurn: false } };

/** A submit that MFL rejected — the error has to be visible, not swallowed. */
export const SubmitFailed = {
  args: { ...base, isUserTurn: true, submitError: 'MFL rejected the pick: player already drafted.' },
};
