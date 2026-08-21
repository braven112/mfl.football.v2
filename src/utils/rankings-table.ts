/**
 * Ranking columns for the Free Agents tables.
 *
 * Both leagues' Free Agents pages build their table body by string
 * concatenation inside an Astro `define:vars` script. That is a *classic*
 * script, so it cannot `import` — the two halves talk over CustomEvents on
 * `document` instead (see
 * docs/claude/insights/features/rankings-integration.md for the full protocol).
 * This module is the importable half.
 *
 * It lives here rather than in either page because `theleague/players.astro`
 * and `afl-fantasy/players.astro` are near-identical siblings, and a ranking
 * fix landing in one and not the other is a recurring bug class in this repo.
 *
 * Deliberately does NOT read localStorage itself: `buildRankingLookup()`
 * defaults to `getAllImports()`, which is already league-scoped by
 * `rankings-scope.ts`. Reaching around it would read TheLeague's board on an
 * AFL page.
 */

import {
  buildRankingLookup,
  onRankingsChanged,
  type RankingColumn,
  type RankingLookup,
} from './rankings-lookup';

export interface RankingTableOptions {
  /** The table to inject headers into, e.g. `.players-table`. */
  tableSelector: string;
  /** The `<th>` that ranking headers are inserted after, e.g. `[data-sort="weight"]`. */
  anchorSelector: string;
  /**
   * Extra classes for the composite ("My Rank") `<th>` only. TheLeague tags it
   * into its Value view; the AFL has no such view.
   */
  compositeThClasses?: string[];
}

/**
 * Ceiling on ranking columns.
 *
 * Both Free Agents tables are already wide; past five the ranking block starts
 * pushing the player column off a laptop screen and the numbers stop being
 * comparable at a glance. My Rank always takes one of the five.
 */
export const MAX_RANKING_COLUMNS = 5;

/**
 * The ranking columns the table actually shows.
 *
 * Two rules, both about respecting a decision the owner already made:
 *
 * - **No Average column.** It is the unweighted mean of every import, which
 *   means it includes sources the owner deliberately left OUT of their
 *   composite. Once My Rank exists, Average is a second opinion contradicting
 *   the one they built on purpose.
 * - **Only the sources feeding My Rank.** An unticked source is one the owner
 *   has already said shouldn't weigh on the decision, so it doesn't earn a
 *   column either — that's what the My Rank editor is for.
 *
 * Falls back to the raw import list when there's no composite at all, so an
 * owner who unticked everything still sees their boards rather than a table
 * that silently lost its ranking columns.
 */
export function visibleRankingColumns(columns: RankingColumn[]): RankingColumn[] {
  const withoutAverage = columns.filter((c) => !c.isAverage);
  const board = withoutAverage.filter((c) => c.isComposite || c.isCompositeMember);
  const chosen = board.length > 0 ? board : withoutAverage;

  return chosen.slice(0, MAX_RANKING_COLUMNS).map((col) =>
    // The member/non-member separator has nothing left to separate once the
    // non-members are gone — it would just draw a border at the table edge.
    col.isLastCompositeMember ? { ...col, isLastCompositeMember: false } : col,
  );
}

/** Dispatch a CustomEvent on document (synchronous). */
function emit(name: string, detail?: Record<string, unknown>): void {
  document.dispatchEvent(new CustomEvent(name, { detail: detail ?? {} }));
}

/**
 * Read a value the inline script owns, by dispatching an event with a mutable
 * detail object that its listener fills in place. Synchronous — CustomEvent
 * dispatch runs listeners before returning.
 */
function probe(name: string): Record<string, unknown> {
  const detail: Record<string, unknown> = {};
  document.dispatchEvent(new CustomEvent(name, { detail }));
  return detail;
}

/**
 * The classes a ranking `<td>` or `<th>` carries, beyond the base ones.
 *
 * Exported so the pages' inline `render()` can emit matching `<td>` classes —
 * it can't import, so it re-states this list, and the test that pins the two
 * in sync points here.
 */
export function rankingCellClasses(col: RankingColumn): string[] {
  const classes: string[] = [];
  if (col.isAverage) classes.push('col-ranking-avg');
  if (col.isComposite) classes.push('col-ranking-composite');
  if (col.isLastCompositeMember) classes.push('col-ranking-member-last');
  return classes;
}

/** Tooltip text for a ranking column header. */
export function rankingHeaderTitle(col: RankingColumn, allColumns: RankingColumn[]): string {
  if (col.isComposite) {
    const members = allColumns.filter((c) => c.isCompositeMember).length;
    return `My Rank — weighted composite of ${members} ranking sources`;
  }
  if (col.isAverage) {
    return `Average Rank across ${allColumns.length - 1} imports`;
  }
  return `${col.fullName} (${col.playerCount} players)`;
}

function injectRankingColumns(options: RankingTableOptions): void {
  const lookup: RankingLookup = buildRankingLookup();

  const limitedColumns = visibleRankingColumns(lookup.columns);
  const limitedLookup: RankingLookup = { ...lookup, columns: limitedColumns };

  // A column can disappear underneath an active sort — untick a source in the
  // My Rank editor and the table would keep sorting by a column nobody can
  // see. Fall back to My Rank (or whatever leads now).
  const sortKey = probe('rankings:get-sort').currentSort;
  if (typeof sortKey === 'string' && sortKey.startsWith('ranking_')) {
    const stillVisible = limitedColumns.some((c) => `ranking_${c.importId}` === sortKey);
    if (!stillVisible && limitedColumns.length > 0) {
      emit('rankings:set-sort', { key: `ranking_${limitedColumns[0].importId}`, dir: 'asc' });
    }
  }

  // Tell the inline script about the new lookup before touching the DOM, so a
  // re-render triggered below already has the matching column list.
  emit('rankings:set-lookup', {
    lookup: limitedLookup,
    hasColumns: limitedColumns.length > 0,
    hasComposite: limitedColumns.some((c) => c.isComposite),
  });

  // Remove any previously injected ranking <th> elements
  document
    .querySelectorAll(`${options.tableSelector} th[data-ranking-col]`)
    .forEach((th) => th.remove());

  if (limitedColumns.length === 0) {
    emit('rankings:refilter');
    return;
  }

  const headerRow = document.querySelector(`${options.tableSelector} thead tr`);
  const anchorTh = headerRow?.querySelector(options.anchorSelector);
  if (!anchorTh) return;

  // Insert in reverse so repeated `after()` calls on the same anchor land in order.
  for (const col of [...limitedColumns].reverse()) {
    const th = document.createElement('th');
    th.className = 'sortable col-num col-group--rankings';
    th.dataset.sort = `ranking_${col.importId}`;
    th.dataset.rankingCol = 'true';

    for (const cls of rankingCellClasses(col)) th.classList.add(cls);
    if (col.isComposite) {
      for (const cls of options.compositeThClasses ?? []) th.classList.add(cls);
    }
    th.title = rankingHeaderTitle(col, limitedColumns);

    th.innerHTML = `<div class="th-content">${col.header}</div>`;

    th.addEventListener('click', () => {
      const sortKey = `ranking_${col.importId}`;
      const { currentSort } = probe('rankings:get-sort');
      if (sortKey === currentSort) {
        const arrow = th.querySelector('.sort-arrow');
        const wasAsc = arrow && arrow.textContent === '▲';
        emit('rankings:set-sort', { key: sortKey, dir: wasAsc ? 'desc' : 'asc' });
      } else {
        // Ranking columns default to ascending — rank 1 (best) at the top.
        emit('rankings:set-sort', { key: sortKey, dir: 'asc' });
      }
      emit('rankings:refresh-table');
    });

    anchorTh.after(th);
  }

  emit('rankings:refilter');
}

/**
 * Wire ranking columns into a Free Agents table.
 *
 * Call once at module scope. Handles the inline script's ready signal, Astro
 * view transitions, and re-injection when the owner's board changes in this
 * tab or another one.
 */
export function initRankingTable(options: RankingTableOptions): void {
  let unsubscribe: (() => void) | null = null;

  function init(): void {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    injectRankingColumns(options);

    unsubscribe = onRankingsChanged(() => injectRankingColumns(options));
  }

  document.addEventListener('rankings:page-ready', () => init());

  // A module script runs after the document is parsed, so an inline classic
  // script that already fired `rankings:page-ready` did so before the listener
  // above existed. Probe once on load for that case rather than relying on the
  // ClientRouter's `astro:page-load` to be the only rescue.
  queueMicrotask(() => {
    if (probe('rankings:get-sort').currentSort !== undefined) init();
  });

  // Astro view transitions: the inline script re-runs and fires
  // `rankings:page-ready`, but if this module was already loaded the event can
  // land before the listener above is re-attached. Probe for a live inline
  // script instead of assuming either ordering.
  document.addEventListener('astro:page-load', () => {
    queueMicrotask(() => {
      if (probe('rankings:get-sort').currentSort !== undefined) init();
    });
  });
}
