/**
 * The Schefter Report news page, resolved.
 *
 * Both leagues render the same feed page. Before Sep 2026 they rendered it
 * from two forked route files (663 lines vs 247) whose tab lists, watching
 * logic and rail markup had already drifted apart — the AFL copy had lost
 * five of the seven tabs and duplicated the rail CSS verbatim. Everything that
 * is genuinely the same now lives here and in SchefterNewsPage.astro; the
 * routes keep only what cannot move.
 *
 * What stays in the ROUTE, and why:
 * - **The feed import.** The two feeds sit at different roots (one bundled
 *   under src/data/, one at the repo-root data/), and a static import
 *   specifier cannot be a runtime variable.
 * - **Anything league-specific the page decorates itself with** — the GroupMe
 *   chat lane and the hottest-desks rail widget are TheLeague's alone, so the
 *   route fetches them and passes them in. That keeps league literals out of
 *   shared code, which `tests/league-literal-guard.test.ts` enforces.
 * - **Any auth redirect.** This page has none today (it renders for
 *   logged-out visitors), but if one is ever added it belongs in the route:
 *   `Astro.redirect()` from a component's frontmatter returns a blank 200
 *   rather than a bounce.
 */

import type { LeagueDefinition } from '../config/leagues';
import type { AuthUser } from './auth';
import { franchiseIdForLeague } from './auth';
import type { SchefterPost, SchefterFeed as FeedType, SchefterAuthor } from '../types/schefter';
import { getAuthor, getAuthorAvatar, SCHEFTER_AUTHORS } from '../types/schefter';
import { getLeagueYearForSlug } from './league-year';
import { resolveWatchingSets, matchPosts, postMentionsAny } from './schefter-watching';
import { buildSchefterPostOg, isValidSchefterPostId } from './schefter-feed';

export const VALID_SOURCES = [
  'theleague',
  'nfl',
  'draft',
  'insider',
  'groupme',
  'watching',
] as const;
export type SourceFilter = (typeof VALID_SOURCES)[number];

/**
 * Old query values that must keep resolving — these URLs are in GroupMe
 * history and in owners' bookmarks.
 */
const LEGACY_ALIASES: Record<string, SourceFilter> = {
  claude: 'theleague',
  events: 'theleague',
  wire: 'nfl',
  injuries: 'insider',
  odds: 'insider',
};

const DRAFT_AUTHOR_IDS = new Set(['nfl-draft']);
const INSIDER_AUTHOR_IDS = new Set(['doc-rivers', 'vegas-vic']);
const NFL_EXCLUDE_IDS = new Set([...DRAFT_AUTHOR_IDS, ...INSIDER_AUTHOR_IDS]);

/** ESPN contributors, minus the personas that have their own tab. */
const ESPN_AUTHOR_IDS = new Set(
  Object.values(SCHEFTER_AUTHORS)
    .filter((a) => a.external && !NFL_EXCLUDE_IDS.has(a.id))
    .map((a) => a.id),
);

/** Which persona heads each tab. "All" is Claude's page. */
const SOURCE_AUTHOR_MAP: Record<string, string> = {
  theleague: 'roger',
  nfl: 'nfl-wire',
  draft: 'nfl-draft',
  insider: 'nfl-insider',
};

export interface NewsTab {
  label: string;
  href: string;
  active: boolean;
  /** Renders the eye icon and the accent treatment. */
  watching?: boolean;
}

export interface SchefterNewsView {
  activeSource: SourceFilter | null;
  tabs: NewsTab[];
  basePath: string;
  posts: SchefterPost[];
  /** Post id → the watched players it names, for the card's chip. */
  watchingByPost: ReturnType<typeof matchPosts>;
  /** Claude's own articles, newest first, for the rail. */
  featuredArticles: SchefterPost[];
  emptyText?: string;
  profileAuthor: SchefterAuthor;
  profileAvatar: string;
  isGroupMeTab: boolean;
  isWatchingTab: boolean;
  canWatch: boolean;
  userFranchiseId: string | undefined;
  og: ReturnType<typeof buildSchefterPostOg> | undefined;
}

export interface ResolveNewsViewOptions {
  league: LeagueDefinition;
  feed: FeedType;
  authUser: AuthUser | null;
  url: URL;
  /**
   * GroupMe posts, already fetched by the route. A league without a group
   * chat passes nothing and gets no Group Chat tab.
   */
  groupMePosts?: SchefterPost[];
  hasGroupChat?: boolean;
  /**
   * Optional post-filter hook (TheLeague uses it for Open Graph enrichment of
   * GroupMe links). Runs on the filtered list; failures are the caller's to
   * swallow.
   */
  enrichPosts?: (posts: SchefterPost[]) => Promise<void>;
}

export async function resolveSchefterNewsView(
  opts: ResolveNewsViewOptions,
): Promise<SchefterNewsView> {
  const { league, feed, authUser, url, groupMePosts = [], hasGroupChat = false, enrichPosts } = opts;

  const isAuthenticated = !!authUser;
  const basePath = `/${league.slug}/news`;

  // Watching is league-scoped like everything else here: a session from the
  // other league has no list on this page. Both leagues have a franchise
  // 0001, so this must go through franchiseIdForLeague, never a bare compare.
  const watchFranchiseId = franchiseIdForLeague(authUser, league.id);
  const canWatch = !!watchFranchiseId;
  const watchYear = getLeagueYearForSlug(league.slug);
  const watchingSets = await resolveWatchingSets(league, watchYear, watchFranchiseId);

  const sourceParam = url.searchParams.get('source');
  const resolvedSource = LEGACY_ALIASES[sourceParam ?? ''] ?? sourceParam;
  const activeSource: SourceFilter | null =
    VALID_SOURCES.includes(resolvedSource as SourceFilter) &&
    // Watching is only a tab for a viewer with a list; anyone else following a
    // shared ?source=watching link lands on All rather than on an empty feed.
    !(resolvedSource === 'watching' && !canWatch) &&
    !(resolvedSource === 'groupme' && !hasGroupChat)
      ? (resolvedSource as SourceFilter)
      : null;

  // ONE predicate per source, shared by the filter and the tab list — so a tab
  // can never disagree with what clicking it shows. `null` (the All tab) and
  // the two account-scoped sources are handled outside the map.
  const PREDICATES: Record<
    Exclude<SourceFilter, 'groupme' | 'watching'>,
    (p: SchefterPost) => boolean
  > = {
    theleague: (p) => {
      const authorId = p.authorId ?? 'claude';
      return authorId === 'claude' || authorId === 'roger';
    },
    nfl: (p) => {
      const authorId = p.authorId ?? '';
      return (
        (ESPN_AUTHOR_IDS.has(authorId) || p.id.startsWith('wire_')) &&
        !DRAFT_AUTHOR_IDS.has(authorId)
      );
    },
    draft: (p) => p.authorId === 'nfl-draft',
    insider: (p) => INSIDER_AUTHOR_IDS.has(p.authorId ?? ''),
  };

  const posts = ((): SchefterPost[] => {
    if (activeSource === 'groupme') return groupMePosts;
    if (activeSource === 'watching') {
      if (!canWatch) return [];
      return feed.posts.filter((p) => postMentionsAny(p, watchingSets.all));
    }
    if (activeSource) return feed.posts.filter(PREDICATES[activeSource]);
    // "All": merge Schefter + GroupMe (when signed in), newest first.
    if (isAuthenticated && groupMePosts.length > 0) {
      return [...feed.posts, ...groupMePosts].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
    }
    return feed.posts;
  })();

  /**
   * A source earns a tab only when the feed actually carries a post for it.
   * Both leagues shipped an always-empty "NFL Insider" tab for months because
   * the tab list was hand-written next to the filter rather than derived from
   * it; the injuries/odds lanes have produced nothing yet. Deriving it means
   * the tab appears on its own the day that lane writes its first post, and
   * the AFL stops being a hardcoded two-tab special case.
   */
  const hasPostsFor = (source: keyof typeof PREDICATES): boolean =>
    feed.posts.some(PREDICATES[source]);

  if (enrichPosts) await enrichPosts(posts);

  // Every tab highlights a post about a watched player; the Watching tab is
  // that highlight applied as a filter.
  const watchingByPost = matchPosts(posts, watchingSets, watchYear);
  const isWatchingTab = activeSource === 'watching';
  const isGroupMeTab = activeSource === 'groupme';

  // Claude's own articles for the rail — always drawn from the WHOLE feed, not
  // the filtered list, so the rail does not empty out on a narrow tab.
  const featuredArticles = feed.posts
    .filter((p) => p.type === 'article' && (p.authorId === 'claude' || p.authorId === 'claude-schefter'))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);

  const profileAuthorId =
    activeSource && activeSource !== 'groupme' ? (SOURCE_AUTHOR_MAP[activeSource] ?? 'claude') : 'claude';
  const profileAuthor = getAuthor(profileAuthorId);

  // Per-post OG meta: deep links carry ?post=<id> so unfurlers (which strip
  // the #post-<id> anchor) still resolve a per-post title + composite image.
  const ogPostId = url.searchParams.get('post');
  const ogPost =
    ogPostId && isValidSchefterPostId(ogPostId)
      ? feed.posts.find((p) => p.id === ogPostId)
      : undefined;

  const tabs: NewsTab[] = [
    { label: 'All', href: basePath, active: !activeSource },
    ...(canWatch
      ? [
          {
            label: 'Watching',
            href: `${basePath}?source=watching`,
            active: isWatchingTab,
            watching: true,
          },
        ]
      : []),
    ...(hasPostsFor('theleague')
      ? [{ label: 'The League', href: `${basePath}?source=theleague`, active: activeSource === 'theleague' }]
      : []),
    ...(hasGroupChat && isAuthenticated
      ? [{ label: 'Group Chat', href: `${basePath}?source=groupme`, active: isGroupMeTab }]
      : []),
    ...(hasPostsFor('nfl')
      ? [{ label: 'NFL', href: `${basePath}?source=nfl`, active: activeSource === 'nfl' }]
      : []),
    ...(hasPostsFor('draft')
      ? [{ label: 'NFL Draft', href: `${basePath}?source=draft`, active: activeSource === 'draft' }]
      : []),
    ...(hasPostsFor('insider')
      ? [{ label: 'NFL Insider', href: `${basePath}?source=insider`, active: activeSource === 'insider' }]
      : []),
  ];

  return {
    activeSource,
    tabs,
    basePath,
    posts,
    watchingByPost,
    featuredArticles,
    emptyText: isWatchingTab
      ? watchingSets.all.size === 0
        ? 'Nothing to watch yet. Use the ⋮ button on any player — free agents, rosters, custom rankings — to build your watch list.'
        : 'No news on your players or your watch list yet. Schefter is on it.'
      : undefined,
    profileAuthor,
    profileAvatar: getAuthorAvatar(profileAuthor),
    isGroupMeTab,
    isWatchingTab,
    canWatch,
    userFranchiseId: watchFranchiseId ?? undefined,
    // Cast: buildSchefterPostOg only names the two leagues that HAVE a feed.
    // best-ball-1 carries `schefterFeed: false`, so it never renders this page.
    og: ogPost
      ? buildSchefterPostOg(ogPost, url, league.slug as 'theleague' | 'afl-fantasy')
      : undefined,
  };
}
