/**
 * Monday night's spotlight: which game the MNF hero is about, and whose face
 * it wears.
 *
 * Brandon's rules (Oct 2026), in order:
 *  - A game is CLOSE by projection, never by the current score. One point
 *    apart with one side holding seven players still to play is a projected
 *    blowout, not a close game. So each side is scored as its projected final
 *    (points so far + what everyone still to play is projected to add) and a
 *    game only counts while the side behind still has a real chance — its win
 *    probability from the same model the live board draws
 *    (`live-win-probability.ts`) is at least `MIN_UNDERDOG_WIN_PROBABILITY`.
 *  - Never a blowout. A game nobody still to play can swing is not shown, and
 *    when no game qualifies there is no spotlight at all (`null`) — the caller
 *    keeps its ordinary hero rather than dressing up a decided game.
 *  - The face is the player still to play in that game with the most projected
 *    points left — either side, since the leader's closer swings it as much as
 *    the trailer's comeback.
 *
 * The viewer's own game leads when it qualifies; otherwise the league's
 * closest. Pure: the page loads the snapshot and the projections.
 */
import type { CanonicalLeagueSlug } from '../config/leagues';
import type { LivePlayerRow, MatchupPairing } from '../types/live-scoring';
import type { HeroModel } from './hero-casting';
import { projectMatchup, projectPlayerRemaining } from './live-win-probability';

/** The side behind needs at least this chance for the game to count as close. */
export const MIN_UNDERDOG_WIN_PROBABILITY = 0.2;

export interface SpotlightSide {
  franchiseId: string;
  live: number;
  projectedFinal: number;
  /** Starters whose NFL game is not over yet. */
  stillToPlay: number;
}

export interface SpotlightGame {
  home: SpotlightSide;
  away: SpotlightSide;
  /** Absolute projected-final margin — the sort key. */
  projectedMargin: number;
  /** P(home wins), 0–1. */
  homeWinProbability: number;
  /** Whether the signed-in viewer plays in it. */
  isViewer: boolean;
}

export interface SpotlightPlayer {
  playerId: string;
  franchiseId: string;
  /** Projected points he has still to add. */
  remainingProjection: number;
}

export interface MondaySpotlight {
  game: SpotlightGame;
  /** Still-to-play players in `game`, most projected points left first. */
  players: SpotlightPlayer[];
  /** The other close games, closest first. */
  others: SpotlightGame[];
}

export interface SpotlightTeam {
  name: string;
  shortName: string;
  color: string;
}

/** What the page hands `MondayNightHero` (built by monday-spotlight-props.ts). */
export interface MondaySpotlightHeroProps {
  league: CanonicalLeagueSlug;
  week: number;
  game: SpotlightGame;
  others: SpotlightGame[];
  teams: Record<string, SpotlightTeam>;
  /** The face: the most projected points still to play in `game` that has a cutout. */
  model: HeroModel | null;
  /** Who the featured player is, even when no cutout could be cast. */
  player: { playerId: string; name: string; franchiseId: string; remainingProjection: number };
}

export interface SelectMondaySpotlightInput {
  matchups: readonly MatchupPairing[];
  /** STARTERS only, by franchise. */
  players: Record<string, readonly LivePlayerRow[]>;
  /** This league's full-game projections for the week. */
  projections: ReadonlyMap<string, number>;
  userFranchiseId?: string;
  /** When set, only games between these franchises (the AFL's conference). */
  scopeFranchiseIds?: readonly string[];
  /** How many other close games to return. */
  maxOthers?: number;
}

function sideRows(rows: readonly LivePlayerRow[] | undefined, projections: ReadonlyMap<string, number>) {
  return (rows ?? []).map((r) => ({
    id: r.id,
    live: r.live,
    secondsRemaining: r.secondsRemaining,
    projected: projections.get(r.id) ?? r.projected ?? 0,
  }));
}

export function selectMondaySpotlight(input: SelectMondaySpotlightInput): MondaySpotlight | null {
  const { matchups, players, projections, userFranchiseId, scopeFranchiseIds, maxOthers = 2 } = input;
  const scope = scopeFranchiseIds?.length ? new Set(scopeFranchiseIds) : null;

  const close: { game: SpotlightGame; candidates: SpotlightPlayer[] }[] = [];
  for (const m of matchups) {
    if (scope && !(scope.has(m.home) && scope.has(m.away))) continue;
    const home = sideRows(players[m.home], projections);
    const away = sideRows(players[m.away], projections);
    const proj = projectMatchup(home, away);
    if (proj.isFinal) continue;

    const underdog = Math.min(proj.homeWinProbability, 1 - proj.homeWinProbability);
    if (underdog < MIN_UNDERDOG_WIN_PROBABILITY) continue;

    const candidates: SpotlightPlayer[] = [
      ...home.map((p) => ({ p, franchiseId: m.home })),
      ...away.map((p) => ({ p, franchiseId: m.away })),
    ]
      .filter(({ p }) => p.secondsRemaining > 0)
      .map(({ p, franchiseId }) => ({ playerId: p.id, franchiseId, remainingProjection: projectPlayerRemaining(p) }))
      .filter((c) => c.remainingProjection > 0)
      .sort((a, b) => b.remainingProjection - a.remainingProjection || a.playerId.localeCompare(b.playerId));
    // Nobody left who is projected to score cannot swing it.
    if (candidates.length === 0) continue;

    const stillToPlay = (rows: typeof home) => rows.filter((r) => r.secondsRemaining > 0).length;
    close.push({
      game: {
        home: { franchiseId: m.home, live: proj.homeLive, projectedFinal: proj.homeProjectedFinal, stillToPlay: stillToPlay(home) },
        away: { franchiseId: m.away, live: proj.awayLive, projectedFinal: proj.awayProjectedFinal, stillToPlay: stillToPlay(away) },
        projectedMargin: Math.abs(proj.homeProjectedFinal - proj.awayProjectedFinal),
        homeWinProbability: proj.homeWinProbability,
        isViewer: !!userFranchiseId && (m.home === userFranchiseId || m.away === userFranchiseId),
      },
      candidates,
    });
  }
  if (close.length === 0) return null;

  close.sort(
    (a, b) =>
      a.game.projectedMargin - b.game.projectedMargin ||
      a.game.home.franchiseId.localeCompare(b.game.home.franchiseId),
  );
  const lead = close.find((c) => c.game.isViewer) ?? close[0];
  return {
    game: lead.game,
    players: lead.candidates,
    others: close.filter((c) => c !== lead).slice(0, maxOthers).map((c) => c.game),
  };
}
