import QuickLinks from '../../src/components/shared/hp-sections/QuickLinks.astro';
import { themeModes } from '../../.storybook/modes';

/**
 * The homepage quick-links grid — one of the few components that is genuinely
 * shared and genuinely league-aware.
 *
 * It is worth pinning because it varies along TWO independent axes that are
 * easy to confuse:
 *
 *  - `league` (a PROP) selects which pages exist and which CSS class prefix
 *    the markup uses. The component reads the page directory and filters by
 *    league, so TheLeague and the AFL legitimately show different links.
 *  - `html[data-league]` (the toolbar GLOBAL) selects the skin.
 *
 * The stories below pair them the way production does. A mismatch — AFL links
 * wearing TheLeague's palette — is exactly the drift a story catches and a
 * page-level eyeball does not.
 */
export default {
  title: 'Shared/QuickLinks',
  component: QuickLinks,
  parameters: {
    layout: 'fullscreen',
    // themeModes, NOT allModes: `league` is already a PROP with a story per
    // league below. Adding league modes on top would snapshot the same axis
    // twice — 16 snapshots to cover 8 real combinations.
    chromatic: { modes: themeModes },
  },
};

export const TheLeagueSignedIn = {
  args: { league: 'theleague', isAuthenticated: true },
};

/**
 * Logged out. `visibility: 'admin'` entries and any my-team links must drop
 * out — a guest seeing an owner-only link is a real bug, and it is invisible
 * on a page you are always signed into while developing.
 */
export const TheLeagueGuest = {
  args: { league: 'theleague', isAuthenticated: false },
};

export const AflSignedIn = {
  args: { league: 'afl-fantasy', isAuthenticated: true },
};

export const AflGuest = {
  args: { league: 'afl-fantasy', isAuthenticated: false },
};
