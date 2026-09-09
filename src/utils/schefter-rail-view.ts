/**
 * The Schefter Report rail — the compact feed in the homepage sidebar.
 *
 * TWO tabs, and the split is about NOISE, not about ownership:
 *
 * - **My News** — everything that comes out of this league: every Schefter
 *   transaction post, recap and article, Roger's deadline reminders, the whole
 *   group chat, and anything naming a player the reader rosters or watches.
 *   It is the same content as `/news?source=theleague` plus the Group Chat
 *   tab, with the reader's own players flagged by the card's watch chip.
 * - **All** — that, plus the NFL wire and the NFL Draft lane.
 *
 * It used to be narrower: My News was the /news Watching tab exactly
 * (`postIsForViewer`), so a trade between two other franchises — the most
 * league-news thing there is — was filed under "All" next to an ESPN injury
 * blurb, and the group chat only surfaced the reader's OWN messages. The lane
 * predicates now come from `schefter-sources.ts`, shared with /news, so "what
 * counts as league news" has one definition across both surfaces.
 *
 * TWO gates before the tabs appear at all:
 *
 * 1. **Signed in as an owner of THIS league.** A visitor with no franchise here
 *    gets the league feed unsplit. Both leagues have a franchise 0001, so this
 *    goes through `franchiseIdForLeague`, never a bare id compare.
 * 2. **In season**, so the offseason keeps its league-wide filler. The window
 *    is `resolveFeedMode` (src/utils/schefter-season-mode.ts) — one definition
 *    shared with /news, so the two surfaces turn on together, and it opens on
 *    the NL draft rather than Labor Day.
 *
 * Past both gates the rail carries the tabs. ONE rendered list backs both,
 * filtered by a `data-foryou` flag — rendering two lists would mean two
 * reactions pipelines for a sidebar.
 *
 * That list is the UNION of the two tabs' contents, not a single capped slice.
 * The first cut took `limit` personal posts and topped up with league news
 * "if there was room" — and for an owner with `limit` or more of their own,
 * there never was, so All showed exactly what My News showed and the tabs
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
import { SOURCE_PREDICATES, isGroupMePost } from './schefter-sources';

export interface SchefterRailView {
  posts: SchefterPost[];
  /** Ids the My News tab keeps. Empty when the rail is not personalized. */
  forYouIds: string[];
  /** Post id → the watched players it names, for the card's chip. */
  watchingByPost: ReturnType<typeof matchPosts>;
  /** True when the rail should offer the My News / All tabs. */
  personalized: boolean;
  /** Empty-state copy for the My News tab. */
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

  // `now`, not the system clock — same reason as schefter-news-view: the rail
  // is rendered at other dates by /rollover-check, and a watch year off the
  // real clock silently pairs the requested season's mode with another
  // season's roster.
  const year = getLeagueYearForSlug(league.slug, now);
  const sets = await resolveWatchingSets(league, year, franchiseId);

  /**
   * What My News keeps. Three lanes, deliberately in this order:
   *
   * 1. The league's own desk — the same predicate `/news?source=theleague`
   *    filters on, so every transaction post lands here whoever it is about.
   * 2. The group chat, whole. Filtering it to the reader's own messages left
   *    them reading themselves talk.
   * 3. Anything personal that the first two miss: a wire item naming a player
   *    they roster or watch, and their own franchise-addressed nudges.
   *
   * What is left over for All is exactly the NFL wire and the NFL Draft lane.
   */
  const isMine = (p: SchefterPost): boolean =>
    SOURCE_PREDICATES.theleague(p) || isGroupMePost(p) || postIsForViewer(p, sets, franchiseId);

  const mine = readable.filter(isMine).slice(0, limit);

  // My News is empty — every lane of it — so offer no tab rather than an empty one.
  if (mine.length === 0) return plain;

  // Each tab gets a full `limit` of its own. Union them so All is genuinely the
  // league feed even when My News would have filled the rail on its own.
  const mineIds = new Set(mine.map((p) => p.id));
  const leagueFill = readable.filter((p) => !mineIds.has(p.id)).slice(0, limit);

  const rendered = [...mine, ...leagueFill].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return {
    posts: rendered,
    forYouIds: [...mineIds],
    // Every rendered post, not just My News: the watch chip is how a reader
    // spots one of their guys in the wire noise on the All tab, which is the
    // tab that carries the wire.
    watchingByPost: matchPosts(rendered, sets, year),
    personalized: true,
    // Fallback copy only. My News cannot actually be empty here — the guard
    // above returns `plain` when it is — so this exists for the client-side
    // tab-empty block and for any future caller that renders the view without
    // that guard. Worded for what the tab now IS (the league, not just your
    // guys), because the old "quiet on your guys" line described the tab this
    // one replaced.
    emptyText:
      sets.all.size === 0
        ? 'Nothing here yet. Use the ⋮ button on any player to build your watch list — your own roster comes along automatically.'
        : 'Quiet across the league right now. Tap All for the rest of football.',
  };
}
