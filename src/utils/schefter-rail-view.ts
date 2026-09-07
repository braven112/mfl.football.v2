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
 * Past both gates the rail carries For You / All tabs. ONE rendered list backs
 * both, filtered by a `data-foryou` flag — rendering two lists would mean two
 * reactions pipelines for a sidebar.
 *
 * That list is the UNION of the two tabs' contents, not a single capped slice.
 * The first cut took `limit` personal posts and topped up with league news
 * "if there was room" — and for an owner with `limit` or more of their own,
 * there never was, so All showed exactly what For You showed and the tabs
 * looked broken. Each tab now gets its own `limit` worth, deduped; the rail
 * renders at most `2 * limit` and each tab still fills.
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
import { resolveWatchingSets, matchPosts, postIsForViewer, isPostVisibleTo } from './schefter-watching';
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

  const franchiseId = franchiseIdForLeague(authUser, league.id);
  // Another franchise's assistant nudges are not this reader's business.
  // Declared before `plain`, which reads it — the other order is a temporal
  // dead zone that throws on the very first call.
  const readable = posts.filter((p) => isPostVisibleTo(p, franchiseId));

  const plain: SchefterRailView = {
    posts: readable.slice(0, limit),
    forYouIds: [],
    watchingByPost: {},
    personalized: false,
  };

  if (!franchiseId || resolveFeedMode(now) !== 'in-season') return plain;

  const year = getLeagueYearForSlug(league.slug);
  const sets = await resolveWatchingSets(league, year, franchiseId);
  const mine = readable.filter((p) => postIsForViewer(p, sets, franchiseId)).slice(0, limit);

  // Nothing of yours has moved — offer no tab rather than an empty one.
  if (mine.length === 0) return plain;

  // Each tab gets a full `limit` of its own. Union them so All is genuinely the
  // league feed even when the owner's own posts would have filled the rail.
  const mineIds = new Set(mine.map((p) => p.id));
  const leagueFill = readable.filter((p) => !mineIds.has(p.id)).slice(0, limit);

  return {
    posts: [...mine, ...leagueFill].sort(
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
