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
import { isMomentFresh, momentTime, type BroadcastMoment } from './broadcast-moments';

/**
 * `bar` is the always-on ticker strip and never takes the remote; `expanded`
 * opens the strip into both lineups while the app holds the remote; `panel`
 * is the column with the Watch list. Older app builds only ever ask for `bar`
 * and `panel`.
 */
export type OverlayMode = 'panel' | 'bar' | 'expanded';

/** Which screen edge the strip sits on; the owner moves it to dodge the network's own graphics. */
export type OverlayEdge = 'top' | 'bottom';

/**
 * Which side of the screen the corner box sits on. Only app builds whose
 * window is a quarter of the screen (`layout() === 'corner'`) can move it;
 * on older builds the box sits at the right end of the full-width strip.
 */
export type OverlayColumn = 'left' | 'right';

/**
 * How much of its corner the box takes: `small` is the one-line ticker, and
 * `quarter` fills the whole quarter of the screen with both lineups (for a
 * YouTube TV multiview, where three games take the other three quarters).
 */
export type OverlaySize = 'small' | 'quarter';

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
  /** The board's small crest; the board is dark, so this is the on-dark cut. '' when the club has none. */
  icon: string;
  /** Outline for `icon`, set only when that art is a light cut. */
  iconStroke?: string;
  live: number;
  projectedFinal: number;
  lineup: OverlayPlayer[];
}

export interface OverlayGame {
  key: string;
  leagueId: string;
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
  return raw === 'bar' || raw === 'expanded' ? raw : 'panel';
}

/** `?edge=` or the app's answer; anything else is the top, where the strip first shipped. */
export function overlayEdgeFrom(raw: string | null | undefined): OverlayEdge {
  return raw === 'bottom' ? 'bottom' : 'top';
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
    icon: team.iconSmall,
    ...(team.iconSmallStroke ? { iconStroke: team.iconSmallStroke } : {}),
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
        leagueId: panel.leagueId,
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

/** `?side=` or the app's answer; anything else is the right, where the corner box first shipped. */
export function overlayColumnFrom(raw: string | null | undefined): OverlayColumn {
  return raw === 'left' ? 'left' : 'right';
}

export function overlaySizeFrom(raw: string | null | undefined): OverlaySize {
  return raw === 'quarter' ? 'quarter' : 'small';
}

/**
 * The viewer's share of the win bar, 0-100. It is the board's own win chance,
 * so a settled game fills the bar with one colour and the loser's disappears.
 */
export function winBarShare(chance: number): number {
  if (!Number.isFinite(chance)) return 50;
  return Math.min(100, Math.max(0, chance * 100));
}

/**
 * A league with no logo of its own (one this site does not run) is named in
 * its place: its initials, or a short name as it is. "Best Ball 2026" → "BB26".
 */
export function leagueShortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, 6).toUpperCase();
  return words
    .map((w) => (/^\d+$/.test(w) ? w.slice(-2) : w[0]))
    .join('')
    .slice(0, 5)
    .toUpperCase();
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

/**
 * One play's worth of fantasy points, in fantasy points, for a big-play alert.
 * STRICTLY more than this (the owner's call, Oct 2026: "anything over 3").
 */
export const BIG_PLAY_MIN_POINTS = 3;

/**
 * How long one player's big play keeps a second banner for him away. Each
 * league's feed is read on its own, so the same play can reach one league a
 * poll after the other; a second real play worth more than 3 points inside a
 * minute is rare enough to lose.
 */
export const BIG_PLAY_REPEAT_MS = 60_000;

/** A big play by one of the viewer's own starters, as the ticker announces it. */
export interface BigPlayAlert {
  /** Unique per alert: the player plus the score he reached. */
  key: string;
  gameKey: string;
  playerId: string;
  playerName: string;
  nflTeam: string;
  /** Fantasy points the play was worth, as the scoring moved between two polls. */
  gained: number;
  /** ESPN's one-line summary of the play when the board has it; '' otherwise. */
  text: string;
  /** The viewer's team it scored for, and the matchup's score after it. */
  teamName: string;
  leagueName: string;
  mineAbbrev: string;
  opponentAbbrev: string;
  mineLive: number;
  opponentLive: number;
  /** Other leagues where the viewer starts the same player, by name. */
  alsoIn: string[];
}

/**
 * The viewer's starters' big plays since the last poll.
 *
 * MFL's live scoring has no per-play fantasy value, so a play is the jump in a
 * starter's points between two polls. `seen` is each starter's HIGHEST score
 * so far, not his last one: the board has watched a feed report a live 87.0
 * as zero for a poll and then recover, and measured from the last value that
 * recovery is a phantom 87-point play. A starter seen for the first time
 * (first poll, a promoted starter, a league that just came back) only sets
 * his baseline. Two polls apart can hold two small plays; that is the price
 * of reading scores rather than plays.
 *
 * The viewer's side only (the owner's call: "only show my players"). A player
 * started in two leagues is one alert, naming the other leagues, because it
 * is one play, naming the other leagues he starts in, and `recent` (player
 * id -> when he was last announced) keeps a league whose feed catches up a
 * poll later from announcing it again.
 */
export function detectBigPlays(
  seen: ReadonlyMap<string, number>,
  games: readonly OverlayGame[],
  moments: readonly BroadcastMoment[],
  now: number,
  recent: ReadonlyMap<string, number> = new Map(),
): { alerts: BigPlayAlert[]; seen: Map<string, number>; recent: Map<string, number> } {
  const next = new Map(seen);
  const nextRecent = new Map([...recent].filter(([, at]) => now - at < BIG_PLAY_REPEAT_MS));
  const alerts: BigPlayAlert[] = [];
  const byPlayer = new Map<string, BigPlayAlert>();
  for (const game of games) {
    if (!game.readable) continue;
    for (const player of game.mine.lineup) {
      const id = `${game.key}:${player.id}`;
      const before = seen.get(id);
      next.set(id, Math.max(before ?? player.live, player.live));
      if (before === undefined) continue;
      const gained = Math.round((player.live - before) * 100) / 100;
      if (!(gained > BIG_PLAY_MIN_POINTS)) continue;
      if (byPlayer.has(player.id) || nextRecent.has(player.id)) continue;
      const alert: BigPlayAlert = {
        key: `${id}:${player.live}`,
        gameKey: game.key,
        playerId: player.id,
        playerName: player.name,
        nflTeam: player.nflTeam,
        gained,
        text: playText(moments, player.id, now),
        teamName: game.mine.name,
        leagueName: game.leagueName,
        mineAbbrev: game.mine.abbrev,
        opponentAbbrev: game.opponent.abbrev,
        mineLive: game.mine.live,
        opponentLive: game.opponent.live,
        alsoIn: [],
      };
      byPlayer.set(player.id, alert);
      nextRecent.set(player.id, now);
      alerts.push(alert);
    }
  }
  // Every other league he starts in, whether or not its scoring rated the
  // play as big.
  for (const alert of alerts) {
    for (const game of games) {
      if (game.leagueName === alert.leagueName || alert.alsoIn.includes(game.leagueName)) continue;
      if (game.mine.lineup.some((p) => p.id === alert.playerId)) alert.alsoIn.push(game.leagueName);
    }
  }
  return { alerts, seen: next, recent: nextRecent };
}

/** The newest fresh play the board credits to this player on the viewer's side. */
function playText(moments: readonly BroadcastMoment[], playerId: string, now: number): string {
  let best: BroadcastMoment | undefined;
  for (const m of moments) {
    if (m.side !== 'mine' || m.playerId !== playerId || !m.text || !isMomentFresh(m, now)) continue;
    if (!best || (momentTime(m) ?? 0) > (momentTime(best) ?? 0)) best = m;
  }
  return best?.text ?? '';
}
