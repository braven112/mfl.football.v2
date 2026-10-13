/**
 * The Primetime Free Agents board — "best at every position" and the league's
 * market (most added, most dropped). Pure functions over data the page
 * already holds, so the page and its test share one implementation.
 *
 * Availability is per POOL in a duplicate-player league (the AFL's
 * conferences, Archie's divisions): a player is a free agent in a pool when
 * that pool's id is not in his `confs`. A single-pool league has no pool ids
 * and reads the plain `rostered` flag instead.
 */
import { normalizeTeamCode } from './nfl-logo';

export interface MarketPlayer {
  id: string;
  name: string;
  position: string;
  team?: string;
  projected?: number | null;
  rostered?: boolean;
  confs?: string[];
  lockedConfs?: string[];
}

export interface MarketMove {
  adds: number;
  drops: number;
}

/** Transaction types that move a player on or off a roster from the wire. */
const WIRE_TYPES = new Set(['FREE_AGENT', 'WAIVER', 'BBID_WAIVER']);

function asArray<T>(v: T | T[] | null | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function ids(field: string | undefined): string[] {
  return String(field ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Adds and drops per player from MFL's transactions export, over the
 * `windowDays` before `nowSec`. MFL writes a wire move as
 * `added,|dropped,` (free agent) or `added,|bid|dropped,` (blind bid), so the
 * first segment is the adds and the last is the drops.
 */
export function tallyMarketMoves(
  transactionsFeed: unknown,
  nowSec: number,
  windowDays = 7,
): Map<string, MarketMove> {
  const moves = new Map<string, MarketMove>();
  const since = nowSec - windowDays * 86_400;
  const rows = asArray((transactionsFeed as any)?.transactions?.transaction);
  for (const t of rows) {
    if (!t || !WIRE_TYPES.has(String(t.type))) continue;
    const ts = Number(t.timestamp);
    if (!Number.isFinite(ts) || ts < since || ts > nowSec) continue;
    const parts = String(t.transaction ?? '').split('|');
    const bump = (id: string, key: keyof MarketMove) => {
      const m = moves.get(id) ?? { adds: 0, drops: 0 };
      m[key] += 1;
      moves.set(id, m);
    };
    for (const id of ids(parts[0])) bump(id, 'adds');
    if (parts.length > 1) for (const id of ids(parts[parts.length - 1])) bump(id, 'drops');
  }
  return moves;
}

/** Free in this pool: not held there and not on MFL's recently-dropped lock list. */
export function isAvailableIn(p: MarketPlayer, poolId: string | null): boolean {
  if (!poolId) return !p.rostered;
  if (p.lockedConfs?.includes(poolId)) return false;
  return !(p.confs ?? []).includes(poolId);
}

/** NFL injury designations that keep a player off the "best available" cards. */
const SIDELINED = /^(out|ir|injured reserve|suspended|pup|nfi|holdout|retired)/i;

export function isSidelined(injuryStatus: string | null | undefined): boolean {
  return !!injuryStatus && SIDELINED.test(injuryStatus.trim());
}

/**
 * The best available players at each position in one pool, by projection:
 * `perPosition` per position, skipping anyone sidelined. A position with no
 * projected free agent is left out rather than shown empty.
 */
export function positionLeaders<T extends MarketPlayer>(
  players: readonly T[],
  poolId: string | null,
  positions: readonly string[],
  opts: { perPosition?: number; injuryStatus?: (id: string) => string | null | undefined } = {},
): Array<{ position: string; players: T[] }> {
  const per = opts.perPosition ?? 3;
  const out: Array<{ position: string; players: T[] }> = [];
  for (const position of positions) {
    const best = players
      .filter((p) => p.position === position && (p.projected ?? 0) > 0)
      .filter((p) => isAvailableIn(p, poolId) && !isSidelined(opts.injuryStatus?.(p.id)))
      .sort((a, b) => (b.projected ?? 0) - (a.projected ?? 0) || a.name.localeCompare(b.name))
      .slice(0, per);
    if (best.length) out.push({ position, players: best });
  }
  return out;
}

/** The players with the most adds (or drops) in the window, most first. */
export function topMoves<T extends MarketPlayer>(
  players: readonly T[],
  moves: Map<string, MarketMove>,
  key: keyof MarketMove,
  limit: number,
): Array<{ player: T; count: number }> {
  const byId = new Map(players.map((p) => [p.id, p]));
  return [...moves.entries()]
    .filter(([id, m]) => m[key] > 0 && byId.has(id))
    .sort((a, b) => b[1][key] - a[1][key] || byId.get(a[0])!.name.localeCompare(byId.get(b[0])!.name))
    .slice(0, limit)
    .map(([id, m]) => ({ player: byId.get(id)!, count: m[key] }));
}

export interface NextGame {
  /** Opponent, ESPN-style code (GB, not GBP). */
  opponent: string;
  home: boolean;
  /** Kickoff, epoch seconds. */
  kickoff: number;
}

/**
 * Each NFL team's next game that has not kicked off, from MFL's full NFL
 * schedule export. Keyed by ESPN-style code so it joins the snapshot's teams
 * (the export says GBP / KCC; the snapshot says GB / KC).
 */
export function nextGamesByTeam(fullSchedule: unknown, nowSec: number): Map<string, NextGame> {
  const next = new Map<string, NextGame>();
  const weeks = asArray((fullSchedule as any)?.fullNflSchedule?.nflSchedule);
  for (const wk of weeks) {
    for (const m of asArray<any>(wk?.matchup)) {
      const kickoff = Number(m?.kickoff);
      if (!Number.isFinite(kickoff) || kickoff <= nowSec) continue;
      const [a, b] = asArray<any>(m?.team);
      if (!a?.id || !b?.id) continue;
      for (const [self, other] of [[a, b], [b, a]] as const) {
        const code = normalizeTeamCode(self.id);
        const prev = next.get(code);
        if (!prev || kickoff < prev.kickoff) {
          next.set(code, { opponent: normalizeTeamCode(other.id), home: self.isHome === '1', kickoff });
        }
      }
    }
  }
  return next;
}
