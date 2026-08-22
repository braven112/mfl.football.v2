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
  return (a, b) => {
    const ra = rankings.rank(a.id);
    const rb = rankings.rank(b.id);
    // Compare the null cases explicitly rather than substituting Infinity:
    // `Infinity - Infinity` is NaN, and a comparator that returns NaN leaves
    // the order of every unranked-vs-unranked pair up to the engine. A slot
    // full of kickers and defenses is exactly that case.
    if (ra == null) return rb == null ? 0 : 1;
    if (rb == null) return -1;
    return ra - rb;
  };
}

// ---------------------------------------------------------------------------
// Inline rank chips
// ---------------------------------------------------------------------------

/** A set of rows to hang rank chips on. */
export interface RankChipTarget {
  /** Rows carrying `data-player-id`, e.g. `.lineup-slot[data-player-id]`. */
  rowSelector: string;
  /** The chip is inserted immediately after this element inside the row. */
  afterSelector: string;
}

const CHIP_ATTR = 'data-rank-chip';

/**
 * Put the owner's rank inline on every row that names a player.
 *
 * The replacement sheet alone was not enough: an owner scanning their lineup
 * has no reason to tap a slot they weren't already suspicious of, so a rank
 * that only exists behind a tap is a rank they never see. This puts it on the
 * starters and the bench, where the "wait, why is he on my bench" moment
 * actually happens.
 *
 * Idempotent — clears every chip before re-inserting, so a slot re-render or a
 * board change can call it as often as it likes. A player the board doesn't
 * rank gets NO chip rather than a dash, so the column of chips stays a signal
 * instead of becoming visual noise on a roster full of kickers.
 */
export function applyRankChips(rankings: LineupRankings, targets: RankChipTarget[]): void {
  document.querySelectorAll(`[${CHIP_ATTR}]`).forEach((el) => el.remove());
  if (!rankings.available) return;

  for (const target of targets) {
    document.querySelectorAll<HTMLElement>(target.rowSelector).forEach((row) => {
      const playerId = row.dataset.playerId;
      if (!playerId) return;
      const rank = rankings.rank(playerId);
      if (rank == null) return;

      const anchor = row.querySelector(target.afterSelector);
      if (!anchor) return;

      const chip = document.createElement('span');
      chip.className = 'lineup-rank-chip';
      chip.setAttribute(CHIP_ATTR, '');
      chip.textContent = `#${rank}`;
      // The visible "#43" reads as "hash forty-three" or worse; name the board.
      chip.setAttribute('aria-label', `${rankings.label} ${rank}`);
      chip.title = `${rankings.fullName}: #${rank}`;
      anchor.insertAdjacentElement('afterend', chip);
    });
  }
}
