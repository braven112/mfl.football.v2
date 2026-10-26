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
import { normalizeUsNetwork } from './broadcast-channels';
import { getNFLTeamName, normalizeTeamCode } from './nfl-logo';
import type { NflGame } from '../types/live-scoring';

export type OverlayMode = 'panel' | 'bar';

export interface OverlayPlayer {
  id: string;
  name: string;
  position: string;
  /** Canonical NFL team code, '' when the player has no team. */
  nflTeam: string;
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
    nflTeam: normalizeTeamCode(meta[row.id]?.nflTeam ?? ''),
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

/** One NFL game the viewer's starters are in, as the overlay's Watch list shows it. */
export interface WatchGame {
  id: string;
  /** "SEA @ SF". */
  label: string;
  /** What a TV search for the game should ask: "Seattle Seahawks vs San Francisco 49ers". */
  query: string;
  /** The US network, normalized ("FOX", "Prime Video"); '' before ESPN names it. */
  network: string;
  live: boolean;
  /** ESPN's clock or kickoff, "8:12 - 3rd", "Sun 1:00 PM ET". */
  detail: string;
  /** The viewer's starters in this game, last names, in lineup order. */
  players: string[];
  /**
   * A Sunday-afternoon CBS or FOX game: on YouTube TV it is the viewer's local
   * channel when it is in their market and NFL Sunday Ticket when it is not.
   * We cannot know the market, so this is what the Watch row tells them.
   */
  regional: boolean;
}

/** The most rows the panel lists; a viewer with more live games pages with the game itself. */
export const WATCH_LIMIT = 6;

const REGIONAL_NETWORKS = new Set(['CBS', 'FOX']);

/** Sunday before 7 PM Eastern: the regional windows, where CBS and FOX split the country. */
function isSundayAfternoon(date: string): boolean {
  const at = new Date(date);
  if (Number.isNaN(at.getTime())) return false;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(at);
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  return weekday === 'Sun' && hour < 19;
}

const lastName = (name: string) => name.trim().split(/\s+/).slice(-1)[0] ?? name;

/**
 * The NFL games the viewer's OWN starters are playing in, across every
 * fantasy game the overlay shows: live games first, then today's kickoffs in
 * order. A finished game has nothing left to watch and is left out.
 *
 * Starters only, the viewer's side only (the owner's call, Oct 2026): this
 * row answers "where are my guys", not "where is the opponent's".
 */
export function overlayWatchList(games: readonly OverlayGame[], slate: readonly NflGame[]): WatchGame[] {
  const byTeam = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const game of games) {
    for (const player of game.mine.lineup) {
      if (!player.nflTeam || seen.has(player.id)) continue;
      seen.add(player.id);
      const names = byTeam.get(player.nflTeam) ?? [];
      names.push(lastName(player.name));
      byTeam.set(player.nflTeam, names);
    }
  }

  const rows: (WatchGame & { at: number })[] = [];
  for (const game of slate) {
    if (game.state === 'post') continue;
    const away = normalizeTeamCode(game.away.code);
    const home = normalizeTeamCode(game.home.code);
    const players = [...(byTeam.get(away) ?? []), ...(byTeam.get(home) ?? [])];
    if (players.length === 0) continue;
    const network = normalizeUsNetwork(game.broadcast);
    rows.push({
      id: game.id,
      label: `${away} @ ${home}`,
      query: `${getNFLTeamName(away)} vs ${getNFLTeamName(home)}`,
      network,
      live: game.state === 'in',
      detail: game.shortDetail,
      players,
      regional: REGIONAL_NETWORKS.has(network.toUpperCase()) && isSundayAfternoon(game.date),
      at: Date.parse(game.date) || 0,
    });
  }
  rows.sort((a, b) => Number(b.live) - Number(a.live) || a.at - b.at);
  return rows.slice(0, WATCH_LIMIT).map(({ at: _at, ...row }) => row);
}

/**
 * Where a regional game can be watched, for the row's small print. With
 * Sunday Ticket every one of them is reachable; without it, only the one on
 * the viewer's own local channel is, and we cannot tell which that is.
 */
export function watchNote(game: WatchGame, sundayTicket: boolean): string {
  if (!game.regional) return game.network;
  return sundayTicket ? `${game.network} · Sunday Ticket` : `${game.network} · local only`;
}

/** Up/Down through the Watch rows plus the closing "Hide overlay" row, without wrapping. */
export function moveWatch(index: number, delta: number, rows: number): number {
  return Math.max(0, Math.min(rows, index + delta));
}
