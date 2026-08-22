/**
 * The Rank column on a Rosters page.
 *
 * Both leagues show the owner's top ranking board — the composite "My Rank"
 * when they've built one, otherwise whichever import sits first on their
 * board — as a single column next to each rostered player. The two Rosters
 * pages are near-identical siblings, so the logic lives here rather than being
 * copied into each one.
 *
 * The column is hidden outright when the owner has no board: an always-present
 * empty column is worse than no column.
 */

import {
  buildRankingLookup,
  onRankingsChanged,
  type RankingLookup,
} from './rankings-lookup';

export interface RosterRankColumnOptions {
  /**
   * Container(s) whose `tr[data-player-id]` rows get a rank, e.g.
   * `#rosterTableBody`. Every match is used — the AFL splits its roster across
   * one table per section (Active, IR).
   */
  rowsSelector: string;
  /** Every `<th>`/`<td>` belonging to the ranking column, e.g. `.ranking-col`. */
  columnSelector: string;
  /** The cell inside a row that receives the rank, e.g. `.ranking-cell`. */
  cellSelector: string;
  /** The `<th>` whose label is replaced with the source's short name. Optional. */
  headerSelector?: string;
  /** `display` value for a visible cell. Defaults to `''` (the stylesheet's own). */
  visibleDisplay?: string;
  /** Text for a player the board doesn't rank. */
  emptyText?: string;
  /**
   * Runs after every populate — e.g. to re-apply a page's own column modes.
   * `hasColumn` is false when the owner has no board, in which case the column
   * is hidden and must stay hidden.
   */
  afterPopulate?: (lookup: RankingLookup, hasColumn: boolean) => void;
}

function setColumnDisplay(selector: string, value: string): void {
  document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    el.style.display = value;
  });
}

function populate(options: RosterRankColumnOptions): RankingLookup {
  const lookup = buildRankingLookup();

  // After a ClientRouter swap the previous page's module instance is still
  // alive and still answers `astro:page-load`. Its selectors can match the new
  // page's markup (both leagues use `.ranking-col`), so it would fight the live
  // page's own instance over which cells are visible. If OUR rows aren't in the
  // document, this isn't our page — do nothing at all.
  if (!document.querySelector(options.rowsSelector)) return lookup;

  const topColumn = lookup.columns[0];

  if (!topColumn) {
    setColumnDisplay(options.columnSelector, 'none');
    options.afterPopulate?.(lookup, false);
    return lookup;
  }

  // Header shows which board this is. Preserve a `.sort-arrow` child if the
  // page has one — replacing textContent would drop it.
  if (options.headerSelector) {
    const headerEl = document.querySelector<HTMLElement>(options.headerSelector);
    if (headerEl) {
      const sortArrow = headerEl.querySelector('.sort-arrow');
      headerEl.title = topColumn.fullName;
      headerEl.textContent = '';
      headerEl.append(sortArrow ? `${topColumn.header} ` : topColumn.header);
      if (sortArrow) headerEl.append(sortArrow);
    }
  }

  const playerRanks = lookup.byImport.get(topColumn.importId);
  const emptyText = options.emptyText ?? '—';
  if (playerRanks) {
    document
      .querySelectorAll<HTMLElement>(`${options.rowsSelector} tr[data-player-id]`)
      .forEach((row) => {
        const playerId = row.dataset.playerId;
        const cell = row.querySelector(options.cellSelector);
        if (!cell || !playerId) return;
        const rank = playerRanks.get(playerId);
        cell.textContent = rank != null ? String(rank) : emptyText;
      });
  }

  setColumnDisplay(options.columnSelector, options.visibleDisplay ?? '');
  options.afterPopulate?.(lookup, true);
  return lookup;
}

/**
 * Wire the Rank column. Call once at module scope; handles Astro view
 * transitions, board changes in this tab or another, and the page re-rendering
 * its rows underneath.
 */
export function initRosterRankColumn(options: RosterRankColumnOptions): void {
  let unsubscribe: (() => void) | null = null;
  let observer: MutationObserver | null = null;

  function init(): void {
    unsubscribe?.();
    observer?.disconnect();

    populate(options);

    unsubscribe = onRankingsChanged(() => populate(options));

    // The page may rebuild its rows (sort, filter, mode switch) after we've
    // filled them in — repopulate when it does.
    const containers = document.querySelectorAll(options.rowsSelector);
    if (containers.length) {
      observer = new MutationObserver(() => populate(options));
      // childList only, and on the row container itself: populate() writes
      // textContent into cells one level deeper, so a subtree observer would
      // re-trigger itself forever.
      containers.forEach((el) => observer!.observe(el, { childList: true }));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Let the page's own script render its rows first.
    setTimeout(init, 50);
  }

  document.addEventListener('astro:page-load', () => setTimeout(init, 50));
}
