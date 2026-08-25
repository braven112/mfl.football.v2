/**
 * Site-footer link configuration.
 *
 * Every link is a `page-directory.json` id rather than a hardcoded path, so
 * the directory stays the single source of truth for where a page lives and
 * what it's called. The old footer hardcoded paths and drifted: it shipped
 * "Constitution" and "League Scoring" both pointing at /rules.
 *
 * Adding a page to the footer is therefore a two-step job on purpose — give it
 * a directory entry (which CLAUDE.md already requires), then list its id here.
 */

import type { CanonicalLeagueSlug } from './leagues';
import pageDirectory from '../data/page-directory.json';
import { getCurrentTierMembership, D_LEAGUE, PREMIER_LEAGUE } from '../utils/afl-tier';

/**
 * The five columns, in order, for every full-management league.
 *
 * Load-bearing: the deck renders in THIS order regardless of the order a
 * league happens to declare its groups in, so a new league can't quietly ship
 * a different footer skeleton. Draft-only leagues declare their own groups
 * (see BEST_BALL_COLUMNS) and are exempt.
 */
export const DECK_COLUMNS = [
  'My Team',
  'This Week',
  'Front Office',
  'Record Book',
  'League Office',
] as const;

export type DeckColumn = (typeof DECK_COLUMNS)[number];

/** A footer link: a directory id, optionally relabelled for the footer. */
export interface FooterLink {
  /** `page-directory.json` id. Omitted for planned pages that have no entry. */
  id?: string;
  /** Footer-specific label. Defaults to the directory entry's title. */
  label?: string;
  /**
   * Explicit path, for query-string variants the directory has no entry for
   * (e.g. the Premier League view of the AFL standings table).
   */
  path?: string;
  /**
   * A page that is planned but not built. Rendered as inert text with a
   * "soon" marker — never as a link, since there is nowhere to go yet.
   */
  soon?: boolean;
}

type ColumnMap = Partial<Record<string, ReadonlyArray<FooterLink | string>>>;

const link = (entry: FooterLink | string): FooterLink =>
  typeof entry === 'string' ? { id: entry } : entry;

/**
 * The all-play standings view renders BOTH tiers on one page, so Premier
 * League and D-League share a destination and differ only by label.
 */
export const AFL_ALL_PLAY_PATH = '/afl-fantasy/standings?view=all_play';

/**
 * Which league a `page-directory.json` path belongs to.
 *
 * Directory paths are inconsistently prefixed by design: AFL and best-ball
 * entries carry their own prefix, and everything else — whether written
 * `/theleague/lineup` or bare `/rosters` — is TheLeague's. A BARE path is NOT
 * "shared": `/league-comparison` and `/search` are TheLeague-only routes, and
 * re-prefixing them for another league produces a guaranteed 404.
 *
 * Applied to the curated deck as well as Deep Cuts. The deck is hand-written,
 * so in principle it should never list a foreign id — but a 404 in the footer
 * ships on every page, and `tests/footer-links.test.ts` resolves every link
 * against src/pages/ to make sure neither path regresses.
 */
export function pathBelongsToLeague(
  path: string,
  slug: CanonicalLeagueSlug
): boolean {
  if (path.startsWith('/afl-fantasy')) return slug === 'afl-fantasy';
  if (path.startsWith('/best-ball-1')) return slug === 'best-ball-1';
  return slug === 'theleague';
}

/**
 * Name the all-play link after the tier the viewer actually plays in.
 *
 * Premier League is the default — for signed-out visitors, for anyone whose
 * franchise isn't in the tier history, and for every Premier League owner. A
 * D-League owner sees "D-League" instead, because sending them to a link named
 * after a table they aren't in is the kind of small wrongness that makes a
 * footer feel generic.
 *
 * `franchiseId` is the signed JWT session only. Browsing as another team does
 * NOT relabel the link — the tier follows who you are, not who you're looking
 * at, so the label can't flicker as you click around other franchises.
 *
 * Reads getCurrentTierMembership() rather than keying off getCurrentSeasonYear():
 * the season year rolls at Labor Day, but tier membership is written per season
 * and rolled forward when a season completes. Between those two moments there
 * is no row for the current season year, so a year-keyed lookup returns null
 * and silently labels every D-League owner "Premier League".
 *
 * KNOWN GAP: two AFL pages (players, draft-predictor) set prerender = true, so
 * there is no request at build time and this falls back to the default there.
 * A D-League owner sees "D-League" everywhere except those two pages. Fixing it
 * would mean making them SSR, which is a bigger call than a link label.
 */
function applyTierLabel(
  columns: FooterColumn[],
  franchiseId: string | null
): FooterColumn[] {
  if (!franchiseId) return columns;
  const tier = getCurrentTierMembership()?.[franchiseId] ?? null;
  if (tier !== D_LEAGUE) return columns;
  return columns.map((col) => ({
    ...col,
    links: col.links.map((l) =>
      l.path === AFL_ALL_PLAY_PATH ? { ...l, label: D_LEAGUE } : l
    ),
  }));
}

/**
 * TheLeague — the full 40-link set. Directory ids, not paths.
 */
const THELEAGUE_COLUMNS: ColumnMap = {
  'My Team': [
    'lineup',
    'rosters',
    'coach-tab',
    'contracts-manage',
    'franchise-tags',
    'trade-builder',
    'league-planner',
    'import-rankings',
    'notifications',
  ],
  'This Week': [
    'live-scoring',
    'standings',
    'playoffs',
    'free-agents',
    { id: 'schedule-strength', label: 'The Gauntlet' },
    'calendar',
    'draft-order',
    'draft-room',
    'mock-draft',
  ],
  'Front Office': [
    'salary-analytics',
    'salary-history',
    'salary-archive',
    'projected-free-agents',
    { id: 'contract-calculator', label: 'Contract Tools' },
    'dead-money',
    'league-comparison',
  ],
  'Record Book': [
    'stats',
    'franchises',
    'owners',
    'rivalries',
    'pecking-order',
    'mvp',
    'league-summary',
    'owner-activity',
  ],
  'League Office': [
    { id: 'rules', label: 'Constitution' },
    'rules-chat',
    { id: 'news', label: 'Schefter Report' },
    'schefter-tip',
    'schefter-style-book',
    { id: 'suggestions', label: 'The Board' },
    'whats-new',
    'about',
  ],
};

/**
 * AFL — same five headers, its own links.
 *
 * AFL runs contracts:false / salaryCap:false, so none of TheLeague's Front
 * Office pages exist here; its Front Office is the league-wide tools instead.
 * One entry is `soon` — a page Brandon is building.
 */
const AFL_COLUMNS: ColumnMap = {
  'My Team': [
    'afl-lineup',
    'afl-rosters',
    'afl-keepers',
    'afl-trade-builder',
    { id: 'afl-notifications', label: 'Notifications' },
  ],
  'This Week': [
    'afl-standings',
    // No directory entry for the all-play view; it's a query variant. The
    // label is rewritten per viewer by applyTierLabel() below.
    { label: PREMIER_LEAGUE, path: AFL_ALL_PLAY_PATH },
    'afl-playoffs',
    'afl-players',
    'afl-calendar',
  ],
  'Front Office': [
    'afl-draft-predictor',
    'afl-keeper-analysis',
    { id: 'afl-schedule-strength', label: 'The Gauntlet' },
    // NO league-comparison: it lives at the bare path /league-comparison, which
    // is TheLeague-only, and it is a salary-cap tool — AFL runs salaryCap:false.
    // Prefixing it produced a 404 at /afl-fantasy/league-comparison.
  ],
  'Record Book': [
    { label: 'Championship History', soon: true },
    { id: 'afl-franchises', label: 'Franchises' },
    { id: 'afl-owners', label: 'Owners' },
    { id: 'afl-owner-activity', label: 'Owner Activity' },
  ],
  'League Office': [
    'afl-rules',
    { id: 'afl-rules-chat', label: 'Ask Roger' },
    'afl-news',
    { id: 'afl-schefter-tip', label: 'Tip Schefter' },
    { id: 'afl-schefter-style-book', label: 'The Style Book' },
    'afl-whats-new',
    { id: 'afl-about', label: 'About' },
  ],
};

/**
 * Best Ball — draft-only, so it gets its own two groups rather than the five
 * management columns. Nav for these leagues is opt-in by design.
 */
const BEST_BALL_COLUMNS: ColumnMap = {
  'The Draft': [
    { id: 'bb1-draft-room', label: 'Draft Room' },
    { id: 'bb1-draft-board', label: 'Draft Board' },
    { id: 'bb1-mock-draft', label: 'Mock Drafts' },
    { id: 'bb1-import-rankings', label: 'Import Rankings' },
  ],
  League: [
    { id: 'bb1-rosters', label: 'Rosters' },
    { id: 'bb1-live-scoring', label: 'Live Scoring' },
    { id: 'bb1-rules', label: 'Rules' },
    { id: 'bb1-whats-new', label: "What's New" },
  ],
};

const BY_LEAGUE: Record<CanonicalLeagueSlug, ColumnMap> = {
  theleague: THELEAGUE_COLUMNS,
  'afl-fantasy': AFL_COLUMNS,
  'best-ball-1': BEST_BALL_COLUMNS,
};

export interface DirectoryEntry {
  id: string;
  title: string;
  path: string;
  visibility: string;
  popularity: number;
}

const DIRECTORY = pageDirectory as DirectoryEntry[];
const DIR_BY_ID = new Map(DIRECTORY.map((e) => [e.id, e]));

/** A resolved footer link, ready to render. */
export interface ResolvedFooterLink {
  label: string;
  /** null for planned pages, which render as inert text. */
  path: string | null;
  soon: boolean;
}

export interface FooterColumn {
  title: string;
  links: ResolvedFooterLink[];
}

/**
 * The footer's columns for a league, in canonical order.
 *
 * Ids with no directory entry are dropped rather than rendered as dead links —
 * a page removed from the directory disappears from the footer instead of
 * 404ing. Admin-only pages are dropped too; the footer's admin affordances
 * live in the utility bar, which the component gates separately.
 */
export function getFooterColumns(
  slug: CanonicalLeagueSlug,
  franchiseId: string | null = null
): FooterColumn[] {
  const map = BY_LEAGUE[slug] ?? {};
  const declared = Object.keys(map);

  // Canonical order first, then anything a league declares that isn't one of
  // the five (best-ball's draft groups) in its own declared order.
  const ordered = [
    ...DECK_COLUMNS.filter((c) => declared.includes(c)),
    ...declared.filter((c) => !(DECK_COLUMNS as readonly string[]).includes(c)),
  ];

  const columns = ordered
    .map((title) => ({
      title,
      links: (map[title] ?? [])
        .map(link)
        .map((l) => {
          // Planned pages have no destination yet; render inert.
          if (l.soon) return { label: l.label ?? l.id ?? '', path: null, soon: true };
          if (l.path) return { label: l.label ?? l.path, path: l.path, soon: false };
          const entry = l.id ? DIR_BY_ID.get(l.id) : undefined;
          if (!entry || entry.visibility !== 'all') return null;
          // Backstop against listing another league's route (see
          // pathBelongsToLeague) — prefixing one 404s.
          if (!pathBelongsToLeague(entry.path, slug)) return null;
          return { label: l.label ?? entry.title, path: entry.path, soon: false };
        })
        .filter((l): l is ResolvedFooterLink => l !== null),
    }))
    .filter((col) => col.links.length > 0);

  return slug === 'afl-fantasy' ? applyTierLabel(columns, franchiseId) : columns;
}

/**
 * Deep Cuts: public pages the footer doesn't already link, surfaced by rule so
 * nobody has to remember to add a footer link for a low-traffic page.
 *
 * Deliberately deduped against the deck above it — without that filter the row
 * repeats links that are already on screen, and on a small league every
 * candidate is already linked, so the row is empty and simply doesn't render.
 */
export function getDeepCuts(
  slug: CanonicalLeagueSlug,
  columns: FooterColumn[],
  limit = 6
): ResolvedFooterLink[] {
  const linked = new Set(columns.map((c) => c.links.map((l) => l.path)).flat());
  // Search already sits in the utility bar; repeating it here reads as a bug.
  const UTILITY_PATHS = new Set(['/search']);

  return DIRECTORY.filter((e) => {
    if (e.visibility !== 'all') return false;
    if (e.popularity > 20) return false;
    if (linked.has(e.path)) return false;
    if (UTILITY_PATHS.has(e.path)) return false;
    if (!pathBelongsToLeague(e.path, slug)) return false;
    return true;
  })
    .sort((a, b) => b.popularity - a.popularity || a.title.localeCompare(b.title))
    .slice(0, limit)
    // Directory titles carry a league suffix to disambiguate duplicates
    // ("Asset Browser (AFL)"); the footer is already league-scoped, so drop it.
    .map((e) => ({
      label: e.title.replace(/\s*\((?:AFL|Best Ball)\)$/i, ''),
      path: e.path,
      soon: false,
    }));
}
