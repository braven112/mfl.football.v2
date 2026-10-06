/**
 * Position-group bands on the Rosters table (user, 2026-10-05: "options A + B").
 *
 * - **Grouped** (default): a header row opens every group: QB, RB, WR, TE, PK,
 *   DEF on the active roster, then Practice squad and Injured reserve. It names
 *   the group, counts it, totals the stat the table is sorted by, and collapses
 *   the group on a tap. A sort reorders rows INSIDE each group, as before.
 * - **All players**: no bands; a sort ranks every rostered player against
 *   every other one, like the Free Agents table.
 *
 * Both state flags live on the tbody (`data-grouping`, `data-collapsed-groups`)
 * rather than in a script closure: the page's init can run twice on one load,
 * each instance with its own closure, and the tbody is the one copy they share.
 * `data-collapsed-groups` is space-separated so CSS can hide a collapsed
 * group's rows with `~=` and no re-render.
 */
import { escapeHtml } from '../player-cell-html';
import { phonePosKey } from './phone-row';

export type RosterGrouping = 'grouped' | 'all';
export type RosterGroupMode = 'gm' | 'coach';

/** Band order on the page. Unknown positions fall into OTHER, after DEF. */
export const ROSTER_GROUP_ORDER = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF', 'OTHER', 'PS', 'IR'] as const;
export type RosterGroupKey = (typeof ROSTER_GROUP_ORDER)[number];

export const ROSTER_GROUP_LABELS: Readonly<Record<RosterGroupKey, string>> = {
  QB: 'Quarterbacks',
  RB: 'Running backs',
  WR: 'Wide receivers',
  TE: 'Tight ends',
  PK: 'Kickers',
  DEF: 'Defense',
  OTHER: 'Other',
  PS: 'Practice squad',
  IR: 'Injured reserve',
};

/**
 * The band a row belongs to. Practice squad and IR are one band each, whatever
 * the position: they are small, and their players cannot start.
 */
export function rosterGroupKey(row: { position?: string | null; displayTag?: string | null }): RosterGroupKey {
  const tag = String(row.displayTag ?? 'active');
  if (tag === 'practice') return 'PS';
  if (tag === 'injured') return 'IR';
  return phonePosKey(row.position) || 'OTHER';
}

export function readGrouping(value: string | null | undefined): RosterGrouping {
  return value === 'all' ? 'all' : 'grouped';
}

export function readCollapsedGroups(value: string | null | undefined): Set<string> {
  return new Set(String(value ?? '').split(/\s+/).filter(Boolean));
}

/** Toggle one group in the space-separated attribute value. */
export function toggleCollapsedGroup(value: string | null | undefined, key: string): string {
  const set = readCollapsedGroups(value);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return ROSTER_GROUP_ORDER.filter((k) => set.has(k)).join(' ');
}

export interface GroupStatSpec {
  /** The sort key whose values are aggregated. */
  key: string;
  agg: 'sum' | 'avg';
  format: 'points' | 'money' | 'years' | 'rank';
  /** Short label after the number: "proj", "avg opp #", "2027". */
  label: string;
}

const POINT_SUMS: Readonly<Record<string, string>> = {
  projectedPoints: 'proj',
  avgSeason: 'avg',
  avgRecent: 'last 3',
  totalSeason: 'pts',
};

/**
 * What a band header totals, given the active sort (user: "update the group
 * proj if I choose Avg"). The default sort totals the mode's headline number:
 * salary in GM, projection in Coach. Keys with no meaningful group figure
 * (spread, O/U, weather, My Rank) show none.
 *
 * `salaryLabel` names a salary_N column (its year), read from the header.
 */
export function groupStatSpec(
  sortKey: string,
  mode: RosterGroupMode,
  salaryLabel: (key: string) => string = () => 'salary',
): GroupStatSpec | null {
  if (sortKey === 'position') {
    return mode === 'coach'
      ? { key: 'projectedPoints', agg: 'sum', format: 'points', label: 'proj' }
      : { key: 'salary_0', agg: 'sum', format: 'money', label: salaryLabel('salary_0') };
  }
  if (POINT_SUMS[sortKey]) return { key: sortKey, agg: 'sum', format: 'points', label: POINT_SUMS[sortKey] };
  if (sortKey === 'oppAvg') return { key: sortKey, agg: 'avg', format: 'points', label: 'opp avg' };
  if (sortKey === 'oppRank') return { key: sortKey, agg: 'avg', format: 'rank', label: 'avg opp' };
  if (sortKey === 'contractYears') return { key: sortKey, agg: 'avg', format: 'years', label: 'avg yrs' };
  if (sortKey === 'salary' || /^salary_\d+$/.test(sortKey)) {
    return { key: sortKey, agg: 'sum', format: 'money', label: salaryLabel(sortKey) };
  }
  return null;
}

/** Sort values at or past this are "no value" (UFA, dash, unranked). */
const NO_VALUE = Number.MAX_SAFE_INTEGER - 1;

const money = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
};

/**
 * The band's figure, or null when no row in it has a value (an empty
 * projection feed, an all-UFA salary year) — a "0.0" there would read as data.
 */
export function formatGroupStat(values: number[], spec: GroupStatSpec): string | null {
  const real = values.filter((v) => Number.isFinite(v) && v < NO_VALUE);
  if (!real.length) return null;
  const total = real.reduce((s, v) => s + v, 0);
  if (spec.agg === 'sum' && total === 0) return null;
  const n = spec.agg === 'avg' ? total / real.length : total;
  switch (spec.format) {
    case 'money': return money(n);
    case 'rank': return `#${Math.round(n)}`;
    case 'years': return n.toFixed(1);
    default: return n.toFixed(1);
  }
}

export interface GroupHeaderInput {
  key: RosterGroupKey;
  count: number;
  colspan: number;
  collapsed: boolean;
  /** Pre-formatted figure + its label, or null for none. */
  stat?: { value: string; label: string } | null;
}

/**
 * One band header row. Used by the server render and the client row builder
 * alike, so the two cannot drift. The whole band is one button: a tap anywhere
 * on it collapses the group, and a screen reader hears "Quarterbacks, 2
 * players, collapse".
 */
export function groupHeaderRowHtml({ key, count, colspan, collapsed, stat }: GroupHeaderInput): string {
  const label = ROSTER_GROUP_LABELS[key] ?? ROSTER_GROUP_LABELS.OTHER;
  const k = escapeHtml(key);
  const statHtml = stat
    ? `<span class="roster-group-row__stat">${escapeHtml(stat.value)} <span class="roster-group-row__stat-label">${escapeHtml(stat.label)}</span></span>`
    : '';
  return (
    `<tr class="roster-group-row" data-group-header="${k}">` +
    `<th scope="colgroup" colspan="${Math.max(1, colspan)}" class="roster-group-row__cell">` +
    `<button type="button" class="roster-group-row__toggle" data-group-toggle="${k}" aria-expanded="${collapsed ? 'false' : 'true'}">` +
    `<span class="roster-group-row__chev" aria-hidden="true"></span>` +
    `<span class="roster-group-row__dot" aria-hidden="true"></span>` +
    `<span class="roster-group-row__label">${escapeHtml(label)}</span>` +
    `<span class="roster-group-row__count">${count}<span class="roster-group-row__sr"> ${count === 1 ? 'player' : 'players'}</span></span>` +
    statHtml +
    `</button></th></tr>`
  );
}

/** How many rows each band holds, for its header's count. */
export function countGroups<T extends { position?: string | null; displayTag?: string | null }>(
  rows: T[],
): Map<RosterGroupKey, number> {
  const counts = new Map<RosterGroupKey, number>();
  for (const r of rows) {
    const k = rosterGroupKey(r);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}
