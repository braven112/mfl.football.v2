/**
 * The draft section's page list — one registry, read by both the hub and the
 * sub-nav strip so the two can never disagree about what exists.
 *
 * `leagues` is the honest part: each league shows what it HAS rather than
 * advertising a page that 404s. Adding a league to a `leagues` list here is the
 * single edit that publishes that page to it, in both surfaces at once, and
 * `tests/draft-section.test.ts` fails if the route file does not exist.
 *
 * As of September 2026 both leagues have every page, so no list is short. Keep
 * the mechanism: the next league added starts with none of them.
 *
 * Paths are league-NEUTRAL and get prefixed per reader by `resolveLeaguePath`,
 * the same way nav-config.json's are. Writing `/theleague/draft/order` here
 * would send AFL readers to the other league's site.
 */

import { pageIcon } from '../../../utils/page-icon';

export type DraftLeagueSlug = 'theleague' | 'afl-fantasy';

export interface DraftPage {
  /** Stable key; also what a page passes as `current` to the strip. */
  key: string;
  label: string;
  /** Shorter label for the strip, where horizontal room is scarce. */
  shortLabel: string;
  /** League-neutral path. */
  path: string;
  /** What this page is for — the hub shows it; the strip doesn't. */
  blurb: string;
  leagues: DraftLeagueSlug[];
}

const BOTH: DraftLeagueSlug[] = ['theleague', 'afl-fantasy'];

export const DRAFT_PAGES: DraftPage[] = [
  {
    key: 'order',
    label: 'Draft Order',
    shortLabel: 'Order',
    path: '/draft/order',
    blurb: 'Where you pick — projected through the season, official once the playoffs wrap.',
    leagues: BOTH,
  },
  {
    key: 'results',
    label: 'Draft Results',
    shortLabel: 'Results',
    path: '/draft/results',
    blurb: 'Every draft the league has ever held, pick by pick.',
    leagues: BOTH,
  },
  {
    key: 'broadcast',
    label: 'Draft Broadcast',
    shortLabel: 'Broadcast',
    path: '/draft/broadcast',
    blurb: 'The big board for draft night — plug a laptop into the TV and watch every pick land.',
    leagues: BOTH,
  },
  {
    key: 'room',
    label: 'Draft Room',
    shortLabel: 'Room',
    path: '/draft/room',
    // The AFL joined once its room learned that the AL drafts live in MFL's
    // applet while the NL runs a slow email draft — see utils/afl-draft-room.
    blurb: 'The live board while the draft runs — picks, queue and who is on the clock.',
    leagues: BOTH,
  },
  {
    key: 'mock',
    label: 'Mock Draft',
    shortLabel: 'Mock',
    path: '/draft/mock',
    // The AFL joined once its mock learned to draft from the pool its KEEPERS
    // left behind — conference-scoped, and shut until the cuts land. See
    // utils/afl-mock-draft.
    blurb: 'Practice the draft against the clock before it counts.',
    leagues: BOTH,
  },
  {
    key: 'import-rankings',
    label: 'Import Rankings',
    shortLabel: 'Rankings',
    path: '/import-rankings',
    blurb: 'Bring your own rankings in, or use the built-in sources.',
    leagues: BOTH,
  },
  {
    key: 'custom-rankings',
    label: 'My Draft List',
    shortLabel: 'My List',
    path: '/cr',
    blurb: 'Your own board, ordered your way, ready for draft day.',
    leagues: BOTH,
  },
];

/**
 * The draft pages a given league actually has, in section order. `icon` is
 * the sprite symbol id (`icon-…`), and it is the page's own icon from
 * src/config/page-icons.json, never one picked here — so the strip and the
 * hub show what the menu shows.
 */
export function draftPagesFor(league: DraftLeagueSlug): (DraftPage & { icon: string })[] {
  return DRAFT_PAGES.filter((p) => p.leagues.includes(league)).map((p) => ({
    ...p,
    icon: `icon-${pageIcon(p.path, league)}`,
  }));
}

/** The hub itself — not in DRAFT_PAGES, because it links to all of them. */
export const DRAFT_HUB_PATH = '/draft';
