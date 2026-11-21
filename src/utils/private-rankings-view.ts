/**
 * The private rankings board's view logic: which rows a tab shows, how they
 * filter and sort, and who rosters each player. Pure (no fetch, no Astro), so
 * the tests can drive it; the data comes from `private-rankings.ts`.
 */

export interface BoardSource {
  label: string;
  fetchedAt: string | null;
  edition?: string;
  experts?: number;
  count: number;
}

/** FantasyPros consensus for a player: rank, the experts' best and worst, tier. */
export interface Consensus {
  rank: number;
  /** FantasyPros' rank at the player's position. */
  posRank?: number | null;
  best: number | null;
  worst: number | null;
  tier: number | null;
}

export interface BoardPlayer {
  id: string | null;
  name: string;
  pos: string;
  team: string;
  age: number | null;
  dynasty?: { fbg?: number; fbgTier?: number; dlf?: number; avg?: number; posRank?: string; fp?: Consensus; gap?: number; myPosRank?: number };
  rookie?: {
    fbg?: number;
    dlf?: number;
    avg?: number;
    fp?: Consensus;
    gap?: number;
    myPosRank?: number;
    rsp?: { posRank: string | null; score: number | null; grade: string | null; tier: string | null };
  };
  season?: {
    ros?: number;
    rosPosRank?: string;
    rosPts?: number | null;
    ppg?: number | null;
    weekPosRank?: string;
    weekPts?: number | null;
    matchup?: string;
    fp?: Consensus;
    gap?: number;
    myPosRank?: number;
  };
}

export interface BoardFile {
  league: { key: string; label: string };
  generatedAt: string;
  mflYear: number;
  rookieClass: number;
  sources: Record<string, BoardSource>;
  players: BoardPlayer[];
}

export const VIEWS = ['dynasty', 'rookies', 'season'] as const;
export type View = (typeof VIEWS)[number];
export const POSITIONS = ['all', 'QB', 'RB', 'WR', 'TE'] as const;
export type PositionFilter = (typeof POSITIONS)[number];
export const OWNERSHIP = ['all', 'mine', 'available', 'rostered'] as const;
export type OwnershipFilter = (typeof OWNERSHIP)[number];

/** The sortable columns of each tab; the first is the default. */
export const SORTS: Record<View, { key: string; label: string; dir: 'asc' | 'desc' }[]> = {
  dynasty: [
    { key: 'avg', label: 'Avg', dir: 'asc' },
    { key: 'fbg', label: 'FBG', dir: 'asc' },
    { key: 'dlf', label: 'DLF', dir: 'asc' },
    { key: 'fp', label: 'Consensus', dir: 'asc' },
    { key: 'gap', label: 'Gap', dir: 'desc' },
    { key: 'age', label: 'Age', dir: 'asc' },
  ],
  rookies: [
    { key: 'avg', label: 'Avg', dir: 'asc' },
    { key: 'fbg', label: 'FBG', dir: 'asc' },
    { key: 'dlf', label: 'DLF', dir: 'asc' },
    { key: 'fp', label: 'Consensus', dir: 'asc' },
    { key: 'gap', label: 'Gap', dir: 'desc' },
    { key: 'rsp', label: 'RSP score', dir: 'desc' },
  ],
  season: [
    { key: 'ros', label: 'ROS', dir: 'asc' },
    { key: 'fp', label: 'Consensus', dir: 'asc' },
    { key: 'gap', label: 'Gap', dir: 'desc' },
    { key: 'rosPts', label: 'ROS pts', dir: 'desc' },
    { key: 'ppg', label: 'PPG', dir: 'desc' },
    { key: 'weekPts', label: 'This week', dir: 'desc' },
  ],
};

export const PAGE_SIZE = 150;

export interface ViewQuery {
  view: View;
  pos: PositionFilter;
  own: OwnershipFilter;
  sort: string;
  dir: 'asc' | 'desc';
  all: boolean;
}

function oneOf<T extends string>(value: string | null, list: readonly T[], fallback: T): T {
  return value && (list as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function parseViewQuery(params: URLSearchParams): ViewQuery {
  const view = oneOf(params.get('view'), VIEWS, 'dynasty');
  const sorts = SORTS[view];
  const sort = sorts.find((s) => s.key === params.get('sort')) ?? sorts[0];
  const dir = params.get('dir') === 'asc' || params.get('dir') === 'desc' ? (params.get('dir') as 'asc' | 'desc') : sort.dir;
  return {
    view,
    pos: oneOf(params.get('pos'), POSITIONS, 'all'),
    own: oneOf(params.get('own'), OWNERSHIP, 'all'),
    sort: sort.key,
    dir,
    all: params.get('all') === '1',
  };
}

/** The number a row sorts by in a tab, or null when it has none. */
export function sortValue(p: BoardPlayer, view: View, key: string): number | null {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (key === 'age') return n(p.age);
  const block = view === 'dynasty' ? p.dynasty : view === 'rookies' ? p.rookie : p.season;
  if (key === 'fp') return n(block?.fp?.rank);
  if (key === 'gap') return n(block?.gap);
  if (view === 'dynasty') return n(p.dynasty?.[key as 'avg' | 'fbg' | 'dlf']);
  if (view === 'rookies') {
    if (key === 'rsp') return n(p.rookie?.rsp?.score);
    return n(p.rookie?.[key as 'avg' | 'fbg' | 'dlf']);
  }
  return n(p.season?.[key as 'ros' | 'rosPts' | 'ppg' | 'weekPts']);
}

/** Does a player belong on this tab at all? */
export function inView(p: BoardPlayer, view: View): boolean {
  if (view === 'dynasty') return p.dynasty?.avg != null;
  if (view === 'rookies') return p.rookie != null;
  return p.season?.ros != null || p.season?.weekPts != null;
}

export interface Ownership {
  /** Franchise ids that roster the player (in the owner's own conference, for the AFL). */
  holders: string[];
  mine: boolean;
}

export function ownershipOf(p: BoardPlayer, rosters: Map<string, string[]> | null, myFranchise: string | null): Ownership | null {
  if (!rosters) return null;
  const holders = p.id ? rosters.get(p.id) ?? [] : [];
  return { holders, mine: !!myFranchise && holders.includes(myFranchise) };
}

export interface ViewRow {
  player: BoardPlayer;
  ownership: Ownership | null;
}

export interface ViewResult {
  rows: ViewRow[];
  total: number;
  truncated: boolean;
}

/**
 * The rows a tab shows: in the tab, past the filters, sorted (rows with no
 * value for the sort go last, in either direction), then capped at PAGE_SIZE
 * unless `all` is set.
 */
export function buildView(
  board: BoardFile,
  q: ViewQuery,
  rosters: Map<string, string[]> | null,
  myFranchise: string | null,
): ViewResult {
  const rows: ViewRow[] = [];
  for (const player of board.players) {
    if (!inView(player, q.view)) continue;
    if (q.pos !== 'all' && player.pos !== q.pos) continue;
    const ownership = ownershipOf(player, rosters, myFranchise);
    if (q.own !== 'all' && ownership) {
      if (q.own === 'mine' && !ownership.mine) continue;
      if (q.own === 'available' && ownership.holders.length) continue;
      if (q.own === 'rostered' && (!ownership.holders.length || ownership.mine)) continue;
    }
    rows.push({ player, ownership });
  }
  const sign = q.dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const va = sortValue(a.player, q.view, q.sort);
    const vb = sortValue(b.player, q.view, q.sort);
    if (va === null && vb === null) return a.player.name.localeCompare(b.player.name);
    if (va === null) return 1;
    if (vb === null) return -1;
    return (va - vb) * sign || a.player.name.localeCompare(b.player.name);
  });
  const total = rows.length;
  const truncated = !q.all && total > PAGE_SIZE;
  return { rows: truncated ? rows.slice(0, PAGE_SIZE) : rows, total, truncated };
}

/**
 * A link to the same page with some query values changed. Defaults are
 * dropped so links stay short. Changing the tab resets the sort, which
 * belongs to the tab.
 */
export function viewHref(path: string, league: string, q: ViewQuery, change: Partial<ViewQuery> & { league?: string }): string {
  const next = { ...q, ...change };
  if (change.view && change.view !== q.view && !change.sort) {
    next.sort = SORTS[change.view][0].key;
    next.dir = SORTS[change.view][0].dir;
  }
  const params = new URLSearchParams();
  const lg = change.league ?? league;
  if (lg) params.set('league', lg);
  if (next.view !== 'dynasty') params.set('view', next.view);
  if (next.pos !== 'all') params.set('pos', next.pos);
  if (next.own !== 'all') params.set('own', next.own);
  const def = SORTS[next.view][0];
  if (next.sort !== def.key || next.dir !== def.dir) {
    params.set('sort', next.sort);
    params.set('dir', next.dir);
  }
  if (next.all) params.set('all', '1');
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** "Sat, Nov 21" in Pacific time, for a source's freshness line. */
export function freshnessLabel(iso: string | null, timeZone = 'America/Los_Angeles'): string {
  if (!iso) return 'unknown';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone });
}
