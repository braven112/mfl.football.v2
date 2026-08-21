/**
 * Rankings on the Set Lineup page.
 *
 * Set Lineup is a mobile-first, one-decision-at-a-time page: you open a slot
 * and choose between a handful of eligible players. A full column set like the
 * Free Agents table would not fit and would not help — what helps is one rank
 * per candidate, next to the projection, so "who is actually the better player"
 * is on screen while you decide.
 *
 * That means a single board rather than every import: the composite "My Rank"
 * when the owner has built one, otherwise whichever import sits first on their
 * board. Same choice the Rosters pages make (see rankings-roster-column.ts).
 *
 * Shared because `theleague/lineup.astro` and `afl-fantasy/lineup.astro` are
 * near-identical siblings and drift between them is a recurring bug here.
 */

import { buildRankingLookup } from './rankings-lookup';

export { onRankingsChanged } from './rankings-lookup';

export interface LineupRankings {
  /** True when the owner has a board loaded for this league. */
  available: boolean;
  /** Short column label — 'My Rank', 'MFL', 'FCalc', … */
  label: string;
  /** Full board name, for tooltips and screen readers. */
  fullName: string;
  /** This board's rank for a player, or null when it doesn't rank them. */
  rank(playerId: string): number | null;
}

const EMPTY: LineupRankings = {
  available: false,
  label: '',
  fullName: '',
  rank: () => null,
};

/**
 * Read the owner's top ranking board.
 *
 * Goes through `buildRankingLookup()`, which is already scoped to the league
 * of the page it runs on — never read the storage keys directly here, or an
 * AFL lineup would show TheLeague's board.
 */
export function loadLineupRankings(): LineupRankings {
  const lookup = buildRankingLookup();
  const column = lookup.columns[0];
  if (!column) return EMPTY;

  const ranks = lookup.byImport.get(column.importId);
  if (!ranks || ranks.size === 0) return EMPTY;

  return {
    available: true,
    label: column.header,
    fullName: column.fullName,
    rank: (playerId: string) => ranks.get(playerId) ?? null,
  };
}

/**
 * Compare two players by rank, ascending, with unranked players last.
 *
 * Sorting the candidate list by rank has to keep "no rank" at the bottom in
 * both leagues — an unranked kicker floating to the top of a list you're
 * choosing a starter from is worse than useless.
 */
export function byRank(
  rankings: LineupRankings,
): (a: { id: string }, b: { id: string }) => number {
  return (a, b) => (rankings.rank(a.id) ?? Infinity) - (rankings.rank(b.id) ?? Infinity);
}
