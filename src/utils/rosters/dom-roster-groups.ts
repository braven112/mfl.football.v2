/**
 * Sorting + position-group bands for a roster table the SERVER rendered — the
 * AFL-family Rosters page (components/afl-family/RostersPage.astro).
 *
 * TheLeague's page rebuilds its rows from data on every sort; this page has no
 * client row builder, so here the existing `<tr>`s are reordered in place and
 * the band rows are inserted between them. The rules are the shared ones:
 * `nextSort` / the chips (phone-sort.ts), the band markup and its figure
 * (position-groups.ts). So a tap does the same thing in both leagues.
 *
 * Each player row carries its sort values as `data-sv-<sortKey>` (a number, or
 * absent for none) and its band as `data-group`; `data-order` is its position
 * in the server's default (position, then name) order.
 */
import {
  DEFAULT_SORT_KEY,
  buildSortChips,
  nextChipSort,
  nextSort,
  renderSortChips,
  type SortHeader,
  type SortState,
} from './phone-sort';
import {
  formatGroupStat,
  groupHeaderRowHtml,
  groupStatSpec,
  readCollapsedGroups,
  readGrouping,
  toggleCollapsedGroup,
  type RosterGroupKey,
} from './position-groups';
import { sortSlotColumn } from './sort-value-slot';

/** A row's value for `key`, or NaN for none (sorts last either way). */
function rowValue(row: HTMLElement, key: string): number {
  if (key === 'topRanking') {
    // Filled by the rankings script after load; a blank cell is "unranked".
    const n = Number.parseFloat(row.querySelector('.ranking-cell')?.textContent?.replace(/[^0-9.]/g, '') ?? '');
    return Number.isFinite(n) ? n : NaN;
  }
  const raw = row.dataset[`sv${key.charAt(0).toUpperCase()}${key.slice(1)}`];
  const n = raw == null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function compareRows(key: string, dir: 'asc' | 'desc') {
  const order = (r: HTMLElement) => Number(r.dataset.order ?? 0);
  if (key === DEFAULT_SORT_KEY) return (a: HTMLElement, b: HTMLElement) => order(a) - order(b);
  const m = dir === 'desc' ? -1 : 1;
  return (a: HTMLElement, b: HTMLElement) => {
    const av = rowValue(a, key);
    const bv = rowValue(b, key);
    const an = Number.isNaN(av);
    const bn = Number.isNaN(bv);
    if (an && bn) return order(a) - order(b);
    if (an) return 1;
    if (bn) return -1;
    return (av - bv) * m || order(a) - order(b);
  };
}

export interface DomRosterGroupsOptions {
  /** This league's page root (already gated on its league by the caller). */
  root: HTMLElement;
  /** Every roster table to sort. Bands are drawn only in `bandedTbody`. */
  tables: HTMLTableElement[];
  /** The active roster's tbody: the one with bands and Grouped | All players. */
  bandedTbody: HTMLTableSectionElement | null;
}

/**
 * Wire header clicks, the phone chips, the Grouped | All players toggle and
 * band collapsing. Call once per page DOM (the caller's init guard).
 */
export function initDomRosterGroups({ root, tables, bandedTbody }: DomRosterGroupsOptions): void {
  let state: SortState = { key: DEFAULT_SORT_KEY, dir: 'asc' };

  const headerCells = () =>
    tables.flatMap((t) => Array.from(t.querySelectorAll<HTMLElement>('thead th[data-sort-key]')));

  const readHeaders = (): SortHeader[] => {
    const first = tables[0];
    if (!first) return [];
    return Array.from(first.querySelectorAll<HTMLElement>('thead th[data-sort-key]')).map((th) => ({
      key: th.dataset.sortKey ?? '',
      mode: 'both' as const,
      text: (th.textContent ?? '').trim(),
      // The rankings script shows the Rank column only when a board exists.
      available: th.dataset.sortKey !== 'topRanking' || th.style.display !== 'none',
    }));
  };

  const chipsRow = root.querySelector<HTMLElement>('[data-rr-chips]');
  const groupingCtl = root.querySelector<HTMLElement>('[data-rr-grouping]');
  // The phone's pinned "All players" chip: it flips the segmented switch
  // (hidden on a phone), so both run one code path.
  const groupingChip = root.querySelector<HTMLElement>('[data-rr-grouping-toggle]');

  const syncControls = () => {
    headerCells().forEach((th) => {
      const on = th.dataset.sortKey === state.key && state.key !== DEFAULT_SORT_KEY;
      th.classList.toggle('sort-active', on);
      th.classList.toggle('sort-asc', on && state.dir === 'asc');
      th.classList.toggle('sort-desc', on && state.dir === 'desc');
      th.setAttribute('aria-sort', on ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    });
    if (chipsRow) {
      const hadFocus = chipsRow.contains(document.activeElement)
        ? (document.activeElement as HTMLElement).dataset.rrChip
        : null;
      chipsRow.innerHTML = renderSortChips(buildSortChips(readHeaders(), 'coach'), state);
      if (hadFocus) chipsRow.querySelector<HTMLElement>(`[data-rr-chip="${CSS.escape(hadFocus)}"]`)?.focus();
    }
    const grouping = readGrouping(bandedTbody?.dataset.grouping);
    groupingCtl?.querySelectorAll<HTMLElement>('[data-grouping-value]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.groupingValue === grouping));
    });
    groupingChip?.setAttribute('aria-pressed', String(grouping === 'all'));
  };

  const render = () => {
    const compare = compareRows(state.key, state.dir);
    const slotCol = sortSlotColumn(state.key);
    for (const table of tables) {
      const tbody = table.tBodies[0];
      if (!tbody) continue;
      // The phone corner (Proj) follows a stat sort (sort-value-slot.ts).
      if (slotCol) tbody.dataset.sortCol = slotCol;
      else delete tbody.dataset.sortCol;
      tbody.querySelectorAll('tr.roster-group-row').forEach((r) => r.remove());
      const rows = Array.from(tbody.querySelectorAll<HTMLElement>('tr[data-player-id]'));
      const banded = tbody === bandedTbody && readGrouping(tbody.dataset.grouping) === 'grouped';

      if (!banded) {
        rows.sort(compare).forEach((r) => tbody.appendChild(r));
        continue;
      }

      // Bands keep the server's group order; rows sort inside each one.
      const groups = new Map<string, HTMLElement[]>();
      rows
        .slice()
        .sort((a, b) => Number(a.dataset.order ?? 0) - Number(b.dataset.order ?? 0))
        .forEach((r) => {
          const g = r.dataset.group ?? 'OTHER';
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g)!.push(r);
        });
      const collapsed = readCollapsedGroups(tbody.dataset.collapsedGroups);
      const spec = groupStatSpec(state.key, 'coach');
      const colspan = table.querySelectorAll('thead tr:first-child > th').length || 1;
      for (const [key, members] of groups) {
        let stat = null;
        if (spec) {
          const value = formatGroupStat(members.map((r) => rowValue(r, spec.key)), spec);
          stat = value ? { value, label: spec.label } : null;
        }
        tbody.insertAdjacentHTML(
          'beforeend',
          groupHeaderRowHtml({
            key: key as RosterGroupKey,
            count: members.length,
            colspan,
            collapsed: collapsed.has(key),
            stat,
          }),
        );
        members.sort(compare).forEach((r) => tbody.appendChild(r));
      }
    }
    syncControls();
  };

  const sortBy = (key: string, fromChip = false) => {
    // A chip's third tap clears the sort (nextChipSort); a header only flips.
    state = fromChip ? nextChipSort(key, state) : nextSort(key, state);
    // The default sort IS the grouped view: All players needs a ranking.
    if (state.key === DEFAULT_SORT_KEY && bandedTbody) bandedTbody.dataset.grouping = 'grouped';
    render();
  };

  headerCells().forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (key) sortBy(key);
    });
    th.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      const key = th.dataset.sortKey;
      if (key) sortBy(key);
    });
  });

  chipsRow?.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-rr-chip]');
    const key = chip?.dataset.rrChip;
    if (!chip || !key) return;
    chip.focus();
    sortBy(key, true);
  });

  groupingCtl?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-grouping-value]');
    if (!btn || !bandedTbody) return;
    const value = readGrouping(btn.dataset.groupingValue);
    if (value === readGrouping(bandedTbody.dataset.grouping)) return;
    bandedTbody.dataset.grouping = value;
    // All players with no sort yet ranks by projection, the Coach headline.
    if (value === 'all' && state.key === DEFAULT_SORT_KEY) state = { key: 'projectedPoints', dir: 'desc' };
    if (value === 'grouped' && state.key === DEFAULT_SORT_KEY) state = { key: DEFAULT_SORT_KEY, dir: 'asc' };
    render();
  });

  groupingChip?.addEventListener('click', () => {
    const next = readGrouping(bandedTbody?.dataset.grouping) === 'all' ? 'grouped' : 'all';
    groupingCtl?.querySelector<HTMLElement>(`[data-grouping-value="${next}"]`)?.click();
  });

  bandedTbody?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-group-toggle]');
    const key = btn?.dataset.groupToggle;
    if (!btn || !key) return;
    bandedTbody.dataset.collapsedGroups = toggleCollapsedGroup(bandedTbody.dataset.collapsedGroups, key);
    btn.setAttribute('aria-expanded', String(!readCollapsedGroups(bandedTbody.dataset.collapsedGroups).has(key)));
  });

  // The rankings script reveals the Rank column after load; its chip follows.
  const rankTh = tables[0]?.querySelector<HTMLElement>('thead th[data-sort-key="topRanking"]');
  if (rankTh) new MutationObserver(syncControls).observe(rankTh, { attributes: true, attributeFilter: ['style'] });

  // First paint: the server drew the bands without a figure.
  render();
}
