/**
 * Ask the History — how an answer table's cells read and link. Shared by the
 * server-rendered answer page and the question box's client script, so an
 * answer looks the same when it is asked and when it is shared.
 */

const TWO_DECIMALS = new Set(['pf', 'pa', 'pointDiff', 'avgPf', 'highGame', 'lowGame', 'finalPf', 'score', 'oppScore', 'margin', 'combined']);

/** Display text for one cell. */
export function formatCell(key, value) {
  if (value === null || value === undefined || value === '') return '–';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key === 'winPct' && typeof value === 'number') return value.toFixed(3).replace(/^0(?=\.)/, '');
  if (TWO_DECIMALS.has(key) && typeof value === 'number') {
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(value);
}

/**
 * Where a cell links, given the league's history base path (`/theleague`, or
 * '' on a league's own domain): the owner column opens the owner page, the
 * team column that franchise's all-owners history.
 */
export function cellHref(key, row, base) {
  if (key === 'owner' && row.ownerSlug) return `${base}/owners/${row.ownerSlug}`;
  if (key === 'team' && row.franchiseId) return `${base}/franchises/${row.franchiseId}?view=all`;
  return null;
}

/** Columns that read as numbers (right-aligned). */
export function isNumericColumn(table, index) {
  return table.rows.some((r) => typeof r.cells[index] === 'number');
}
