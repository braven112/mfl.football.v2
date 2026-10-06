/**
 * The phone card's right-hand number follows the sort (user, 2026-10-05: "the
 * proj points swap out to the corresponding sort category … just like GM").
 *
 * In GM a future-year sort swaps in that year's salary cell. Coach's stats
 * mostly already sit on the card's lines 2-3 as cells, so moving a cell into
 * the corner would empty its line. Instead the projection cell carries one
 * hidden span per sortable stat, and CSS (roster-position-groups.css) shows
 * the one matching the tbody's `data-sort-col`, hiding the projection. On
 * desktop every span stays hidden, so the table is unchanged.
 */
import { escapeHtml } from '../player-cell-html';

/** Sort keys that swap the corner, with the short label printed after it. */
export const SORT_SLOT_LABELS: Readonly<Record<string, string>> = {
  avgSeason: 'avg',
  avgRecent: 'last 3',
  totalSeason: 'pts',
  oppAvg: 'opp avg',
  oppRank: 'opp rank',
  overUnder: 'O/U',
  spreadAmount: 'spread',
  temperature: 'temp',
};

/** The tbody attribute value for a sort: the key, or undefined to show Proj. */
export function sortSlotColumn(sortKey: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(SORT_SLOT_LABELS, sortKey) ? sortKey : undefined;
}

/**
 * The hidden spans for one row. A stat with no value prints "—", so a sort by
 * it still shows the row has none rather than falling back to the projection.
 */
export function sortSlotSpansHtml(values: Readonly<Record<string, string | null | undefined>>): string {
  return Object.entries(SORT_SLOT_LABELS)
    .map(([key, label]) => {
      const v = values[key];
      const text = v == null || String(v).trim() === '' ? '—' : String(v);
      return `<span class="rr-sortval" data-sort-slot="${key}" data-l="${escapeHtml(label)}">${escapeHtml(text)}</span>`;
    })
    .join('');
}

/** One decimal, or null — the feeds hand these through as strings or numbers. */
export function slotNumber(v: unknown, digits = 1): string | null {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n.toFixed(digits) : null;
}
