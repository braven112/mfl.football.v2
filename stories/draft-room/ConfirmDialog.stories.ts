import { ConfirmDialog } from '../../src/components/shared/draft-room/ConfirmDialog';
import { themeModes } from '../../.storybook/modes';
import { draftRoomDecorator } from './decorator';

/** The room's confirm step — used before anything that cannot be undone. */
export default {
  title: 'Draft Room/ConfirmDialog',
  component: ConfirmDialog,
  parameters: {
    renderer: 'react',
    layout: 'fullscreen',
    chromatic: { modes: themeModes },
  },
  decorators: [draftRoomDecorator()],
};

/** The destructive variant: resetting a mock draft throws every pick away. */
export const ResetMockDraft = {
  args: {
    title: 'Reset this mock draft?',
    message: 'Every pick made so far will be cleared and the draft will restart from 1.01.',
    confirmLabel: 'Reset draft',
    cancelLabel: 'Keep going',
    destructive: true,
    onConfirm: () => {},
    onCancel: () => {},
  },
};
