/**
 * AFL Hero Casting — picks the composite model for the AFL homepage hero.
 *
 * Maps every resolved AflHeroState to the SEMANTICALLY relevant player per
 * the hero casting rules (docs/claude/insights/features/player-composites.md):
 * the keeper cornerstone for the keeper deadline, the draft board's best
 * available for draft week, a player actually on the trade block for the
 * trade window, a starter in the week's earliest game on game days, the top
 * waiver target on waiver day, the week's top scorer for the recap, and a
 * rookie for anything "new". Signed-in owners see THEIR player wherever a
 * roster-action pool includes one; guests get a league-wide pick.
 *
 * Server-side only — reads AFL MFL feeds from disk via the league-aware
 * helpers in offseason-hero-data.ts. Returns null when no model resolves;
 * the hero then falls back to its existing (non-composite) player art.
 *
 * Bespoke phases (trade-deadline day, active playoffs, championship week)
 * keep their own components and never cast here.
 */

import type { CanonicalLeagueSlug } from '../config/leagues';
import type { AflHeroState } from './afl-hero-resolver';
import type { HeroModel } from './hero-casting';
import {
  castBestScoredModel,
  castRandomStarterModel,
  castRookieModel,
  castRosterModel,
  castTopFreeAgentModel,
} from './hero-casting';
import { getPlayerMap } from './player-map';
import {
  getAdpRankedIds,
  getFranchiseHeadliners,
  getKickoffGameCandidates,
  getRosteredPlayerIds,
  getTradeBaitCandidates,
  getWeeklyTopScorerCandidates,
} from './offseason-hero-data';

const AFL: CanonicalLeagueSlug = 'afl-fantasy';

export interface AflCastingInput {
  /** Drives daily rotation + rookie class ceiling. */
  referenceDate: Date;
  /** AFL league year (June 1 rollover — getAflLeagueYear). */
  leagueYear: number;
  /** Signed-in owner's AFL franchise id — personalizes roster-action pools. */
  userFranchiseId?: string;
  /** Franchise currently leading the standings — for the Monday standings slot. */
  standingsLeaderId?: string;
}

/**
 * Cast the model for an AFL hero state. Every strategy falls back to the
 * franchise-headliner pool (each team's best projected player, daily
 * rotation) before giving up, so the hero composites whenever the feeds
 * hold ANY resolvable player.
 */
export function castAflHeroModel(state: AflHeroState, input: AflCastingInput): HeroModel | null {
  const { referenceDate, leagueYear, userFranchiseId } = input;
  // Player identity is global to MFL — theleague's players.json resolves AFL
  // ids too (see player-composites.md), so getPlayerMap needs no league param.
  const players = getPlayerMap(leagueYear);
  if (players.size === 0) return null;

  // Feed-derived pools memoized for this invocation — the fallback ladder
  // (primary cast → headliner) would otherwise re-read the same feeds.
  let rosteredIds: Set<string> | null = null;
  const rostered = () => (rosteredIds ??= getRosteredPlayerIds(leagueYear, AFL));
  let headlinerPool: Array<{ playerId: string; franchiseId: string }> | null = null;
  const headliners = () => (headlinerPool ??= getFranchiseHeadliners(leagueYear, AFL));

  const headliner = (descriptor: string, franchiseId?: string): HeroModel | null => {
    let pool = headliners();
    if (franchiseId) pool = pool.filter((c) => c.franchiseId === franchiseId);
    return castRosterModel(pool, players, userFranchiseId, referenceDate, descriptor);
  };

  const bestAvailable = (descriptor: string): HeroModel | null => {
    // An empty roster set means the rosters feed is missing/unreadable (a
    // real AFL roster is never empty) — ownership can't be trusted, so don't
    // claim anyone is "available". Callers fall back to headliner → webp.
    if (rostered().size === 0) return null;
    const model = castTopFreeAgentModel(
      players,
      referenceDate,
      rostered(),
      getAdpRankedIds(leagueYear, AFL),
    );
    return model ? { ...model, descriptor } : null;
  };

  const gameStarter = (descriptor: string): HeroModel | null =>
    castRandomStarterModel(
      getKickoffGameCandidates(leagueYear, AFL, referenceDate),
      players,
      userFranchiseId,
      referenceDate,
      descriptor,
    );

  switch (state.kind) {
    // Bespoke heroes own these phases — no composite.
    case 'trade-deadline':
    case 'playoffs':
    case 'championship':
      return null;

    case 'calendar-event':
      switch (state.eventId) {
        case 'afl-keeper-deadline':
          // Roster action: your keeper-class anchor (guests see a league-wide one).
          return headliner('Keeper Cornerstone');
        case 'afl-al-draft':
        case 'afl-nl-draft':
          // AFL drafts rookies AND veterans — the board's best available.
          return bestAvailable('Best Available') ?? headliner('Headliner');
        case 'afl-season-start':
          // Kickoff rule: a likely starter in the earliest game of the week.
          return gameStarter('Kickoff Starter') ?? headliner('Headliner');
        case 'afl-trade-deadline':
          // A player actually on the block; falls back when blocks are empty.
          return (
            castRosterModel(
              getTradeBaitCandidates(leagueYear, AFL),
              players,
              userFranchiseId,
              referenceDate,
              'On the Block',
            ) ?? headliner('Headliner')
          );
        case 'afl-new-season-starts':
          // Rookies represent "new" — the newest class models the reset.
          return castRookieModel(players, referenceDate, rostered()) ?? headliner('Headliner');
        default:
          // regular-season-ends / playoffs lead / championship lead / champion
          // crowned: a franchise headliner — the faces of the race.
          return headliner('Headliner');
      }

    case 'regular-season':
      switch (state.slot) {
        case 'live-scoring':
          return gameStarter('In Action') ?? headliner('Headliner');
        case 'game-day-preview':
          return gameStarter('Kickoff Starter') ?? headliner('Headliner');
        case 'waiver-wire': {
          const model = bestAvailable('Top Target');
          return model ?? headliner('Headliner');
        }
        case 'recap': {
          // Deterministic: the week's top scorer IS the recap's headline.
          const top = castBestScoredModel(
            getWeeklyTopScorerCandidates(leagueYear, AFL),
            players,
            undefined,
            'Top Scorer',
          );
          return top ?? headliner('Headliner');
        }
        case 'standings':
          // The headliner of the team leading the race.
          return input.standingsLeaderId
            ? headliner('Leading the Race', input.standingsLeaderId) ?? headliner('Headliner')
            : headliner('Headliner');
        default:
          return headliner('Headliner');
      }

    case 'feature':
      // New features cast a rookie (rostered-first; unrostered only when no
      // rookie is rostered anywhere in the league).
      return castRookieModel(players, referenceDate, rostered()) ?? headliner('Headliner');

    case 'event':
    case 'default':
    default:
      return headliner('Headliner');
  }
}
