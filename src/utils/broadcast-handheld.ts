/**
 * The handheld broadcast board's view of a matchup: both starting lineups,
 * resolved for the expanded sheet and the player card.
 *
 * Pure, so the sheet's content is testable without a DOM. Starters only, by
 * construction: it reads `BroadcastTeamScore.players`, which `scoreLeague`
 * fills with starters and never bench (docs/plans/broadcast-handheld.md,
 * Gap 1).
 */

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
