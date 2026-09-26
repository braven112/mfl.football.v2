/**
 * The phone sort chips on TheLeague Rosters (docs/plans/rosters-mobile-layout.md,
 * "Controls above the rows"; idea B, user 2026-09-26).
 *
 * Below 768px the thead is hidden, so a row of chips stands in for the sortable
 * headers. The chip set is DERIVED from the headers — every
 * `th[data-sort-key]` that belongs to the mode on screen — never a second
 * hand-kept list, so a sortable column added to the table gets a chip with no
 * extra wiring (tests/rosters-phone-row.test.ts pins that).
 *
 * `nextSort` is the one rule for "what does a tap on this key do", used by the
 * header click AND the chip click, so desktop and phone cannot disagree.
 */
import { escapeHtml } from '../player-cell-html';

export type RosterViewMode = 'gm' | 'coach';
export type SortDir = 'asc' | 'desc';
export interface SortState { key: string; dir: SortDir }

/** One sortable header, as read from the thead. */
export interface SortHeader {
  key: string;
  /** `both` = the Player column, which is on screen in either mode. */
  mode: RosterViewMode | 'both';
  /** The header's visible text (the sort arrow stripped). */
  text: string;
  /** False when the page has hidden the column outright (My Rank with no board). */
  available?: boolean;
}

export interface SortChip { key: string; label: string }

/** The default sort — the Player column's key; a tap on it always resets. */
export const DEFAULT_SORT_KEY = 'position';

/**
 * Short chip labels. A key missing here falls back to its header's text, so a
 * new column still gets a chip; this only makes the known ones phone-sized.
 */
export const SORT_CHIP_LABELS: Readonly<Record<string, string>> = {
  position: 'Pos',
  salary_0: 'Salary',
  contractYears: 'Years',
  topRanking: 'My Rank',
  projectedPoints: 'Proj',
  oppRank: 'Opp rank',
  avgSeason: 'Avg',
  avgRecent: 'Last 3',
  oppAvg: 'Opp avg',
  spreadAmount: 'Spread',
  overUnder: 'O/U',
  temperature: 'Weather',
};

/**
 * The order the chips lead with, per mode (the user's idea-B mockup); every
 * other header follows in thead order. Coach puts Pos LAST: an owner in Coach
 * mode is sorting to decide who starts, not to re-find the depth chart.
 */
export const SORT_CHIP_LEAD: Readonly<Record<RosterViewMode, readonly string[]>> = {
  gm: ['position', 'salary_0', 'contractYears', 'topRanking'],
  coach: ['projectedPoints', 'oppRank', 'avgSeason'],
};
const SORT_CHIP_LAST: Readonly<Record<RosterViewMode, readonly string[]>> = {
  gm: [],
  coach: ['position'],
};

/** A header's mode, from the classes setMode() already toggles. */
export function headerMode(classList: { contains(c: string): boolean }): SortHeader['mode'] {
  if (classList.contains('coach-col')) return 'coach';
  if (classList.contains('gm-col')) return 'gm';
  return 'both';
}

function labelFor(h: SortHeader): string {
  const known = SORT_CHIP_LABELS[h.key];
  if (known) return known;
  // salary_1..4 are the future-year columns, headed by the bare year.
  if (/^salary_\d+$/.test(h.key)) return `${h.text} salary`;
  return h.text;
}

/** The chips for one mode, in chip order. */
export function buildSortChips(headers: readonly SortHeader[], mode: RosterViewMode): SortChip[] {
  const seen = new Set<string>();
  const own = headers.filter((h) => {
    if (h.available === false) return false;
    if (h.mode !== 'both' && h.mode !== mode) return false;
    if (seen.has(h.key)) return false;
    seen.add(h.key);
    return true;
  });
  const lead = SORT_CHIP_LEAD[mode];
  const last = SORT_CHIP_LAST[mode];
  const rank = (key: string) => {
    const l = lead.indexOf(key);
    if (l >= 0) return l - 1000;
    const z = last.indexOf(key);
    if (z >= 0) return 1000 + z;
    return 0;
  };
  return own
    .map((h, i) => ({ h, i }))
    .sort((a, b) => rank(a.h.key) - rank(b.h.key) || a.i - b.i)
    .map(({ h }) => ({ key: h.key, label: labelFor(h) }));
}

/**
 * What a tap on `key` does — the header's rule, now shared. The Player column
 * always resets to the default; the active key flips direction; any other key
 * starts descending, except My Rank, which starts ascending (1 = best on top).
 */
export function nextSort(key: string, current: SortState): SortState {
  if (key === DEFAULT_SORT_KEY) return { key: DEFAULT_SORT_KEY, dir: 'asc' };
  if (key === current.key) return { key, dir: current.dir === 'desc' ? 'asc' : 'desc' };
  return { key, dir: key === 'topRanking' ? 'asc' : 'desc' };
}

/**
 * The sort to keep when the chip set changes (a mode switch): the current one
 * if its chip is still offered, else the default — a sort by a column the
 * viewer can no longer see or re-tap is a sort they cannot undo.
 */
export function keepValidSort(current: SortState, chips: readonly SortChip[]): SortState {
  return chips.some((c) => c.key === current.key) ? current : { key: DEFAULT_SORT_KEY, dir: 'asc' };
}

const DIR_WORD: Record<SortDir, string> = { desc: 'descending', asc: 'ascending' };

/**
 * The chips' markup: toggle buttons (aria-pressed) in a labelled group. The
 * active chip shows ↑/↓ and says the direction in its accessible name; the
 * default Pos sort has no direction to flip, so it shows none.
 */
export function renderSortChips(chips: readonly SortChip[], active: SortState): string {
  return chips
    .map((c) => {
      const on = c.key === active.key;
      const directional = on && c.key !== DEFAULT_SORT_KEY;
      const arrow = directional ? `<span class="rr-chip__dir" aria-hidden="true">${active.dir === 'desc' ? '↓' : '↑'}</span>` : '';
      const said = directional ? `<span class="rr-chip__sr">, sorted ${DIR_WORD[active.dir]}</span>` : '';
      return `<button type="button" class="rr-chip${on ? ' rr-chip--on' : ''}" data-rr-chip="${escapeHtml(c.key)}" aria-pressed="${on ? 'true' : 'false'}">`
        + `<span class="rr-chip__label">${escapeHtml(c.label)}</span>${arrow}${said}</button>`;
    })
    .join('');
}
