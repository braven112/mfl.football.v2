/**
 * Fixtures for LeagueCompositeHero — hand-built `EventHeroView`s.
 *
 * The real views come from `afl-hero-resolver.ts` (AFL) and
 * `waiverClaimsHeroView` (both leagues), which read MFL's calendar and the
 * viewer's clock. These are frozen copies of what those produce on a
 * Wednesday waiver day, so the story needs no clock and no feed.
 *
 * Offline on purpose, two ways:
 *  - the headshot is an inline data-URI silhouette, never an ESPN cutout
 *    (Chromatic waits for network idle; see docs/claude/rules/storybook.md);
 *  - the cast player's team is `FA`. The component watermarks the card with
 *    the player's NFL logo, which is an a.espncdn.com URL, and a franchise
 *    crest resolved from an id is invisible to `computeStoryAssetLiterals()`.
 *    A free agent has neither, which is also true to the waiver card.
 *
 * Plain object literals and no imports beyond types: fixture modules are
 * bundled for the browser (Trap 6).
 */
import type { EventHeroView } from '../../src/utils/afl-hero-resolver';
import type { HeroModel } from '../../src/utils/hero-casting';

const FACE =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyMDAgMjAwJz48cmVjdCB3aWR0aD0nMjAwJyBoZWlnaHQ9JzIwMCcgZmlsbD0nbm9uZScvPjxjaXJjbGUgY3g9JzEwMCcgY3k9JzcyJyByPSc0MicgZmlsbD0nI2NmZDRkYScvPjxwYXRoIGQ9J00yMCAyMDBjMC00NiAzNi03NCA4MC03NHM4MCAyOCA4MCA3NHonIGZpbGw9JyNjZmQ0ZGEnLz48L3N2Zz4=';

export const topTarget: HeroModel = {
  mflId: '17001',
  name: 'Ted Hurst',
  position: 'WR',
  nflTeam: 'FA',
  headshot: FACE,
  descriptor: 'Top Target',
};

/** TheLeague processes at 7:00 PM PT (its calendar's WAIVER_BBID). */
export const theLeagueWaiverDay: EventHeroView = {
  pill: 'WAIVER DAY',
  headline: 'CLAIMS RUN',
  accentWord: 'TONIGHT.',
  summary: 'Waivers process Wed 7:00 PM PT. After that, free agents go first-come, first-served through Sunday kickoff.',
  link: '/theleague/players',
  linkLabel: 'SET YOUR CLAIMS',
  composite: { wordmark: 'WAIVERS', accent: 'kickoff', tone: null, scope: 'league' },
  countValue: 'TONIGHT',
  countLabel: 'Process at Wed 7:00 PM PT',
  model: topTarget,
};

/** The AFL processes at 8:00 PM PT (WAIVER_REVERSE), in its navy. */
export const aflWaiverDay: EventHeroView = {
  ...theLeagueWaiverDay,
  summary: 'Waivers process Wed 8:00 PM PT. After that, free agents go first-come, first-served through Sunday kickoff.',
  link: '/afl-fantasy/rosters',
  composite: { wordmark: 'WAIVERS', accent: 'navy', tone: null, scope: 'league' },
  countLabel: 'Process at Wed 8:00 PM PT',
};

/**
 * After the run: the `fcfs` state, the only one that reads as cleared. Strings
 * copied from `waiverDeadlineCopy`'s cleared branch — keep them in step, or the
 * snapshot baselines copy the site never renders.
 */
export const theLeagueWaiversCleared: EventHeroView = {
  ...theLeagueWaiverDay,
  pill: 'WAIVERS CLEARED',
  headline: 'CLAIMS HAVE',
  accentWord: 'PROCESSED.',
  summary: 'Claims are in. Free agents are first-come, first-served through Sunday kickoff — the next claim window opens Sun 1:00 PM PT.',
  linkLabel: 'BROWSE FREE AGENTS',
  countValue: 'OPEN NOW',
  countLabel: 'Waivers reopen Sun 1:00 PM PT',
};
