/**
 * The phone sort chips on every league's Free Agents page — the same row of
 * pills the Rosters page shows (phone-sort.ts), over the players table
 * (user, 2026-10-21: "sorting works like the roster page").
 *
 * Below 768px the players table drops most of its columns (free-agents-mobile.css),
 * so their headers cannot be tapped. The chips stand in for them. Like the
 * roster chips they are DERIVED from the thead — every sortable header in the
 * view on screen (Stats, Rankings, Value, Auction, Watch List) — never a
 * hand-kept list, so a column added to the table, or a ranking column the
 * rankings script injects, gets a chip with no extra wiring.
 *
 * A chip does not sort anything itself. Tapping one clicks its header, so the
 * page's own sort code (an inline script per page, which cannot import) stays
 * the only sorter and a chip can never disagree with the header. The chips
 * repaint from the header state the page leaves behind (`th.sorted` + its
 * ▲/▼ arrow). The one thing a header cannot do is the third tap: sort,
 * reverse, then back to the page's default order — that goes through the
 * page's `rankings:set-sort` bus with a null key, which both pages already
 * read as "restore my default".
 *
 * Sorting by a column a phone hides also SHOWS it (user, 2026-10-21: "the
 * column that's being sorted by doesn't show up"). As on the roster card
 * (sort-value-slot.ts), the right-hand Proj spot swaps to the sorted value
 * and its header to the sorted label; Proj comes back on any sort the row
 * already shows. A view with no Proj on the phone (Rankings, Value, Auction)
 * reveals the sorted column in place instead.
 */
import { renderSortChips, type SortChip, type SortState } from './rosters/phone-sort';

/** One sortable header, as read from the players thead. */
export interface FaSortHeader {
  key: string;
  /** The header's visible text (arrow and season tag stripped). */
  text: string;
  /** False when the active view hides the column (not merely the phone). */
  inView: boolean;
}

/**
 * Chip labels for headers whose text is too terse (or too long) off the
 * table. A key missing here — a ranking column, `seasonPts` ("2025 Pts") —
 * keeps its header's text.
 */
export const FA_SORT_CHIP_LABELS: Readonly<Record<string, string>> = {
  name: 'Name',
  age: 'Age',
  exp: 'Exp',
  draftRd: 'Draft',
  college: 'College',
  height: 'Height',
  weight: 'Weight',
  snapGames: 'Games',
  snaps: 'Snaps',
  snapPct: 'Snap %',
  ppg: 'PPG',
  projected: 'Proj',
  adpDyn: 'ADP',
  rostCount: 'Rostered',
  adds7: 'Adds 7d',
  contractYrs: 'Years',
  salary: 'Sal/Bid',
  auctionRank: 'Rank',
  auctionBid: 'Bid',
  auctionFranchise: 'Bidder',
  auctionInitTime: 'Started',
  auctionBidTime: 'Last bid',
  auctionTimeLeft: 'Time left',
  estimatedCost: 'Est. cost',
  dollarValue: '$ Value',
  stealValue: 'Steal',
};

/** The `#` column: it is a row number, not something an owner sorts by. */
const FA_SORT_CHIP_OMIT: readonly string[] = ['rank'];

/** The player's own numbers lead; every other header follows in thead order. */
export const FA_SORT_CHIP_LEAD: readonly string[] = ['projected', 'seasonPts', 'ppg', 'adpDyn'];

/** The chips for the view on screen, in chip order. */
export function buildFaSortChips(headers: readonly FaSortHeader[]): SortChip[] {
  const seen = new Set<string>();
  const own = headers.filter((h) => {
    if (!h.key || !h.inView) return false;
    if (FA_SORT_CHIP_OMIT.includes(h.key)) return false;
    // TheLeague's Value and Auction views both carry an `auctionBid` header.
    if (seen.has(h.key)) return false;
    seen.add(h.key);
    return true;
  });
  const rank = (key: string) => {
    const l = FA_SORT_CHIP_LEAD.indexOf(key);
    return l >= 0 ? l - 1000 : 0;
  };
  return own
    .map((h, i) => ({ h, i }))
    .sort((a, b) => rank(a.h.key) - rank(b.h.key) || a.i - b.i)
    .map(({ h }) => ({ key: h.key, label: FA_SORT_CHIP_LABELS[h.key] ?? h.text }));
}

/** How many taps in a row the active chip has had, for the third-tap reset. */
export interface FaChipTaps { key: string | null; taps: number }

/**
 * What a chip tap does: `header` (click the header — sort, or reverse) or
 * `reset` (the page's default order). The third tap in a row on the same
 * chip resets, as on the roster page; a sort that arrived some other way (a
 * header tap, the default) counts as one tap.
 */
export function faChipTap(key: string, activeKey: string | null, prev: FaChipTaps): { action: 'header' | 'reset'; next: FaChipTaps } {
  if (key !== activeKey) return { action: 'header', next: { key, taps: 1 } };
  const taps = prev.key === key ? prev.taps : 1;
  if (taps >= 2) return { action: 'reset', next: { key: null, taps: 0 } };
  return { action: 'header', next: { key, taps: taps + 1 } };
}

const PHONE = '(max-width: 767px)';

export type SortSlotPlan = 'none' | 'swap' | 'reveal';

/**
 * Where the sorted value goes on a phone: nowhere when the row already shows
 * it (or on desktop, where every column does), into the Proj spot when the
 * row has one, else its own column, revealed.
 */
export function sortSlotPlan(o: {
  phone: boolean;
  activeKey: string | null;
  /** The sorted column belongs to the view on screen. */
  inView: boolean;
  /** …but the phone CSS hides it. */
  hiddenOnPhone: boolean;
  /** The row shows a Proj column to swap into. */
  projShown: boolean;
}): SortSlotPlan {
  if (!o.phone || !o.activeKey || !o.inView || !o.hiddenOnPhone) return 'none';
  if (o.activeKey === 'projected') return 'none';
  return o.projShown ? 'swap' : 'reveal';
}

function headerText(th: HTMLElement): string {
  const copy = th.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.sort-arrow, .th-season').forEach((n) => n.remove());
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * In the active view? The view toggles write an inline `display: none` on
 * every column they hide; the phone CSS hides more (`.m-hide`) with
 * `!important`, and those are exactly the columns a chip is for. So inline
 * `none` means "not in this view" — unless the phone CSS shows the column
 * anyway (TheLeague's Proj, hidden on desktop, shown in a phone's Stats row).
 */
function inView(th: HTMLElement): boolean {
  if (th.style.display !== 'none') return true;
  return getComputedStyle(th).display !== 'none';
}

/** Put every cell this module changed back the way the page rendered it. */
function clearSortSlot(table: HTMLTableElement): void {
  table.querySelectorAll<HTMLElement>('td[data-fa-orig]').forEach((td) => {
    td.innerHTML = td.dataset.faOrig ?? '';
    delete td.dataset.faOrig;
  });
  table.querySelectorAll<HTMLElement>('th[data-fa-slot]').forEach((th) => {
    delete th.dataset.faSlot;
    th.style.removeProperty('--fa-slot-color');
  });
  table.querySelectorAll<HTMLElement>('[data-fa-reveal]').forEach((el) => {
    el.style.removeProperty('display');
    delete el.dataset.faReveal;
  });
  delete table.dataset.faSlotKey;
}

/**
 * Show the sorted column on a phone (see the header note). Idempotent: it
 * runs after every re-render and re-reads the table each time, because the
 * page rebuilds its rows from data on every sort, filter and "load more".
 */
function applySortSlot(table: HTMLTableElement, active: SortState | null): void {
  const headerRow = table.tHead?.rows[0];
  if (!headerRow) return;
  const ths = Array.from(headerRow.cells) as HTMLElement[];
  const sortedTh = active
    ? ths.find((th) => th.dataset.sort === active.key && inView(th)) ?? null
    : null;
  const projTh = ths.find((th) => th.dataset.sort === 'projected' && getComputedStyle(th).display !== 'none') ?? null;
  // The reveal writes an inline display, so ask whether the PHONE CSS hides
  // the column — the marker says this module is what is showing it.
  const hiddenOnPhone = !!sortedTh && (sortedTh.dataset.faReveal != null || getComputedStyle(sortedTh).display === 'none');
  const plan = sortSlotPlan({
    phone: window.matchMedia(PHONE).matches,
    activeKey: active?.key ?? null,
    inView: !!sortedTh,
    hiddenOnPhone,
    projShown: !!projTh,
  });
  const want = plan === 'none' || !active ? '' : `${plan}:${active.key}:${active.dir}`;
  if (table.dataset.faSlotKey !== want) clearSortSlot(table);
  if (!want || !active || !sortedTh) return;
  table.dataset.faSlotKey = want;

  const from = ths.indexOf(sortedTh);
  const rows = Array.from(table.tBodies[0]?.rows ?? []).filter((r) => r.cells.length === ths.length);

  if (plan === 'reveal') {
    for (const el of [sortedTh, ...rows.map((r) => r.cells[from] as HTMLElement)]) {
      // Checked on the style itself: a view toggle re-render clears it.
      if (el.style.getPropertyPriority('display') === 'important') continue;
      el.dataset.faReveal = '';
      el.style.setProperty('display', 'table-cell', 'important');
    }
    return;
  }

  const to = ths.indexOf(projTh!);
  const label = FA_SORT_CHIP_LABELS[active.key] ?? headerText(sortedTh);
  const slot = `${label} ${active.dir === 'asc' ? '▲' : '▼'}`;
  if (projTh!.dataset.faSlot !== slot) projTh!.dataset.faSlot = slot;
  // Wear the page's own "sorted" colour, which differs by league and style:
  // the sorted header is hidden, but its computed colour still resolves.
  const color = getComputedStyle(sortedTh).color;
  if (projTh!.style.getPropertyValue('--fa-slot-color') !== color) projTh!.style.setProperty('--fa-slot-color', color);
  for (const r of rows) {
    const cell = r.cells[to] as HTMLElement;
    if (cell.dataset.faOrig != null) continue;
    cell.dataset.faOrig = cell.innerHTML;
    cell.innerHTML = (r.cells[from] as HTMLElement).innerHTML;
  }
}

function readActive(table: HTMLTableElement): SortState | null {
  const th = table.querySelector<HTMLElement>('thead th.sortable.sorted[data-sort]');
  const key = th?.dataset.sort;
  if (!th || !key) return null;
  return { key, dir: th.querySelector('.sort-arrow')?.textContent === '▲' ? 'asc' : 'desc' };
}

/**
 * Wire the chip row on whichever Free Agents page is in the DOM. Idempotent
 * per page DOM, so it is safe on every `astro:page-load`: under the
 * ClientRouter both leagues' scripts stay registered, and the row it binds
 * is the one the swap just brought in.
 */
export function initFaSortChips(): void {
  const row = document.querySelector<HTMLElement>('[data-fa-sort-chips]');
  const table = document.querySelector<HTMLTableElement>('#players-table');
  if (!row || !table?.tHead || row.dataset.init) return;
  row.dataset.init = 'true';

  let taps: FaChipTaps = { key: null, taps: 0 };
  let shownKey: string | null = null;

  const headers = () =>
    Array.from(table.querySelectorAll<HTMLElement>('thead th.sortable[data-sort]'));

  const sync = () => {
    if (!row.isConnected) return;
    const active = readActive(table);
    const hadFocus = row.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.rrChip
      : null;
    const chips = buildFaSortChips(
      headers().map((th) => ({ key: th.dataset.sort ?? '', text: headerText(th), inView: inView(th) })),
    );
    row.innerHTML = renderSortChips(chips, active ?? { key: '', dir: 'desc' });
    // innerHTML replaced the chip a keyboard user pressed — put focus back.
    if (hadFocus) row.querySelector<HTMLElement>(`[data-rr-chip="${CSS.escape(hadFocus)}"]`)?.focus();
    // Bring a newly active chip into view inside the row, never the page.
    const activeKey = active?.key ?? null;
    if (activeKey !== shownKey) {
      shownKey = activeKey;
      const on = row.querySelector<HTMLElement>('.rr-chip--on');
      if (on && row.clientWidth) {
        const start = on.offsetLeft - row.offsetLeft;
        if (start < row.scrollLeft || start + on.offsetWidth > row.scrollLeft + row.clientWidth) {
          row.scrollLeft = Math.max(0, start - 12);
        }
      }
    }
    applySortSlot(table, active);
  };

  // Every re-render rewrites the header classes, arrows and view styles, and
  // the rankings script inserts its columns late — repaint once per batch.
  let queued = false;
  const queueSync = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      sync();
    });
  };
  const observer = new MutationObserver(() => {
    if (!table.isConnected) {
      observer.disconnect();
      return;
    }
    queueSync();
  });
  observer.observe(table.tHead, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
  // New rows (a re-render, "load more") need the sorted value swapped in.
  const tbody = table.tBodies[0];
  if (tbody) observer.observe(tbody, { childList: true });
  window.matchMedia(PHONE).addEventListener('change', queueSync);

  row.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-rr-chip]');
    const key = chip?.dataset.rrChip;
    if (!chip || !key) return;
    chip.focus();
    const { action, next } = faChipTap(key, readActive(table)?.key ?? null, taps);
    taps = next;
    if (action === 'reset') {
      document.dispatchEvent(new CustomEvent('rankings:set-sort', { detail: { key: null } }));
      document.dispatchEvent(new CustomEvent('rankings:refresh-table'));
    } else {
      table.querySelector<HTMLElement>(`thead th.sortable[data-sort="${CSS.escape(key)}"]`)?.click();
    }
  });

  sync();
}
