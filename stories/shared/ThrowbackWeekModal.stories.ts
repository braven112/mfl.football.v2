import ThrowbackWeekModal from '../../src/components/shared/ThrowbackWeekModal.astro';
import { buildThrowbackWelcome } from '../../src/utils/throwback-welcome';
import { themeModes } from '../../.storybook/modes';

/**
 * The Throwback Week welcome — "This week you're playing as ’13–’24 Pacific
 * Pigskins", shown once per device when a league's throwback week begins.
 *
 * Props are built by the real `buildThrowbackWelcome` at fixed dates, so the
 * crest, band colours and era years are exactly what the layout would pass;
 * a story with hand-typed props could drift from the band map it mirrors.
 *
 * `previewOpen` renders the dialog already open and NON-modal — a closed
 * <dialog> draws nothing, and showModal() would need the client script.
 *
 *  - **PicksOpen** — before the week's first kickoff: the picker CTA leads.
 *  - **PicksLocked** — after kickoff: no picker, one primary "Let's go".
 *  - **AflTeam** — the AFL's week 8, a different crest shape and palette.
 */
const welcome = (league: 'theleague' | 'afl', franchiseId: string, iso: string) =>
  buildThrowbackWelcome({ league, franchiseId, now: new Date(iso), overrides: {} })!;

export default {
  title: 'Shared/ThrowbackWeekModal',
  component: ThrowbackWeekModal,
  parameters: {
    layout: 'centered',
    chromatic: { modes: themeModes },
  },
  args: {
    welcome: welcome('theleague', '0001', '2026-09-30T18:00:00Z'),
    leagueSlug: 'theleague',
    pickerHref: '/theleague/throwback-settings',
    previewOpen: true,
  },
};

export const PicksOpen = {};

export const PicksLocked = {
  args: { welcome: welcome('theleague', '0005', '2026-10-03T18:00:00Z') },
};

export const AflTeam = {
  args: {
    welcome: welcome('afl', '0001', '2026-10-28T18:00:00Z'),
    leagueSlug: 'afl-fantasy',
    pickerHref: '/afl-fantasy/throwback-settings',
  },
};
