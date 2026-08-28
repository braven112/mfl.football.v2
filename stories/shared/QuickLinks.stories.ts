import QuickLinks from '../../src/components/shared/hp-sections/QuickLinks.astro';
import { themeModes, leagueModes } from '../../.storybook/modes';

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
 * Logged out.
 *
 * Being precise about what this does and does not guard: admin filtering is
 * auth-independent here, and `isAuthenticated` mainly affects ordering rather
 * than removing entries. So this pins the guest ORDERING and layout, not an
 * access-control rule. Do not read it as a permissions test.
 */
export const TheLeagueGuest = {
  args: { league: 'theleague', isAuthenticated: false },
};

// The AFL pair carries the AFL skin. Default themeModes pins
// data-league="theleague", which would have rendered AFL links under
// TheLeague's palette and baselined the very mismatch this file claims to
// catch. (Note QuickLinks takes CanonicalLeagueSlug — 'afl-fantasy' — while
// PeckingOrderIssue takes the nav LeagueSlug 'afl'. Two vocabularies.)
const aflModes = { parameters: { chromatic: { modes: leagueModes } } };

export const AflSignedIn = {
  args: { league: 'afl-fantasy', isAuthenticated: true },
  ...aflModes,
};

export const AflGuest = {
  args: { league: 'afl-fantasy', isAuthenticated: false },
  ...aflModes,
};
