/**
 * Click-to-sort for plain server-rendered tables, with the sort kept in the
 * URL so a sorted view can be bookmarked or shared.
 *
 *   <table data-sortable="pages">
 *     <thead><tr>
 *       <th data-sort="text"><button type="button">Page</button></th>
 *       <th data-sort="num" aria-sort="descending"><button type="button">Views</button></th>
 *     </tr></thead>
 *     <tbody><tr><td data-v="Rosters">…</td><td data-v="120">120</td></tr></tbody>
 *   </table>
 *
 * - A column sorts when its `<th>` carries `data-sort` (`num` or `text`);
 *   a header without one is not sortable.
 * - A cell's `data-v` is its sort value when present (a timestamp behind
 *   "2h ago", a name behind a link); otherwise its text, with commas and `%`
 *   ignored for numbers.
 * - The first tap on a number sorts high to low, on text A to Z; another tap
 *   reverses. `aria-sort` on the `<th>` is the state, so the server's
 *   default sort is marked the same way.
 * - The URL carries `s.<table>=<column>-<a|d>` per table.
 */

export type SortDir = 'ascending' | 'descending';
export type SortKind = 'num' | 'text';

/** What a tap on a header does, given its current state. */
export function nextSortDir(kind: SortKind, current: string | null): SortDir {
	if (current === 'descending') return 'ascending';
	if (current === 'ascending') return 'descending';
	return kind === 'num' ? 'descending' : 'ascending';
}

/** A cell value as a number; blanks and dashes sort below every real value. */
export function sortNumber(raw: string): number {
	const n = Number(raw.replace(/[,%\s]/g, ''));
	return Number.isFinite(n) && raw.trim() !== '' && raw.trim() !== '—' ? n : Number.NEGATIVE_INFINITY;
}

export function compareSortValues(a: string, b: string, kind: SortKind, dir: SortDir): number {
	const sign = dir === 'ascending' ? 1 : -1;
	if (kind === 'num') {
		const x = sortNumber(a);
		const y = sortNumber(b);
		return x === y ? 0 : x < y ? -sign : sign;
	}
	return sign * a.localeCompare(b, 'en-US', { sensitivity: 'base', numeric: true });
}

function cellValue(row: HTMLTableRowElement, index: number): string {
	const cell = row.cells[index];
	if (!cell) return '';
	return cell.dataset.v ?? cell.textContent?.trim() ?? '';
}

function sortTable(table: HTMLTableElement, th: HTMLTableCellElement, dir: SortDir): void {
	const body = table.tBodies[0];
	if (!body) return;
	const index = th.cellIndex;
	const kind: SortKind = th.dataset.sort === 'text' ? 'text' : 'num';
	const rows = Array.from(body.rows).map((row, i) => ({ row, i, v: cellValue(row, index) }));
	// Ties keep their current order, so sorting by one column then another
	// reads as a secondary sort.
	rows.sort((a, b) => compareSortValues(a.v, b.v, kind, dir) || a.i - b.i);
	for (const { row } of rows) body.appendChild(row);
	for (const other of Array.from(table.tHead?.rows[0]?.cells ?? [])) other.removeAttribute('aria-sort');
	th.setAttribute('aria-sort', dir);
}

function urlKey(table: HTMLTableElement): string | null {
	const name = table.dataset.sortable;
	return name ? `s.${name}` : null;
}

/** Delegated click handler. Register once on `document`. */
export function onSortableHeaderClick(event: Event): void {
	const target = event.target as Element | null;
	const th = target?.closest?.('th[data-sort]') as HTMLTableCellElement | null;
	const table = th?.closest('table[data-sortable]') as HTMLTableElement | null;
	if (!th || !table) return;
	const kind: SortKind = th.dataset.sort === 'text' ? 'text' : 'num';
	const dir = nextSortDir(kind, th.getAttribute('aria-sort'));
	sortTable(table, th, dir);
	const key = urlKey(table);
	if (!key) return;
	const url = new URL(window.location.href);
	url.searchParams.set(key, `${th.cellIndex}-${dir === 'ascending' ? 'a' : 'd'}`);
	// Keep the router's own state: the ClientRouter reads history.state.
	history.replaceState(history.state, '', url);
}

/** Apply any sort the URL names to the tables under `root`. */
export function initSortableTables(root: ParentNode): void {
	const params = new URLSearchParams(window.location.search);
	for (const table of Array.from(root.querySelectorAll<HTMLTableElement>('table[data-sortable]'))) {
		const key = urlKey(table);
		const match = key ? /^(\d+)-([ad])$/.exec(params.get(key) ?? '') : null;
		if (!match) continue;
		const th = table.tHead?.rows[0]?.cells[Number(match[1])];
		if (th?.dataset.sort) sortTable(table, th, match[2] === 'a' ? 'ascending' : 'descending');
	}
}
