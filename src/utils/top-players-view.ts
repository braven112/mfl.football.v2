/**
 * Top Players — URL params in, a rendered view out.
 *
 * Every control on the page is an `<a href>` that changes a param, so this
 * module is the whole of the page's state handling and the page itself stays
 * declarative. Same rule Strength of Division follows: a control whose only
 * job is switching a URL param should be a link, not a script.
 *
 * Params are UNTRUSTED. Each one degrades to the default rather than
 * rendering an empty table — a bad `?week=` must never look like "nobody
 * scored", which is indistinguishable from a broken feed.
 */
import type { TopPlayersFile, TopPlayerRow } from '../types/top-players';
import { positionOrder } from '../constants/roster-constants';

/** How many rows each position shows in the stacked-leaderboards view. */
export const LEADERBOARD_DEPTH = 10;

export type SortKey = 'points' | 'avg' | 'games' | 'best' | 'name' | 'rank';
export type SortDir = 'asc' | 'desc';

export interface TopPlayersView {
  /** 'leaders' = a section per position; 'overall' = one table; else a position code. */
  mode: 'leaders' | 'overall' | 'position';
  /** Set when mode === 'position'. */
  position: string | null;
  /** 0 = season totals. Otherwise a week that actually has scores. */
  week: number;
  sort: SortKey;
  dir: SortDir;
}

/**
 * Positions in football order, not alphabetical, with anything the feed
 * carries that `positionOrder` does not (IDP, if a league ever scores it)
 * appended rather than dropped.
 */
export function orderedPositions(file: TopPlayersFile): string[] {
  const known = positionOrder.filter((p) => file.positions.includes(p));
  const extra = file.positions.filter((p) => !positionOrder.includes(p as never)).sort();
  return [...known, ...extra];
}

const SORT_KEYS: SortKey[] = ['points', 'avg', 'games', 'best', 'name', 'rank'];

/** The default direction for a column — points sort high-first, names A-first. */
export function defaultDirFor(sort: SortKey): SortDir {
  return sort === 'name' || sort === 'rank' ? 'asc' : 'desc';
}

export function resolveTopPlayersView(url: URL, file: TopPlayersFile): TopPlayersView {
  const params = url.searchParams;

  // `?week=` — only a week the feed actually scored. Anything else (a future
  // week, a bye, a word, week 0) falls back to season totals. The hero links
  // here with the COMPLETED week, but a stale bookmark must not show a blank.
  // Matched STRICTLY: `Number.parseInt` would read "1.5" and "1abc" as week 1
  // and quietly serve a week the reader did not ask for.
  const weekRaw = (params.get('week') ?? '').trim();
  const weekParam = /^\d+$/.test(weekRaw) ? Number(weekRaw) : NaN;
  const week = file.completedWeeks.includes(weekParam) ? weekParam : 0;

  const positions = orderedPositions(file);
  const viewParam = (params.get('view') ?? '').trim();
  const positionMatch = positions.find((p) => p.toLowerCase() === viewParam.toLowerCase());

  let mode: TopPlayersView['mode'] = 'leaders';
  let position: string | null = null;
  if (positionMatch) {
    mode = 'position';
    position = positionMatch;
  } else if (viewParam.toLowerCase() === 'overall') {
    mode = 'overall';
  }

  const sortParam = (params.get('sort') ?? '').toLowerCase() as SortKey;
  const sort: SortKey = SORT_KEYS.includes(sortParam) ? sortParam : 'points';
  const dirParam = (params.get('dir') ?? '').toLowerCase();
  const dir: SortDir = dirParam === 'asc' || dirParam === 'desc' ? dirParam : defaultDirFor(sort);

  return { mode, position, week, sort, dir };
}

/** The points a row is judged on in this view: one week's, or the season's. */
export function pointsFor(row: TopPlayerRow, week: number): number {
  return week > 0 ? (row.weeks[String(week)] ?? 0) : row.total;
}

/**
 * The rows a view shows, sorted.
 *
 * In WEEK mode only players who scored that week appear — a player on a bye
 * is absent, not a zero, because a table of zeroes below the real scores says
 * nothing and buries the leaders.
 */
export function rowsFor(file: TopPlayersFile, view: TopPlayersView): TopPlayerRow[] {
  let rows = file.players;
  if (view.mode === 'position' && view.position) {
    rows = rows.filter((p) => p.position === view.position);
  }
  if (view.week > 0) {
    rows = rows.filter((p) => p.weeks[String(view.week)] !== undefined);
  }

  const sign = view.dir === 'asc' ? 1 : -1;
  const value = (p: TopPlayerRow): number => {
    switch (view.sort) {
      case 'avg':
        return view.week > 0 ? pointsFor(p, view.week) : p.avg;
      case 'games':
        return p.games;
      case 'best':
        return view.week > 0 ? pointsFor(p, view.week) : p.best;
      case 'rank':
        return p.rank;
      default:
        return pointsFor(p, view.week);
    }
  };

  // Ties break on name so the order is stable — the same reason the compute
  // script sorts that way. An unstable order here would make two renders of
  // the same URL disagree.
  return [...rows].sort((a, b) =>
    view.sort === 'name'
      ? sign * a.name.localeCompare(b.name)
      : sign * (value(a) - value(b)) || a.name.localeCompare(b.name),
  );
}

/** The stacked-leaderboards view: each position's top rows, in football order. */
export function leaderboardsFor(
  file: TopPlayersFile,
  view: TopPlayersView,
): { position: string; rows: TopPlayerRow[] }[] {
  return orderedPositions(file)
    .map((position) => ({
      position,
      rows: rowsFor(file, { ...view, mode: 'position', position }).slice(0, LEADERBOARD_DEPTH),
    }))
    .filter((section) => section.rows.length > 0);
}

/**
 * Build a link that changes ONE param and keeps the rest.
 *
 * Keeping the others is the point: switching position must not silently drop
 * the week the reader arrived on from the hero.
 */
export function viewHref(
  basePath: string,
  view: TopPlayersView,
  patch: Partial<Pick<TopPlayersView, 'mode' | 'position' | 'week' | 'sort' | 'dir'>>,
): string {
  const next = { ...view, ...patch };
  const params = new URLSearchParams();
  if (next.mode === 'position' && next.position) params.set('view', next.position.toLowerCase());
  else if (next.mode === 'overall') params.set('view', 'overall');
  if (next.week > 0) params.set('week', String(next.week));
  if (next.sort !== 'points') params.set('sort', next.sort);
  if (next.dir !== defaultDirFor(next.sort)) params.set('dir', next.dir);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** The href a sortable column header points at — same key flips direction. */
export function sortHref(basePath: string, view: TopPlayersView, key: SortKey): string {
  const dir: SortDir =
    view.sort === key ? (view.dir === 'asc' ? 'desc' : 'asc') : defaultDirFor(key);
  return viewHref(basePath, view, { sort: key, dir });
}
