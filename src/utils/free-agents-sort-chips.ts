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
