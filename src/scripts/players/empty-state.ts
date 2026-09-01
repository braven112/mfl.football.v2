/**
 * The Free Agents "nothing matched" row, shared by both leagues' tables.
 *
 * Before this, a filter combination that matched nothing left a bare header
 * row above ~300px of blank page — no message, no way to tell a search that
 * found nothing from a page that had broken. That distinction is treated as
 * load-bearing everywhere else in this repo (see
 * docs/claude/rules/lineups.md on "no lineup on file" vs "we couldn't read
 * it"); an empty table is the same class of ambiguity.
 *
 * Shared rather than written twice on purpose. The two pages compute their own
 * reasons — they have different filter state, and only the AFL has conferences
 * — but the copy and the markup are one thing, so a change to the wording
 * cannot land in one league and not the other. That is the recurring bug class
 * these two pages have (see tests/rankings-page-integration.test.ts).
 *
 * Styling lives in src/styles/players-empty-state.css, which both pages import
 * globally: this row is injected by JS, so it never carries the page's Astro
 * scope class and a scoped rule would silently miss it — the same reason
 * ranking-columns.css is global.
 */

/** Id of the reset control inside the row. Both pages delegate a click to it. */
export const PLAYERS_EMPTY_RESET_ID = 'players-empty-reset';

export interface EmptyStateReasons {
  /** The current search box text, when it is narrowing the list. */
  search?: string;
  /** The active position pill, omitted when it is showing everything. */
  position?: string;
  /** How many advanced filters are set. */
  advancedFilters?: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Name what is actually narrowing the list, so the reader can undo the right
 * one. Deliberately concrete — "no players match your filters" would make
 * someone open the filter panel to find out which.
 */
export function describeReasons(reasons: EmptyStateReasons): string {
  const parts: string[] = [];
  if (reasons.search) parts.push(`your search for &ldquo;${escapeHtml(reasons.search)}&rdquo;`);
  if (reasons.position) parts.push(`the ${escapeHtml(reasons.position)} filter`);
  const n = reasons.advancedFilters ?? 0;
  if (n > 0) parts.push(`${n} advanced filter${n === 1 ? '' : 's'}`);

  if (parts.length === 0) return 'No players are available right now.';
  if (parts.length === 1) return `No players match ${parts[0]}.`;
  if (parts.length === 2) return `No players match ${parts[0]} and ${parts[1]}.`;
  return `No players match ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`;
}

/**
 * One table row spanning the whole table.
 *
 * @param colspan how many columns the table has. Pass the header count — an
 *   over-wide colspan is clamped by the browser, a short one leaves the row
 *   sitting under half the table.
 */
export function playersEmptyStateRow(colspan: number, reasons: EmptyStateReasons): string {
  const anyReason =
    !!reasons.search || !!reasons.position || (reasons.advancedFilters ?? 0) > 0;
  return (
    `<tr class="players-empty"><td class="players-empty__cell" colspan="${colspan}">` +
    `<p class="players-empty__line">${describeReasons(reasons)}</p>` +
    (anyReason
      ? `<button type="button" id="${PLAYERS_EMPTY_RESET_ID}" class="players-empty__reset">` +
        `Show all players</button>`
      : '') +
    `</td></tr>`
  );
}
