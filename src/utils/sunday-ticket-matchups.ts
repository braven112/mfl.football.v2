/**
 * The owner's own fantasy game, per league, as the Sunday Ticket band renders
 * it — crests, live scores, and who is still to play.
 *
 * PURE. The page supplies the schedule matchups, the brands and the live
 * snapshot; this decides what the card says. Keeping it out of the component
 * is what lets the rules below be tested directly rather than through a
 * rendered page.
 */

import type { LiveSnapshot } from './live-scoring-snapshot';
import type { TeamBrand } from './league-team-brands';

export interface MatchupSide {
  franchiseId: string;
  name: string;
  /** LIGHT crest artwork; the layout's TeamIconDarkStyles handles dark mode. */
  icon: string;
  score: number;
  yetToPlay: number;
  isYou: boolean;
}

export interface MatchupCard {
  leagueId: string;
  leagueSlug: string;
  leagueName: string;
  you: MatchupSide;
  opponent: MatchupSide;
  /** False for a league we cannot read live at all (an outside league). */
  liveSupported: boolean;
  /** True when a live read actually landed for this league. */
  liveResolved: boolean;
  /** Max NFL game-seconds left across the two sides. 0 = both final. */
  secondsRemaining: number;
  /**
   * Draft-only best-ball league. The registry is explicit that such a league
   * has NO lineups and that "UI that offers any of those must be skipped"
   * (`leagues-data.mjs`, the `bestBall` flag) — so the card omits its Set
   * lineup link rather than pointing at a route that does not exist.
   */
  bestBall: boolean;
}

export interface BuildMatchupCardsInput {
  leagueId: string;
  leagueSlug: string;
  leagueName: string;
  franchiseId: string;
  /** This week's pairings for the owner, from `findWeekMatchups`. Doubleheaders give more than one. */
  weekMatchups: ReadonlyArray<{ opponentFranchiseId: string }>;
  /** Franchise id → brand, from `getLeagueTeamBrands(slug)`. */
  brands: Record<string, TeamBrand>;
  /** The league's live snapshot, or null when there is no live read. */
  snapshot: LiveSnapshot | null;
  liveSupported: boolean;
  /** `LeagueDefinition.bestBall` — drives whether a Set lineup link is offered. */
  bestBall?: boolean;
}

const nameOf = (brands: Record<string, TeamBrand>, fid: string): string =>
  brands[fid]?.name ?? `Franchise ${fid}`;

/**
 * Build one card per matchup the owner has this week.
 *
 * The pairing comes from the SCHEDULE feed, not from the live snapshot, and
 * that direction matters: the schedule is known all week, while a live read
 * can be absent (offseason, MFL down, pre-kickoff). Sourcing the opponent from
 * the snapshot would blank the whole band whenever the feed was unavailable —
 * the "couldn't read it" / "nothing there" merge this board is built to avoid.
 * Doubleheaders already arrive as more than one entry, so they render as more
 * than one card without a special case.
 *
 * `liveResolved` is per LEAGUE, not per side: MFL scores both franchises in
 * one payload, so a snapshot that names either side is a live read for the
 * card. A league with no snapshot keeps score 0 and renders '—', never 0.0.
 */
export function buildMatchupCards(input: BuildMatchupCardsInput): MatchupCard[] {
  const { leagueId, leagueSlug, leagueName, franchiseId, weekMatchups, brands, snapshot, liveSupported } = input;
  const bestBall = input.bestBall === true;
  if (!franchiseId) return [];

  return weekMatchups.map(({ opponentFranchiseId }) => {
    const ids = [franchiseId, opponentFranchiseId];
    const liveResolved = Boolean(
      snapshot && ids.some((id) => snapshot.scores[id] !== undefined),
    );

    const sideFor = (fid: string, isYou: boolean): MatchupSide => ({
      franchiseId: fid,
      name: nameOf(brands, fid),
      icon: brands[fid]?.icon ?? '',
      score: snapshot?.scores[fid] ?? 0,
      yetToPlay: snapshot?.playersYetToPlay[fid] ?? 0,
      isYou,
    });

    return {
      leagueId,
      leagueSlug,
      leagueName,
      you: sideFor(franchiseId, true),
      opponent: sideFor(opponentFranchiseId, false),
      liveSupported,
      liveResolved,
      secondsRemaining: Math.max(
        ...ids.map((id) => snapshot?.remaining[id] ?? 0),
      ),
      bestBall,
    };
  });
}

/**
 * What a card's status line says. Shared by the server render and the island
 * so the two can never disagree — the island re-derives this from raw feed
 * numbers every poll, and a second copy of the ladder would drift the moment
 * one of them was edited.
 *
 * Never a fabricated clock. MFL gives us game-seconds remaining, not the NFL
 * game clock (which stops; that number does not), so with nothing reliable to
 * say we print the STATE and no numbers.
 */
export function liveStateLabel(state: {
  liveSupported: boolean;
  liveResolved: boolean;
  secondsRemaining: number;
}): string {
  if (!state.liveSupported) return 'Projections only';
  if (!state.liveResolved) return 'Not started';
  return state.secondsRemaining > 0 ? 'In progress' : 'Final';
}
