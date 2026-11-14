import TradeDeadlineConflictNotice from '../../src/components/shared/TradeDeadlineConflictNotice.astro';
import { themeModes } from '../../.storybook/modes';

/**
 * Commissioner-only warning: MFL's trade deadline disagrees with the
 * Constitution. MFL is the source of truth (the site counts down to it); the
 * card is how a carried-over calendar that drifted a week late gets noticed.
 * Light + dark, because the warning fill is a themed token.
 */
export default {
  title: 'Shared/TradeDeadlineConflictNotice',
  component: TradeDeadlineConflictNotice,
  parameters: {
    layout: 'padded',
    chromatic: { modes: themeModes },
  },
  args: {
    mflUrl: 'https://example.invalid/2026/home/0',
  },
};

/** MFL carried last year's calendar forward a week late. */
export const DateMismatch = {
  args: {
    check: {
      flag: true,
      year: 2026,
      message: 'MFL closes trading Fri, Nov 20 at 8:45 PM PT, but the Constitution says Fri, Nov 13 at 8:45 PM PT.',
    },
  },
};

/** MFL's calendar has no deadline at all. */
export const MissingFromMfl = {
  args: {
    check: {
      flag: true,
      year: 2026,
      message: "MFL's calendar has no 2026 trade deadline. The Constitution says Fri, Nov 13 at 8:45 PM PT.",
    },
  },
};
