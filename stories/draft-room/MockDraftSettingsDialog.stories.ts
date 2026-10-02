import { MockDraftSettingsDialog } from '../../src/components/shared/draft-room/MockDraftSettingsDialog';
import { DRAFT_TEAMS_BY_ID, MOCK_SESSION } from '../fixtures/draft-room';
import { themeModes } from '../../.storybook/modes';
import { draftRoomDecorator } from './decorator';

/**
 * The mock-draft creator's settings: the pick clock, and which teams the CPU
 * drafts for. The fixture switches Cowboy Up to MANUAL — the override this
 * dialog exists to make — so both toggle states are on screen, and the
 * Mariachi Ninjas are on the clock.
 */
export default {
  title: 'Draft Room/MockDraftSettingsDialog',
  component: MockDraftSettingsDialog,
  parameters: {
    renderer: 'react',
    layout: 'fullscreen',
    chromatic: { modes: themeModes },
  },
  decorators: [draftRoomDecorator()],
};

export const MidDraft = {
  args: {
    session: MOCK_SESSION,
    teams: DRAFT_TEAMS_BY_ID,
    onClockFranchiseId: '0005',
    onSetTimer: () => {},
    onSetAutoDraft: () => {},
    onClose: () => {},
  },
};
