/**
 * The homepage's half of the shared hero: everything a route has to read off
 * disk, Redis or the session before the (pure, synchronous) resolver can run,
 * and the casting it does after. One implementation, so a league's homepage
 * is a call with its own feeds rather than a copy of another league's page.
 *
 * What stays in the ROUTE, and why: the feeds themselves. A static
 * `import.meta.glob` / `import` specifier cannot be a runtime variable, so each
 * route brings its own league's calendar, news feed and config (the same split
 * as every thin route wrapper — see CLAUDE.md "Second league's copy of a
 * page"). Cookies are only ever READ here; a preference is never written from
 * anywhere but the route.
 */
import type { AstroCookies } from 'astro';
import type { LeagueDefinition } from '../../config/leagues';
import { leagueClock } from '../../config/leagues';
import type { WhatsNewEntry } from '../../types/whats-new';
import type { ResolvedLeagueEvent, WhatsNextTimeline } from '../../types/league-events';
import { getAuthor, getAuthorAvatar, type SchefterPost } from '../../types/schefter';
import { getRelease } from '../schedule-release-store';
import { isSaturdayEveningPT } from '../sunday-ticket-window';
import { hasSubmittedLineup } from '../lineup-submitted';
import { getCurrentNFLWeek } from '../current-week';
import { getCurrentSeasonYear } from '../league-year';
import { getWeekInTheBooks, getOwnersByPlayer } from '../offseason-hero-data';
import { resolveRecapDestination } from '../hero-recap-destination';
import { resolveWaiverWindow } from '../waiver-window';
import { waiverDeadlineCopy } from '../waiver-deadline-copy';
import { readViewerClock } from '../viewer-preferences-page';
import { pickLatestArticle, type LatestArticle } from '../article-hero-view';
import { postByline } from '../persona-server';
import { resolveHeroFranchiseAccent } from '../hero-franchise-accent';
import type { PreferenceOwner } from '../viewer-preferences-page';
import { castLeagueHeroModel } from './casting';
import { resolveLeagueHeroState } from './resolver';
import { getLeagueHeroProfile, heroPath } from './profiles';
import type { LeagueHeroState, PeckingOrderHeroIssue } from './types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface LeagueHomeHeroInput {
  league: LeagueDefinition;
  effectiveDate: Date;
  testMode: boolean;
  cookies: Pick<AstroCookies, 'get'>;
  /** The signed-in user (any league) — for the viewer's clock. */
  authUser: PreferenceOwner | null | undefined;
  /**
   * The SIGNED-IN owner's franchise in this league (`franchiseIdForLeague`).
   * Drives the lineup read and the franchise accent: a hero painted in
   * someone's colours rests on having signed in, never on a query param.
   */
  authFranchiseId?: string | null;
  /**
   * The franchise the hero casts FOR — the signed-in owner, or on a league
   * with a team picker the browsed team (`?myteam=` / cookie).
   */
  castFranchiseId?: string;
  /** The viewer's pool and tier, as the page resolved them (same source as `castFranchiseId`). */
  userPoolId?: string;
  userTier?: string;
  /** Resolves a franchise to its player pool, for pool-scoped accents. */
  poolOf?: (franchiseId: string) => string | null;
  /** The league's news feed (static import in the route). */
  posts: SchefterPost[];
  /** MFL's calendar export for the league year whose waivers are running (for the waiver copy). */
  waiverCalendar: unknown[];
  /** The league year whose rosters are live. */
  leagueYear: number;
  /** A calendar built from disk (package leagues); omitted, the profile loads its own. */
  events?: ResolvedLeagueEvent[];
  timeline?: WhatsNextTimeline;
  whatsNewEntries: WhatsNewEntry[];
  /** The franchise leading the standings, for the Monday card's face. */
  standingsLeaderId?: string;
  /** THIS week's power-rankings issue, when the league runs one and it is out. */
  peckingOrder?: PeckingOrderHeroIssue;
  /**
   * Which feed posts are the league's weekly column. Absent, the league has no
   * column and the Wednesday slot stays the news card.
   */
  isColumn?: (post: SchefterPost) => boolean;
}

/** A post's byline, wearing the league's persona when the author is the league's own desk. */
async function bylined(league: LeagueDefinition, post: SchefterPost): Promise<LatestArticle> {
  const author = getAuthor(post.authorId);
  const byline = await postByline({ league: league.slug }, author, getAuthorAvatar(author));
  return { post, byline: { name: byline.name, avatar: byline.avatar } };
}

/**
 * Resolve, and cast, a league's homepage hero.
 *
 * The recap's YEAR is `getCurrentSeasonYear`, pointedly NOT a walked-back
 * display year: the two diverge from kickoff until the first week's results
 * land, and a recap that walked back would announce "Week 18 is in the books"
 * over last season's title game. With no week yet the recap degrades to the
 * news feed, which `resolveRecapDestination` already does.
 */
export async function resolveLeagueHomeHero(input: LeagueHomeHeroInput): Promise<LeagueHeroState> {
  const { league, effectiveDate } = input;
  const profile = getLeagueHeroProfile(league.slug);

  // Whether this season's reveal is already locked — read here so the
  // resolver stays synchronous and side-effect free.
  const scheduleReleaseRevealed = Boolean(await getRelease(league.slug, effectiveDate.getUTCFullYear()));

  // Saturday from 5pm: an owner whose lineup is already in gets the Sunday
  // Ticket hero instead of the lineup-lock reminder. One cached live read,
  // only in that window, and only for the SIGNED-IN owner — a browsed team is
  // not an owner. Only a league with the Sunday Ticket card asks.
  const lineupSubmitted =
    profile.facts.sundayTicket && input.authFranchiseId && isSaturdayEveningPT(effectiveDate)
      ? await hasSubmittedLineup({
          league,
          franchiseId: input.authFranchiseId,
          week: getCurrentNFLWeek(effectiveDate) ?? 1,
          leagueYear: input.leagueYear,
        })
      : null;

  // Where Tuesday's recap hero points — `getWeekInTheBooks`, NOT
  // `getCurrentNFLWeek`, which rolls to the UPCOMING week on the very morning
  // this slot runs (see hero-recap-destination.ts).
  const liveSeasonYear = getCurrentSeasonYear(effectiveDate);
  const resolvedRecap = resolveRecapDestination({
    league: league.slug,
    completedWeek: getWeekInTheBooks(liveSeasonYear, league.slug, effectiveDate),
  });
  // A league without the default destination (Top Players) names its own.
  const recapPage = profile.facts.recapPage;
  const recap =
    recapPage && resolvedRecap.week > 0
      ? { ...resolvedRecap, href: heroPath(league.slug)(recapPage.path), label: recapPage.label }
      : resolvedRecap;

  // The waiver deadline: DAY and HOUR from MFL's own calendar, never prose.
  // READ-only: a page render must never WRITE a preference cookie.
  const viewerClock = await readViewerClock(input.cookies as never, input.authUser, league.slug);
  const waiver = waiverDeadlineCopy(
    resolveWaiverWindow(input.waiverCalendar as never, effectiveDate, leagueClock(league.slug).zone),
    { now: effectiveDate, clock: viewerClock },
  );

  // The story the news slot promotes — bounded to the last week, so the slot
  // cannot promote a three-month-old article as this week's news. The byline
  // is the POST's own author; the house desk wears the league's persona.
  const latestPost = pickLatestArticle(input.posts, { now: effectiveDate, within: WEEK_MS });
  const article = latestPost ? await bylined(league, latestPost) : undefined;

  // The league's weekly column, when it runs one — the newest, this week.
  const columnPost = input.isColumn
    ? pickLatestArticle(input.posts.filter(input.isColumn), { now: effectiveDate, within: WEEK_MS })
    : null;
  const column = columnPost ? await bylined(league, columnPost) : undefined;

  const state = resolveLeagueHeroState({
    league: league.slug,
    referenceDate: effectiveDate,
    lineupSubmitted,
    testMode: input.testMode,
    whatsNewEntries: input.whatsNewEntries,
    timeline: input.timeline,
    events: input.events,
    userPoolId: input.userPoolId,
    userTier: input.userTier,
    scheduleReleaseRevealed,
    recap,
    waiver,
    article,
    peckingOrder: input.peckingOrder,
    column,
  });

  // Cast the composite model onto the view. Every state casts a semantically
  // relevant player; null (missing feeds) falls back to the view's webp art.
  if ('view' in state && state.view) {
    state.view.model = castLeagueHeroModel(state, {
      league: league.slug,
      referenceDate: effectiveDate,
      leagueYear: input.leagueYear,
      userFranchiseId: input.castFranchiseId,
      standingsLeaderId: input.standingsLeaderId,
      // The recap card captions its Top Scorer with `recap.week`, so the cast
      // is scoped to that week — and to the season it was derived from.
      recap: { seasonYear: liveSeasonYear, week: recap.week },
      // The news card promotes a specific story, so it casts that story's player.
      articlePlayerId: article?.post.heroPlayerId,
      columnPlayerId: column?.post.heroPlayerId,
      peckingOrderLeaderId: input.peckingOrder?.leader?.franchiseId,
    });
    // Tint the glow with the viewer's OWN franchise when their pool rosters
    // the cast player. Scoped to the viewer's pool because a duplicate-player
    // league rosters the same player in several; see hero-franchise-accent.ts.
    // The SIGNED-IN franchise's pool, never the browsed team's.
    const heroAccent = resolveHeroFranchiseAccent({
      playerId: state.view.model?.mflId,
      ownersByPlayer: state.view.model
        ? getOwnersByPlayer(input.leagueYear, league.slug, { activeOnly: false })
        : null,
      viewerConferenceId: input.authFranchiseId && input.poolOf ? input.poolOf(input.authFranchiseId) : null,
      conferenceOf: input.poolOf ?? (() => null),
      league: league.slug,
      // Only an OVERRIDE is meaningful here — the hero already falls back to
      // the player's NFL team on its own.
      fallback: '',
    });
    state.view.modelAccent = heroAccent.color || null;
    // The SAME franchise carries the crest, so the glow and the mark can never
    // disagree about whose hero this is.
    state.view.modelFranchiseId = heroAccent.franchiseId;
  }

  return state;
}
