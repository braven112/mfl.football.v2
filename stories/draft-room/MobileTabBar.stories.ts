import { MobileTabBar } from '../../src/components/shared/draft-room/MobileTabBar';
import { phoneModes } from '../../.storybook/modes';
import { draftRoomDecorator } from './decorator';

/**
 * The phone room's tab bar. Phone modes only — it is the phone layout's
 * navigation — with an unread chat count and a queue count, so both badges
 * show.
 */
export default {
  title: 'Draft Room/MobileTabBar',
  component: MobileTabBar,
  parameters: {
    renderer: 'react',
    layout: 'fullscreen',
    chromatic: { modes: phoneModes },
  },
  decorators: [draftRoomDecorator()],
};

export const OnTheBoard = { args: { activeTab: 'board', onTabChange: () => {}, chatUnread: 3, queueCount: 2 } };
