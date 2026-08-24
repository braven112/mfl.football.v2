/**
 * Set Lineup types.
 *
 * `LineupPlayer` is the shape both lineup pages serialize into
 * `window.__LINEUP_DATA__` and that their client scripts read back. It lived as
 * two byte-identical copies in the pages' frontmatter, which left the client
 * side with no type at all: `new Map(data.roster.map(...))` inferred
 * `Map<{}, {}>`, so every player property read downstream failed to compile.
 *
 * See `docs/claude/rules/lineups.md` for the behavioural rules around how this
 * payload is built (MFL's soft failures, and the saved-vs-unreadable split).
 */

/** One rosterable player as the Set Lineup page presents him. */
export interface LineupPlayer {
  id: string;
  rosterStatus: string;
  name: string;
  headshot: string;
  position: string;
  nflTeam: string;
  /** Slot names this player may legally fill. */
  eligibleSlots: string[];
  projection: number | null;
  last3Avg: number | null;
  seasonAvg: number | null;
  injury: string | null;
  /** True once the player's NFL game has kicked off; the slot cannot change. */
  gameLocked: boolean;
  /** Index into the page's schedule payload; null when unscheduled. */
  gameIndex: number | null;
  isBye: boolean;
  espnId?: string;
  customRank: number | null;
  streak: number | null;
  recentScores: { week: number; score: number }[];
}
