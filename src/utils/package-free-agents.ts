/**
 * Free agents for a package league, scoped to ONE player pool.
 *
 * Archie's (`playerLimitUnit: DIVISION`) is nine pools: the same player is
 * routinely on up to nine rosters, one per division, and "free" only means
 * "not held in THIS division". So availability is always asked per pool
 * (buildPoolStructure → franchise → pool), and a row also says how many of the
 * other pools hold the player — context an owner reads as "how contested".
 *
 * Pure: the page hands in the feeds; nothing here fetches.
 */
import { buildPoolStructure } from './afl-conference-rosters.mjs';

export interface PoolStructure {
  ids: string[];
  names: Record<string, { name: string; abbrev: string }>;
  franchiseConferences: Record<string, string>;
}

export interface FreeAgentRow {
  id: string;
  name: string;
  position: string;
  team: string;
  /** Season-to-date fantasy points. */
  ytd: number | null;
  /** This week's projection. */
  projected: number | null;
  /** Redraft ADP rank. */
  adpRank: number | null;
  injury: string | null;
  /** How many pools (divisions) roster this player right now. */
  heldIn: number;
  /** MFL has him locked in this pool (recently dropped). */
  locked: boolean;
}

type Json = Record<string, any>;
const arr = <T>(v: T | T[] | null | undefined): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The pools, or null when the league is one shared pool / the export is unusable. */
export function poolStructure(leagueJson: unknown): PoolStructure | null {
  return buildPoolStructure(leagueJson) as PoolStructure | null;
}

/** The positions the league actually starts (league.starters), in that order. */
export function startingPositions(leagueJson: unknown): string[] {
  const positions = arr((leagueJson as Json)?.league?.starters?.position).map((p: Json) => String(p?.name ?? ''));
  return positions.filter(Boolean);
}

/**
 * Which pool the page shows: the one asked for (if real), else the viewer's
 * own, else the first. A free-agent list cannot render "no pool", so a default
 * is legitimate here (docs/claude/rules/preferred-team.md) — but the viewer's
 * own pool always wins over the first.
 */
export function resolvePool(structure: PoolStructure, requested: string | null, viewerFranchiseId: string | null): string {
  if (requested && structure.ids.includes(requested)) return requested;
  const mine = viewerFranchiseId ? structure.franchiseConferences[viewerFranchiseId] : undefined;
  if (mine && structure.ids.includes(mine)) return mine;
  return structure.ids[0];
}

/**
 * Player ids held in each pool. `rosters` is franchise-shaped (the Redis
 * franchise cache or the committed feed's `rosters.franchise`), so no copy of
 * a player is lost the way a player-keyed map would lose it.
 */
export function heldByPool(
  rosters: Array<{ id: string; player?: Array<{ id: string }> | { id: string } }>,
  structure: PoolStructure,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>(structure.ids.map((id) => [id, new Set<string>()]));
  for (const f of rosters) {
    const pool = structure.franchiseConferences[String(f.id)];
    if (!pool) continue;
    const set = out.get(pool) ?? new Set<string>();
    for (const p of arr(f.player)) if (p?.id) set.add(String(p.id));
    out.set(pool, set);
  }
  return out;
}

/**
 * The free agents of one pool, best first (season points, then projection).
 *
 * @param players   MFL `players.json` rows (id, name "Last, First", position, team).
 * @param positions The league's starting positions; other positions are not listed.
 */
export function buildFreeAgents(input: {
  players: Array<{ id: string; name?: string; position?: string; team?: string }>;
  positions: string[];
  pool: string;
  held: Map<string, Set<string>>;
  ytd?: unknown;
  projections?: unknown;
  adp?: unknown;
  injuries?: Record<string, { injuryStatus?: string }> | null;
  lockedIds?: Set<string> | null;
}): FreeAgentRow[] {
  const { players, positions, pool, held } = input;
  const scoreMap = (feed: unknown, path: string[]) => {
    let node: any = feed;
    for (const k of path) node = node?.[k];
    const m = new Map<string, number>();
    for (const r of arr(node)) {
      const v = num((r as Json)?.score);
      if ((r as Json)?.id && v != null) m.set(String((r as Json).id), v);
    }
    return m;
  };
  const ytd = scoreMap(input.ytd, ['playerScores', 'playerScore']);
  const proj = scoreMap(input.projections, ['projectedScores', 'playerScore']);
  const adp = new Map<string, number>();
  for (const r of arr((input.adp as Json)?.adp?.player)) {
    const rank = num((r as Json)?.rank);
    if ((r as Json)?.id && rank != null) adp.set(String((r as Json).id), rank);
  }
  const mine = held.get(pool) ?? new Set<string>();
  const wanted = new Set(positions);
  const rows: FreeAgentRow[] = [];
  for (const p of players) {
    const id = String(p.id);
    const position = String(p.position ?? '');
    if (!wanted.has(position) || mine.has(id)) continue;
    let heldIn = 0;
    for (const set of held.values()) if (set.has(id)) heldIn++;
    rows.push({
      id,
      name: displayName(String(p.name ?? id)),
      position,
      team: String(p.team ?? ''),
      ytd: ytd.get(id) ?? null,
      projected: proj.get(id) ?? null,
      adpRank: adp.get(id) ?? null,
      injury: input.injuries?.[id]?.injuryStatus ?? null,
      heldIn,
      locked: !!input.lockedIds?.has(id),
    });
  }
  return rows.sort(
    (a, b) =>
      (b.ytd ?? -1) - (a.ytd ?? -1) ||
      (b.projected ?? -1) - (a.projected ?? -1) ||
      (a.adpRank ?? 9999) - (b.adpRank ?? 9999) ||
      a.name.localeCompare(b.name),
  );
}

/** MFL writes "Last, First"; a team defense is "Bills, Buffalo" → "Buffalo Bills". */
export function displayName(mflName: string): string {
  const [last, first] = mflName.split(',').map((s) => s.trim());
  return first ? `${first} ${last}` : mflName;
}
