/**
 * League Hero Casting — picks the composite model for any league's homepage hero.
 *
 * Maps every resolved LeagueHeroState to the SEMANTICALLY relevant player per
 * the hero casting rules (docs/claude/insights/features/player-composites.md):
 * the keeper cornerstone for the keeper deadline, the draft board's best
 * available for draft (or auction) week, a player actually on the trade block for the
 * trade window, the owner's own likely starter in the first game they play
 * on game days, the top waiver target on waiver day, the week's top scorer
 * for the recap, the #1 team's headliner for the power rankings, a rookie
 * for the new-season reset, and — for fresh What's
 * New features — ONLY the player the entry names (the feature's screenshot is
 * the art otherwise).
 * Signed-in owners see THEIR player wherever a roster-action pool includes
 * one; guests get a league-wide pick. The starter slots (kickoff, game-day,
 * live) never widen back to the league for a signed-in owner — see
 * `castRandomStarterModel`.
 *
 * Server-side only — reads the league's MFL feeds from disk via the
 * league-aware helpers in offseason-hero-data.ts. Ownership is a LIST
 * everywhere (a duplicate-player league rosters one player in several pools),
 * which those helpers and `castsFor` already honour. Returns null when no model resolves;
 * the hero then falls back to its existing (non-composite) player art.
 *
 * Bespoke phases (trade-deadline day, and the playoffs / championship week
 * of a league with a bracket hero) keep their own components and never cast
 * here.
 */

import type { CanonicalLeagueSlug } from '../../config/leagues';
import type { LeagueHeroState } from './types';
import type { HeroModel } from '../hero-casting';
import {
  castBestScoredModel,
  castFeaturedModel,
  castRandomStarterModel,
  castRookieModel,
  castRosterModel,
  castTopFreeAgentModel,
  castTopRosteredModel,
} from '../hero-casting';
import { getPlayerMap } from '../player-map';
import {
  getAdpRankedIds,
  getFranchiseCompositableHeadliners,
  getFranchiseHeadliners,
  getRosteredPlayerIds,
  getWeekGameCandidates,
  getTradeBaitCandidates,
  getWeeklyTopScorerCandidates,
} from '../offseason-hero-data';

export interface LeagueCastingInput {
  /** The league the hero belongs to. */
  league: CanonicalLeagueSlug;
  /** Drives daily rotation + rookie class ceiling. */
  referenceDate: Date;
  /** The league year whose rosters are live (getCurrentLeagueYear / the league's own rollover). */
  leagueYear: number;
  /** Signed-in owner's franchise id in THIS league — personalizes roster-action pools. */
  userFranchiseId?: string;
  /** Franchise currently leading the standings — for the Monday standings slot. */
  standingsLeaderId?: string;
  /**
   * The recap card's week, and the SEASON that week was derived from.
   *
   * Both halves matter. The recap slot captions a Top Scorer with a week, so
   * the cast has to come from that same week or the card puts one week's
   * numbers under another week's label. It also has to come from the same
   * SEASON: the caller derives the week from `getCurrentSeasonYear` (Labor Day
   * rollover) while this casting runs on `leagueYear` (the AFL's June 1 league
   * year). Those AGREE from Labor Day round to May 31 — measured, not assumed:
   * on 2027-03-15 both read 2026 — and DIVERGE from June 1 to Labor Day, when
   * the league year has advanced and the season year has not (2027-07-15 reads
   * leagueYear 2027, seasonYear 2026). Reading the week out of the `leagueYear`
   * feed would check one season's week against another season's rows. The recap
   * slot only runs inside the season, where they agree, so this is defensive —
   * but it is the half that stays correct if the slot's gating ever widens.
   *
   * Omitted, or a week of 0, means the caller cannot vouch for a week, and the
   * slot casts a generic headliner rather than a "Top Scorer" it cannot place.
   */
  recap?: { seasonYear: number; week: number };
  /**
   * The player the news slot's article named in its body (`heroPlayerId`).
   *
   * The card now promotes a SPECIFIC story, so the face should be the one the
   * story is about — the same rule TheLeague's article hero has always used.
   * Absent (an article that named nobody, or the desk card), a franchise
   * headliner takes the flank, which is what this slot always cast.
   */
  articlePlayerId?: string;
  /** The franchise at #1 in the power-rankings issue the Tuesday slot promotes. */
  peckingOrderLeaderId?: string;
  /** The player the weekly column named, for Wednesday night's column slot. */
  columnPlayerId?: string;
}

/**
 * Cast the model for a league hero state. Every strategy falls back to the
 * franchise-headliner pool (each team's best projected player, daily
 * rotation) before giving up, so the hero composites whenever the feeds
 * hold ANY resolvable player.
 */
export function castLeagueHeroModel(state: LeagueHeroState, input: LeagueCastingInput): HeroModel | null {
  const { referenceDate, leagueYear, userFranchiseId, league } = input;
  // Player identity is global to MFL — theleague's players.json resolves every
  // league's ids (see player-composites.md), so getPlayerMap needs no league param.
  const players = getPlayerMap(leagueYear);
  if (players.size === 0) return null;

  // Feed-derived pools memoized for this invocation — the fallback ladder
  // (primary cast → headliner) would otherwise re-read the same feeds.
  let rosteredIds: Set<string> | null = null;
  const rostered = () => (rosteredIds ??= getRosteredPlayerIds(leagueYear, league));
  let headlinerPool: Array<{ playerId: string; franchiseId: string }> | null = null;
  const headliners = () => (headlinerPool ??= getFranchiseHeadliners(leagueYear, league));

  const headliner = (descriptor: string, franchiseId?: string): HeroModel | null => {
    let pool = headliners();
    if (franchiseId) pool = pool.filter((c) => c.franchiseId === franchiseId);
    return castRosterModel(pool, players, userFranchiseId, referenceDate, descriptor);
  };

  const bestAvailable = (descriptor: string): HeroModel | null => {
    // An empty roster set means the rosters feed is missing/unreadable (a
    // real league's rosters are never all empty) — ownership can't be trusted, so don't
    // claim anyone is "available". Callers fall back to headliner → webp.
    if (rostered().size === 0) return null;
    const model = castTopFreeAgentModel(
      players,
      referenceDate,
      rostered(),
      getAdpRankedIds(leagueYear, league),
    );
    return model ? { ...model, descriptor } : null;
  };

  // Starter slots cast from the signed-in owner's OWN roster, from whichever
  // of their players kicks off first (see castRandomStarterModel). The
  // fallback stays on their roster too — getFranchiseHeadliners returns each
  // team's top player compositable or not, so a DEF/photo-less headliner would
  // hand the hero to some other franchise, and castRosterModel widens on an
  // empty own pool.
  let compositableHeadlinerPool: Array<{ playerId: string; franchiseId: string }> | null = null;
  const ownRosterFallback = (descriptor: string): HeroModel | null => {
    const pool = (compositableHeadlinerPool ??= getFranchiseCompositableHeadliners(leagueYear, league));
    // Scope the pool BEFORE casting: castRosterModel widens to the league when
    // the owner's slice is empty, which is the behavior this ladder exists to
    // avoid. A signed-in owner gets their own player or no composite at all
    // (the hero then draws its static art) — never someone else's.
    // ...unless the id rosters nobody (a commissioner-style franchise absent
    // from the roster feed). That is a viewer, not an owner to protect from a
    // stranger, and scoping strictly would leave them with no hero at all.
    //
    // Ask that of the FULL headliner pool, which holds every franchise that
    // rosters anyone — `pool` here is the compositable subset, so a franchise
    // whose players all lack an ESPN cutout would read as rosterless and be
    // handed a stranger, the exact outcome this ladder exists to prevent.
    const rostersPlayers =
      !!userFranchiseId && headliners().some((c) => c.franchiseId === userFranchiseId);
    const scoped = rostersPlayers ? pool.filter((c) => c.franchiseId === userFranchiseId) : pool;
    const model = castRosterModel(scoped, players, userFranchiseId, referenceDate, descriptor);
    if (model || rostersPlayers) return model;
    return headliner(descriptor);
  };

  const gameStarter = (
    descriptor: string,
    laterGameDescriptor: string,
    offTierDescriptor: string,
  ): HeroModel | null =>
    castRandomStarterModel(
      getWeekGameCandidates(leagueYear, league, referenceDate),
      players,
      userFranchiseId,
      referenceDate,
      descriptor,
      8,
      laterGameDescriptor,
      offTierDescriptor,
    );

  const castSlot = (slot: string | undefined): HeroModel | null => {
    switch (slot) {
      case 'live-scoring':
        // Off-tier outranks later-game, so this caption has to be true at
        // any hour — 'In Action' is not (an off-tier pick can be Sunday's).
        return gameStarter('In Action', 'Up Next', 'On Your Roster') ?? ownRosterFallback('Headliner');
      case 'game-day-preview':
        return (
          gameStarter('Kickoff Starter', 'Your First Starter', 'On Your Roster') ??
          ownRosterFallback('Headliner')
        );
      case 'waiver-wire': {
        const model = bestAvailable('Top Target');
        return model ?? headliner('Headliner');
      }
      case 'pecking-order':
        // The power rankings are ABOUT the #1 team: its headliner leads.
        return input.peckingOrderLeaderId
          ? headliner('Top of the Order', input.peckingOrderLeaderId) ?? headliner('Headliner')
          : headliner('Headliner');
      case 'column':
        // The player the column is about, as the news card does.
        return (
          castFeaturedModel(input.columnPlayerId, players, 'In the Spotlight') ??
          headliner('Headliner')
        );
      case 'recap': {
        // Deterministic: the week's top scorer IS the recap's headline — but
        // it must be THAT week's scorer, out of THAT season's feed.
        //
        // This used to read `getWeeklyTopScorerCandidates(leagueYear, league)`
        // unfiltered. `playerScores.json` holds whichever single week MFL
        // currently considers live, so once MFL rolls it the card captioned
        // week N's top scorer as week N-1's. Scoping the read to the captioned
        // week means a disagreement casts nobody, and the ladder falls through
        // to a generic headliner instead of a confidently mislabelled card.
        //
        // THE TRADE-OFF, stated: this slot runs Tuesday before 2pm PT, which
        // is the window MFL rolls the feed in. If the roll ever lands BEFORE
        // the render, the capped week is N-1 while the feed holds only N, so
        // this casts nobody and the card wears a generic face every week —
        // there is no per-week archive to fall back to. That is still the
        // right outcome: a correct label over a generic face beats another
        // week's scorer under this week's. It is also not what happens today
        // — on Tue 2026-09-15 the feed held week 1 and the card captioned
        // week 1, and the page rendered a real Top Scorer.
        const scope = input.recap;
        const top =
          scope && scope.week > 0
            ? castBestScoredModel(
                getWeeklyTopScorerCandidates(scope.seasonYear, league, scope.week),
                players,
                undefined,
                'Top Scorer',
              )
            : null;
        return top ?? headliner('Headliner');
      }
      case 'article':
        // The player the article is about. No headliner fallback is skipped
        // here — unlike the feature card there is no screenshot to cover, so
        // an article naming nobody still wants a face.
        return (
          castFeaturedModel(input.articlePlayerId, players, 'In the Spotlight') ??
          headliner('Headliner')
        );
      case 'standings':
        // The headliner of the team leading the race.
        return input.standingsLeaderId
          ? headliner('Leading the Race', input.standingsLeaderId) ?? headliner('Headliner')
          : headliner('Headliner');
      default:
        return headliner('Headliner');
    }
  };

  switch (state.kind) {
    // Bespoke heroes own these phases — no composite. A league with no
    // bracket hero keeps the slot rotation through the playoffs, and casts it.
    case 'trade-deadline':
      return null;
    case 'playoffs':
    case 'championship':
      return state.view ? castSlot(state.slot) : null;

    case 'calendar-event':
      switch (state.role) {
        case 'keeper-deadline':
          // Roster action: your keeper-class anchor (guests see a league-wide one).
          return headliner('Keeper Cornerstone');
        case 'pool-draft':
        case 'draft':
        case 'auction':
          // Drafts and auctions are about who is still out there — the board's
          // best available.
          return bestAvailable('Best Available') ?? headliner('Headliner');
        case 'season-start':
          // Kickoff rule: your likely starter in the first game you play in.
          return (
            gameStarter('Kickoff Starter', 'Your First Starter', 'On Your Roster') ??
            ownRosterFallback('Headliner')
          );
        case 'trade-deadline':
          // A player actually on the block; falls back when blocks are empty.
          return (
            castRosterModel(
              getTradeBaitCandidates(leagueYear, league),
              players,
              userFranchiseId,
              referenceDate,
              'On the Block',
            ) ?? headliner('Headliner')
          );
        case 'new-league-year':
          // Rookies represent "new" — the newest class models the reset.
          return castRookieModel(players, referenceDate, rostered()) ?? headliner('Headliner');
        default:
          // regular-season-ends / playoffs lead / championship lead / champion
          // crowned: a franchise headliner — the faces of the race.
          return headliner('Headliner');
      }

    case 'regular-season':
      return castSlot(state.slot);

    case 'feature':
      // The feature's own screenshot is the art (see EventHeroView.screenshot).
      // A player is cast ONLY when the entry names one — no headliner
      // fallback, or he'd cover the screenshot.
      return castFeaturedModel(
        state.content.heroPlayerId,
        players,
        state.content.heroPlayerDescriptor ?? 'Featured',
      );

    case 'event':
      // Two heroes land on `event`. The schedule-release tease asks for one of
      // the league's best players (see EventHeroView.cast); everything else
      // takes a franchise headliner. The intent comes from the resolver rather
      // than from sniffing the view's link.
      if (state.view.cast === 'top-ranked') {
        return (
          castTopRosteredModel(
            players,
            referenceDate,
            rostered(),
            getAdpRankedIds(leagueYear, league),
            'Top 5 Overall',
          ) ?? headliner('Headliner')
        );
      }
      return headliner('Headliner');

    case 'default':
    default:
      return headliner('Headliner');
  }
}
