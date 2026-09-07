/**
 * The Schefter Report rail — the compact feed in the homepage sidebar.
 *
 * For a signed-in owner the rail IS their Watching feed: news about players
 * they roster or watch, posts about their franchise, and league deadlines.
 * Same predicate as the /news Watching tab (`postIsForViewer`), so the two can
 * never disagree about what counts as yours.
 *
 * TWO gates:
 *
 * 1. **Signed in as an owner of THIS league.** A visitor with no franchise here
 *    has no watch list, so they get the league feed. Both leagues have a
 *    franchise 0001, so this goes through `franchiseIdForLeague`, never a bare
 *    id compare.
 * 2. **In season**, so the offseason keeps its league-wide filler. The window
 *    is `resolveFeedMode` (src/utils/schefter-season-mode.ts) — one definition
 *    shared with /news, so the two surfaces turn on together, and it opens on
 *    the NL draft rather than Labor Day.
 *
 * Past both gates the rail carries For You / All tabs. ONE list backs both,
 * filtered by a `data-foryou` flag — rendering two would double the
 * server-side reactions pipeline and the DOM for a sidebar. The list is built
 * personal-first and topped up with league news, so every For You item is
 * present and the All tab still reads as the league feed.
 *
 * Filter first, THEN slice. The homepages used to hand the rail
 * `feed.posts.slice(0, 30)`; filtering that to one roster leaves almost
 * nothing, because the newest posts are overwhelmingly wire.
 */

import type { LeagueDefinition } from '../config/leagues';
import type { AuthUser } from './auth';
import { franchiseIdForLeague } from './auth';
import type { SchefterPost } from '../types/schefter';
import { getLeagueYearForSlug } from './league-year';
import { resolveWatchingSets, matchPosts, postIsForViewer } from './schefter-watching';
import { resolveFeedMode } from './schefter-season-mode';

export interface SchefterRailView {
  posts: SchefterPost[];
  /** Ids the For You tab keeps. Empty when the rail is not personalized. */
  forYouIds: string[];
  /** Post id → the watched players it names, for the card's chip. */
  watchingByPost: ReturnType<typeof matchPosts>;
  /** True when the rail should offer the For You / All tabs. */
  personalized: boolean;
  /** Empty-state copy for the For You tab. */
  emptyText?: string;
}

export interface ResolveRailOptions {
  league: LeagueDefinition;
  /** The WHOLE feed, newest first — not a pre-sliced window. */
  posts: SchefterPost[];
  authUser: AuthUser | null;
  /** How many posts the rail renders. */
  limit?: number;
  /** Clock override for tests. */
  now?: Date;
}

export async function resolveSchefterRail(opts: ResolveRailOptions): Promise<SchefterRailView> {
  const { league, posts, authUser, limit = 30, now = new Date() } = opts;

  const plain: SchefterRailView = {
    posts: posts.slice(0, limit),
    forYouIds: [],
    watchingByPost: {},
    personalized: false,
  };

  const franchiseId = franchiseIdForLeague(authUser, league.id);
  if (!franchiseId || resolveFeedMode(now) !== 'in-season') return plain;

  const year = getLeagueYearForSlug(league.slug);
  const sets = await resolveWatchingSets(league, year, franchiseId);
  const mine = posts.filter((p) => postIsForViewer(p, sets, franchiseId)).slice(0, limit);

  // Nothing of yours has moved — offer no tab rather than an empty one.
  if (mine.length === 0) return plain;

  // Personal first, then the newest league news fills the rest of the rail.
  const mineIds = new Set(mine.map((p) => p.id));
  const filler = posts.filter((p) => !mineIds.has(p.id)).slice(0, Math.max(0, limit - mine.length));

  return {
    posts: [...mine, ...filler].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    ),
    forYouIds: [...mineIds],
    watchingByPost: matchPosts(mine, sets, year),
    personalized: true,
    // Say what to do about it. Silently showing the league feed instead would
    // put the wire noise back, which is the thing this rail exists to remove.
    emptyText:
      sets.all.size === 0
        ? 'Nothing to watch yet. Use the ⋮ button on any player to build your watch list — your own roster comes along automatically.'
        : 'Quiet on your guys right now. Tap View all for the rest of the league.',
  };
}
