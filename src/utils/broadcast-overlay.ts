/**
 * The score overlay: what the Google TV app draws ON TOP of another app
 * (YouTube TV) while a game plays.
 *
 * PURE. It turns the board's own panels and poll into one flat list of games
 * the overlay steps through with Left/Right, so the overlay reads the same
 * numbers the full board does and never computes a score or a win chance of
 * its own. Two views read it: the panel (one game, both starting lineups) and
 * the bar (every game, one chip each).
 */
import type { BroadcastLeaguePanel, BroadcastPollResponse, BroadcastTeam } from '../types/live-broadcast';
import type { LivePlayerRow, PlayerMeta } from '../types/live-scoring';
import { orderLineupRows, positionLabel } from './mfl-live-lineup';
import { projectPlayerFinal } from './live-win-probability';

export type OverlayMode = 'panel' | 'bar';

export interface OverlayPlayer {
  id: string;
  name: string;
  position: string;
  live: number;
  /** Projected final for THIS player: live plus what his remaining clock is worth. */
  projected: number;
}

export interface OverlaySide {
  name: string;
  abbrev: string;
  swatch: string;
  live: number;
  projectedFinal: number;
  lineup: OverlayPlayer[];
}

export interface OverlayGame {
  key: string;
  leagueName: string;
  mine: OverlaySide;
  opponent: OverlaySide;
  /** The viewer's chance to win, 0-1, as the board states it. */
  winChance: number;
  /** False while the league's feed could not be read; numbers then show as dashes. */
  readable: boolean;
}

/** `?mode=` is a hint from the TV app; anything else is the panel. */
export function overlayModeFrom(raw: string | null | undefined): OverlayMode {
  return raw === 'bar' ? 'bar' : 'panel';
}

/** Left/Right wrap through the games, like the board's remote. */
export function stepOverlay(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

function lineupFor(rows: readonly LivePlayerRow[], meta: Record<string, PlayerMeta>): OverlayPlayer[] {
  const starters = rows.filter((row) => row.status === 'starter');
  return orderLineupRows(starters, meta).map((row) => ({
    id: row.id,
    name: meta[row.id]?.name ?? row.id,
    position: positionLabel(meta[row.id]?.position),
    live: Number.isFinite(row.live) ? row.live : 0,
    projected: projectPlayerFinal({
      live: Number.isFinite(row.live) ? row.live : 0,
      projected: row.projected ?? 0,
      secondsRemaining: row.secondsRemaining,
    }),
  }));
}

function sideFor(
  team: BroadcastTeam,
  score: { live: number; projectedFinal: number; players: LivePlayerRow[] } | undefined,
  meta: Record<string, PlayerMeta>,
): OverlaySide {
  return {
    name: team.name,
    abbrev: team.abbrev,
    swatch: team.swatch,
    live: score?.live ?? 0,
    projectedFinal: score?.projectedFinal ?? 0,
    lineup: score ? lineupFor(score.players, meta) : [],
  };
}

/**
 * Every game with an opponent, in board order: league by league, then each
 * league's matchups (a doubleheader is two games). A bye has nothing to put
 * on screen over a football game, so it is left out.
 */
export function overlayGames(
  panels: readonly BroadcastLeaguePanel[],
  poll: BroadcastPollResponse,
  meta: Record<string, PlayerMeta>,
): OverlayGame[] {
  const scores = new Map(poll.leagues.map((league) => [league.leagueId, league]));
  const games: OverlayGame[] = [];
  for (const panel of panels) {
    const score = scores.get(panel.leagueId);
    for (const matchup of panel.matchups) {
      if (!matchup.opponent) continue;
      games.push({
        key: `${panel.leagueId}:${matchup.index}`,
        leagueName: panel.leagueName,
        mine: sideFor(matchup.mine, score?.teams[matchup.mine.franchiseId], meta),
        opponent: sideFor(matchup.opponent, score?.teams[matchup.opponent.franchiseId], meta),
        winChance: score?.winProbability[matchup.index] ?? 0.5,
        readable: panel.status !== 'unavailable' && score?.ok !== false,
      });
    }
  }
  return games;
}

/** "99.2%". Only a settled game prints 100% or 0%; rounding never gets there. */
export function formatChance(chance: number): string {
  if (chance >= 1) return '100%';
  if (chance <= 0) return '0%';
  const pct = Math.min(99.9, Math.max(0.1, chance * 100));
  return `${pct.toFixed(1)}%`;
}
