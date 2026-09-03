/**
 * The draft section's page list — one registry, read by both the hub and the
 * sub-nav strip so the two can never disagree about what exists.
 *
 * `leagues` is the honest part. The AFL does not have a Draft Room or a Mock
 * Draft yet (docs/plans/draft-hub-and-results.md, Phases 5 and the deferred
 * mock), and the decision was to let each league show what it HAS rather than
 * advertise a page that 404s. Adding the AFL to a `leagues` list here is the
 * single edit that publishes that page to it, in both surfaces at once.
 *
 * Paths are league-NEUTRAL and get prefixed per reader by `resolveLeaguePath`,
 * the same way nav-config.json's are. Writing `/theleague/draft/order` here
 * would send AFL readers to the other league's site.
 */

export type DraftLeagueSlug = 'theleague' | 'afl-fantasy';

export interface DraftPage {
  /** Stable key; also what a page passes as `current` to the strip. */
  key: string;
  label: string;
  /** Shorter label for the strip, where horizontal room is scarce. */
  shortLabel: string;
  /** League-neutral path. */
  path: string;
  /** Sprite icon id, without the leading `#`. */
  icon: string;
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
    icon: 'icon-draft-podium',
    blurb: 'Where you pick — projected through the season, official once the playoffs wrap.',
    leagues: BOTH,
  },
  {
    key: 'results',
    label: 'Draft Results',
    shortLabel: 'Results',
    path: '/draft/results',
    icon: 'icon-history',
    blurb: 'Every draft the league has ever held, pick by pick.',
    leagues: BOTH,
  },
  {
    key: 'broadcast',
    label: 'Draft Broadcast',
    shortLabel: 'Broadcast',
    path: '/draft/broadcast',
    icon: 'icon-scoreboard-2',
    blurb: 'The big board for draft night — plug a laptop into the TV and watch every pick land.',
    leagues: BOTH,
  },
  {
    key: 'room',
    label: 'Draft Room',
    shortLabel: 'Room',
    path: '/draft/room',
    icon: 'icon-podium-persona',
    // AFL joins this list in Phase 5, once its room knows that the AL drafts
    // live in MFL's applet and the NL runs a slow email draft.
    blurb: 'The live board while the draft runs — picks, queue and who is on the clock.',
    leagues: ['theleague'],
  },
  {
    key: 'mock',
    label: 'Mock Draft',
    shortLabel: 'Mock',
    path: '/draft/mock',
    icon: 'icon-podium-empty',
    blurb: 'Practice the draft against the clock before it counts.',
    leagues: ['theleague'],
  },
  {
    key: 'import-rankings',
    label: 'Import Rankings',
    shortLabel: 'Rankings',
    path: '/import-rankings',
    icon: 'icon-rank',
    blurb: 'Bring your own rankings in, or use the built-in sources.',
    leagues: BOTH,
  },
  {
    key: 'custom-rankings',
    label: 'My Draft List',
    shortLabel: 'My List',
    path: '/cr',
    icon: 'icon-clipboard',
    blurb: 'Your own board, ordered your way, ready for draft day.',
    leagues: BOTH,
  },
];

/** The draft pages a given league actually has, in section order. */
export function draftPagesFor(league: DraftLeagueSlug): DraftPage[] {
  return DRAFT_PAGES.filter((p) => p.leagues.includes(league));
}

/** The hub itself — not in DRAFT_PAGES, because it links to all of them. */
export const DRAFT_HUB_PATH = '/draft';
