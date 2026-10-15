/**
 * The handheld broadcast board's view of a matchup: both starting lineups,
 * resolved for the expanded sheet and the player card.
 *
 * Pure, so the sheet's content is testable without a DOM. Starters only, by
 * construction: it reads `BroadcastTeamScore.players`, which `scoreLeague`
 * fills with starters and never bench (docs/plans/broadcast-handheld.md,
 * Gap 1).
 */

import type { BroadcastLeaguePanel, BroadcastLeagueScore } from '../types/live-broadcast';
import type { LivePlayerRow, NflGame, PlayerMeta } from '../types/live-scoring';
import { gamesByTeam, playerGameClock, type StripRow } from './broadcast-layout';
import { projectPlayerRemaining } from './live-win-probability';
import { orderLineupRows } from './mfl-live-lineup';

/**
 * Which matchup the sheet has open. Keyed by league and the matchup's own
 * index, never by array position, so an open sheet survives every poll and a
 * doubleheader's two games stay distinct.
 */
export function matchupKey(leagueId: string, index: number): string {
  return `${leagueId}:${index}`;
}

/** One starter as the sheet and the player card draw him. */
export interface HandheldPlayer {
  id: string;
  name: string;
  position: string;
  nflTeam: string;
  headshot: string;
  points: number;
  /**
   * This league's full-game projection, or null when the league has none for
   * him. Read from the ROW (stamped by `scoreLeague`), never `meta.projected`,
   * which is a deliberate 0 in the map every league on the board shares.
   */
  projected: number | null;
  /** Projected points still to come in his game, or null with no projection. */
  projectedLeft: number | null;
  clock: string;
  state: StripRow['state'];
}

/** One franchise's starters, in lineup order (position, then points). */
export function handheldLineup(
  rows: readonly LivePlayerRow[],
  meta: Record<string, PlayerMeta>,
  games: readonly NflGame[],
): HandheldPlayer[] {
  const byTeam = gamesByTeam(games);
  return orderLineupRows(rows, meta).map((row) => {
    const who = meta[row.id];
    const { clock, state } = playerGameClock(row, who?.nflTeam, byTeam);
    const projected = typeof row.projected === 'number' && Number.isFinite(row.projected) ? row.projected : null;
    return {
      id: row.id,
      name: who?.name ?? `Player ${row.id}`,
      position: who?.position ?? '',
      nflTeam: who?.nflTeam ?? '',
      headshot: who?.headshot ?? '',
      points: Number.isFinite(row.live) ? row.live : 0,
      projected,
      projectedLeft:
        projected === null
          ? null
          : projectPlayerRemaining({ live: row.live, projected, secondsRemaining: row.secondsRemaining }),
      clock,
      state,
    };
  });
}

// ── Swipe between league pages ──────────────────────────────────────────────

/**
 * Split the board's cards into pages of at most `capacity`, keeping a league's
 * cards together wherever they fit — a league is never split across a swipe
 * unless it alone overflows a page. `capacity` null (portrait: one scrolling
 * list) or anything below 1 means one page holding everything.
 */
export function paginateByLeague<T>(
  items: readonly T[],
  leagueOf: (item: T) => string,
  capacity: number | null,
): T[][] {
  if (items.length === 0) return [];
  if (capacity === null || !Number.isFinite(capacity) || capacity < 1 || items.length <= capacity) {
    return [[...items]];
  }
  const cap = Math.floor(capacity);

  // Consecutive cards of one league are one group; the board already lists a
  // league's cards together, so this keeps its order.
  const groups: T[][] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && leagueOf(last[0]) === leagueOf(item)) last.push(item);
    else groups.push([item]);
  }

  const pages: T[][] = [];
  let page: T[] = [];
  for (const group of groups) {
    if (page.length > 0 && page.length + group.length > cap) {
      pages.push(page);
      page = [];
    }
    for (const item of group) {
      // A league bigger than a page fills pages of its own.
      if (page.length === cap) {
        pages.push(page);
        page = [];
      }
      page.push(item);
    }
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

// ── On the field now ────────────────────────────────────────────────────────

/** One of the owner's starters whose NFL team has the ball right now. */
export interface FieldPlayer {
  id: string;
  name: string;
  position: string;
  nflTeam: string;
  headshot: string;
  /** His team has the ball inside the 20. */
  redZone: boolean;
  /** The leagues he starts for the owner in, in board order. */
  leagues: string[];
}

/**
 * The owner's own starters whose NFL team is on OFFENSE in a live game.
 *
 * The same possession rule the red-zone banner uses (`selectRedZoneAlerts`):
 * `isRedZone` belongs to the team with the ball, so a player is flagged only
 * when his own team is the one holding it, never while it is on defense. Only
 * the owner's side: this row answers "which of MY guys are out there".
 * A player started in two leagues is one face, naming both.
 */
export function onFieldNow(
  panels: readonly BroadcastLeaguePanel[],
  scores: Record<string, BroadcastLeagueScore>,
  games: readonly NflGame[],
  meta: Record<string, PlayerMeta>,
): FieldPlayer[] {
  const offense = new Map<string, boolean>();
  for (const game of games) {
    // A `situation` can linger on an ended game; only a game being played counts.
    if (game.state !== 'in') continue;
    const team = game.situation?.possession || game.possession || '';
    if (!team) continue;
    offense.set(team, !!(game.situation?.isRedZone && game.situation.possession === team));
  }
  if (offense.size === 0) return [];

  const byId = new Map<string, FieldPlayer>();
  for (const panel of panels) {
    if (panel.status === 'unavailable') continue;
    const fids = new Set(panel.matchups.map((m) => m.mine.franchiseId));
    for (const fid of fids) {
      for (const row of scores[panel.leagueId]?.teams[fid]?.players ?? []) {
        const who = meta[row.id];
        if (!who?.nflTeam || !offense.has(who.nflTeam)) continue;
        const seen = byId.get(row.id);
        if (seen) {
          if (!seen.leagues.includes(panel.leagueName)) seen.leagues.push(panel.leagueName);
          continue;
        }
        byId.set(row.id, {
          id: row.id,
          name: who.name,
          position: who.position,
          nflTeam: who.nflTeam,
          headshot: who.headshot,
          redZone: offense.get(who.nflTeam) === true,
          leagues: [panel.leagueName],
        });
      }
    }
  }
  // Red zone first; otherwise board order (the sort is stable).
  return [...byId.values()].sort((a, b) => Number(b.redZone) - Number(a.redZone));
}
