/**
 * The Schefter Report rail — the compact feed in the homepage sidebar.
 *
 * This is the feed most owners actually read: it is on the page they land on,
 * where /news is a click away. So the in-season "For You" split belongs here,
 * and it uses the SAME predicate as the full page (`postIsForViewer`) so the
 * two can never disagree about what counts as yours.
 *
 * The rail has no room for the page's seven tabs, so it carries two — For You
 * and All — switched on the client. That shape drives the whole design here:
 *
 * - **One list, not two.** Both tabs read the same rendered items, filtered by
 *   a `data-foryou` flag. Rendering two lists would double the server-side
 *   reactions pipeline and the DOM for a sidebar.
 * - **Every personal post survives the cut.** The list is built personal-first
 *   and then topped up with the newest league posts, rather than taking the
 *   newest N and filtering. The homepages used to slice to 30 before handing
 *   the rail anything; filtering THAT to one roster leaves almost nothing,
 *   because the newest posts are overwhelmingly wire.
 * - **No personal posts means no tabs.** A "For You" tab that opens empty is
 *   worse than not offering one, and unlike the full page there is no obvious
 *   way back. `personalized` is false and the rail renders exactly as before.
 * - **Offseason and signed-out are untouched**, which is the point of the date
 *   switch.
 */

import type { LeagueDefinition } from '../config/leagues';
import type { AuthUser } from './auth';
import { franchiseIdForLeague } from './auth';
import type { SchefterPost } from '../types/schefter';
import { getLeagueYearForSlug } from './league-year';
import { resolveFeedMode, type FeedMode } from './schefter-season-mode';
import { resolveWatchingSets, matchPosts, postIsForViewer } from './schefter-watching';

export interface SchefterRailView {
  /** What the rail renders — For You items plus the newest league posts. */
  posts: SchefterPost[];
  /** Ids of the posts the For You tab keeps. Empty when not personalized. */
  forYouIds: string[];
  /** Post id → the watched players it names, for the compact chip. */
  watchingByPost: ReturnType<typeof matchPosts>;
  mode: FeedMode;
  /** True only when the rail should offer the For You / All tabs. */
  personalized: boolean;
}

export interface ResolveRailOptions {
  league: LeagueDefinition;
  /** The WHOLE feed, newest first — not a pre-sliced window. */
  posts: SchefterPost[];
  authUser: AuthUser | null;
  /** How many posts the rail renders in total. */
  limit?: number;
  /** Clock override; callers pass `?testDate=` where they already parse one. */
  now?: Date;
}

const byNewest = (a: SchefterPost, b: SchefterPost) =>
  new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();

export async function resolveSchefterRail(opts: ResolveRailOptions): Promise<SchefterRailView> {
  const { league, posts, authUser, limit = 30, now = new Date() } = opts;
  const mode = resolveFeedMode(now);

  // Both leagues have a franchise 0001, so this must go through
  // franchiseIdForLeague — never a bare franchiseId compare.
  const franchiseId = franchiseIdForLeague(authUser, league.id);

  const plain: SchefterRailView = {
    posts: posts.slice(0, limit),
    forYouIds: [],
    watchingByPost: {},
    mode,
    personalized: false,
  };

  if (mode !== 'in-season' || !franchiseId) return plain;

  const year = getLeagueYearForSlug(league.slug);
  const sets = await resolveWatchingSets(league, year, franchiseId);
  const mine = posts.filter((p) => postIsForViewer(p, sets, franchiseId)).slice(0, limit);

  // Nothing of yours has moved. Offer no tab rather than an empty one.
  if (mine.length === 0) return plain;

  // Personal posts first, then the newest league posts fill the rest of the
  // rail — so the All tab still reads as the league feed while every For You
  // item is guaranteed present.
  const mineIds = new Set(mine.map((p) => p.id));
  const filler = posts.filter((p) => !mineIds.has(p.id)).slice(0, Math.max(0, limit - mine.length));

  return {
    posts: [...mine, ...filler].sort(byNewest),
    forYouIds: [...mineIds],
    watchingByPost: matchPosts(mine, sets, year),
    mode,
    personalized: true,
  };
}
