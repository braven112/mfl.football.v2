import { createElement } from 'react';
import { DraftTimerBanner } from '../../src/components/shared/draft-room/DraftTimerBanner';
import { DRAFT_TEAMS_BY_ID, OTHER_PICK_ON_CLOCK, USER_PICK_ON_CLOCK } from '../fixtures/draft-room';
import { allModes } from '../../.storybook/modes';
import { draftRoomDecorator } from './decorator';

/**
 * The clock across the top of the room, in every state it can be in.
 *
 * DETERMINISM. The banner's own countdown re-reads `new Date()` every second,
 * so no story uses it: every pill passes `mockClockSeconds`, which overrides
 * that timer outright, and the fixture picks carry no timestamp, so the
 * internal timer never starts. The one state left out is `suspended` — it is
 * decided by the real hour of the day, and a snapshot cannot pin that.
 *
 * All states in ONE story (all four modes, since the "other team" fill is
 * `--color-primary`, which the league re-points) rather than a story each.
 */
export default {
  title: 'Draft Room/DraftTimerBanner',
  component: DraftTimerBanner,
  parameters: {
    renderer: 'react',
    layout: 'padded',
    chromatic: { modes: allModes },
  },
  decorators: [draftRoomDecorator()],
};

const live = { draftKind: 'live', draftLimitHours: '2', draftTimerSusp: '', draftComplete: false } as const;
const me = DRAFT_TEAMS_BY_ID.get('0001')!;
const them = DRAFT_TEAMS_BY_ID.get('0005')!;

export const AllStates = {
  render: () =>
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.75rem' } },
      // You're up, 1:35 left of a 2:00 clock.
      createElement(DraftTimerBanner, { ...live, currentPick: USER_PICK_ON_CLOCK, currentTeam: me, isUserTurn: true, mockClockSeconds: 95 }),
      // Another team on the clock.
      createElement(DraftTimerBanner, { ...live, currentPick: OTHER_PICK_ON_CLOCK, currentTeam: them, mockClockSeconds: 95 }),
      // Under 20% of the limit: warning.
      createElement(DraftTimerBanner, { ...live, currentPick: OTHER_PICK_ON_CLOCK, currentTeam: them, mockClockSeconds: 12 }),
      // Out of time.
      createElement(DraftTimerBanner, { ...live, currentPick: OTHER_PICK_ON_CLOCK, currentTeam: them, mockClockSeconds: 0 }),
      // The creator picking for a team they control in a mock draft.
      createElement(DraftTimerBanner, { ...live, currentPick: OTHER_PICK_ON_CLOCK, currentTeam: them, isUserTurn: true, pickingForOtherTeam: true, mockClockSeconds: 95 }),
      // Nobody on the clock yet.
      createElement(DraftTimerBanner, { ...live, currentPick: null, currentTeam: null, mockClockSeconds: 0 }),
      // Done.
      createElement(DraftTimerBanner, { ...live, currentPick: null, currentTeam: null, draftComplete: true }),
    ),
};
