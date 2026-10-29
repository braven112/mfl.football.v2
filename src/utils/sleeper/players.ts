/**
 * Sleeper player id → MFL player id.
 *
 * Sleeper numbers players its own way, and everything MFL Live draws on top of
 * a score — headshots, the scoring ticker, the red-zone banner — is keyed by
 * MFL player id (the ticker and banner translate ESPN plays to MFL ids before
 * anything leaves the server). So every Sleeper starter is resolved to an MFL
 * id once, here, and the board never sees a Sleeper id for a player it could
 * resolve.
 *
 * THE JOIN, in order — first hit wins:
 *
 *  1. ESPN athlete id. Both sides carry it and it is exact. Sleeper's
 *     `espn_id` is an NFL athlete id; the MFL side is `nflEspnId` (MFL's own
 *     id, else the NFL-only backfill) and NEVER `espnId`, which can hold a
 *     COLLEGE athlete id that is numerically indistinguishable from an NFL
 *     one (docs/claude/rules/live-scoring.md). Measured Oct 2026: Sleeper
 *     leaves `espn_id` empty for many current starters (Ja'Marr Chase among
 *     them), which is why it cannot be the only rung.
 *  2. RotoWire id. Both sides carry it too, and it covered most of what the
 *     ESPN rung missed (579 of 866 active, rostered Sleeper players).
 *  3. Name + position, only when that pair is UNIQUE in the MFL feed. A name
 *     that two MFL players share resolves to nobody rather than to the wrong
 *     one — a college athlete id and an NFL one are both plain digits, and the
 *     same lesson applies to two "Mike Williams": a bad join resolves a
 *     different person instead of failing (docs/claude/rules/live-scoring.md).
 *
 * Team defences are keyed by NFL code on Sleeper ('KC') and map by club.
 *
 * A player none of the rungs resolves is NOT dropped: the board shows him
 * under a `sleeper:<id>` row id with Sleeper's own name, position and team.
 * He scores normally; he just cannot trigger a ticker or red-zone moment.
 *
 * The source list (`/v1/players/nfl`) is ~15 MB and Sleeper asks that it be
 * fetched at most once a day, so the COMPACT map built from it — a few
 * thousand entries — is what gets cached, in Redis for a day and in process
 * for an hour.
 */

import { getRedis } from '../redis-client';
import { getLeagueBySlug } from '../../config/leagues';
import { leagueFeedPath, preloadLeagueData, readLeagueDataSync } from '../league-data';
import { canonicalNflCode } from '../espn-game-detail';
import { getPlayerMap, preloadPlayerIdentity } from '../player-map';
import { formatMflName, normalizePlayerName } from '../player-name-matching';
import { sleeperGet, type SleeperPlayerRecord } from './client';

/** One Sleeper player, as the board needs him. */
export interface SleeperPlayerEntry {
  /** MFL player id, or '' when no rung of the join resolved him. */
  mfl: string;
  name: string;
  /**
   * MFL's position vocabulary (QB RB WR TE PK Def, and DE DT LB CB S for a
   * defensive player), or Sleeper's own DL / DB where MFL splits the group.
   */
  position: string;
  /** ESPN-format NFL code (KC, WSH, …), or ''. */
  team: string;
}

export type SleeperPlayerMap = Record<string, SleeperPlayerEntry>;

/** The MFL side of the join — the slice of an MFL `players` row it reads. */
export interface MflPlayerRow {
  id: string;
  name?: string;
  position?: string;
  team?: string;
  espn_id?: string;
  rotowire_id?: string;
}

/** Sleeper's position words → MFL's. */
const POSITION: Record<string, string> = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  K: 'PK',
  DEF: 'Def',
  // Individual defensive players: a Sleeper IDP league starts them, and a
  // player missing from the map renders as "Unknown player" with no way to
  // fix him. Sleeper's DL and DB span two MFL positions each, so they keep
  // Sleeper's word and join against both (`mflPositionsFor`).
  DE: 'DE',
  DT: 'DT',
  NT: 'DT',
  DL: 'DL',
  LB: 'LB',
  ILB: 'LB',
  OLB: 'LB',
  CB: 'CB',
  S: 'S',
  SS: 'S',
  FS: 'S',
  DB: 'DB',
};

const POSITION_GROUP: Record<string, readonly string[]> = { DL: ['DE', 'DT'], DB: ['CB', 'S'] };
const DEFENSIVE = new Set(['DE', 'DT', 'DL', 'LB', 'CB', 'S', 'DB']);

/** The MFL positions a map entry's position covers. */
export function mflPositionsFor(position: string): readonly string[] {
  return POSITION_GROUP[position] ?? [position];
}

export { UNRESOLVED_PREFIX } from './ids';

const idOf = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return /^\d+$/.test(s) && s !== '0' ? s : '';
};

/**
 * Build the compact map. Pure — the loader below supplies both lists.
 *
 * Only fantasy positions are kept: a Sleeper lineup cannot start a long
 * snapper, and the full list is mostly people no board will ever draw.
 */
export function buildSleeperPlayerMap(
  sleeper: Record<string, SleeperPlayerRecord>,
  mfl: readonly MflPlayerRow[],
): SleeperPlayerMap {
  const byEspn = new Map<string, string>();
  const byRotowire = new Map<string, string>();
  const defByTeam = new Map<string, string>();
  /** name|position → MFL id, or null when two MFL players share the pair. */
  const byName = new Map<string, string | null>();

  for (const p of mfl) {
    if (!p?.id) continue;
    const espn = idOf(p.espn_id);
    if (espn && !byEspn.has(espn)) byEspn.set(espn, p.id);
    const rw = idOf(p.rotowire_id);
    if (rw && !byRotowire.has(rw)) byRotowire.set(rw, p.id);
    if (p.position === 'Def' && p.team) defByTeam.set(canonicalNflCode(p.team), p.id);
    const name = normalizePlayerName(formatMflName(p.name ?? ''));
    if (name && p.position) {
      const key = `${name}|${p.position}`;
      byName.set(key, byName.has(key) ? null : p.id);
    }
  }

  const out: SleeperPlayerMap = {};
  for (const [sid, p] of Object.entries(sleeper)) {
    const position = POSITION[String(p?.position ?? '').toUpperCase()];
    if (!position) continue;
    const team = p?.team ? canonicalNflCode(String(p.team)) : '';
    // Sleeper lists thousands of defenders who never played a snap; one with
    // no club is not in anyone's lineup, and the map is stored whole.
    if (DEFENSIVE.has(position) && !team) continue;

    if (position === 'Def') {
      // Sleeper keys a defence by its club code, so the id IS the team.
      const club = team || canonicalNflCode(sid);
      out[sid] = {
        mfl: defByTeam.get(club) ?? '',
        name: [p.first_name, p.last_name].filter(Boolean).join(' ') || club,
        position,
        team: club,
      };
      continue;
    }

    const name = String(p?.full_name ?? [p?.first_name, p?.last_name].filter(Boolean).join(' ')).trim();
    const mflId =
      byEspn.get(idOf(p?.espn_id)) ??
      byRotowire.get(idOf(p?.rotowire_id)) ??
      byNameAt(byName, normalizePlayerName(name), position) ??
      '';
    out[sid] = { mfl: mflId || '', name: name || `Player ${sid}`, position, team };
  }
  return out;
}

/** The name rung: one MFL player with this name across the position's group, else null. */
function byNameAt(byName: ReadonlyMap<string, string | null>, name: string, position: string): string | null {
  let found: string | null = null;
  for (const pos of mflPositionsFor(position)) {
    const key = `${name}|${pos}`;
    if (!byName.has(key)) continue;
    const id = byName.get(key);
    if (!id || (found && found !== id)) return null;
    found = id;
  }
  return found;
}

// ── Loading ─────────────────────────────────────────────────────────────────

// v2: defensive players joined the map; a v1 copy would hide them for a day.
const REDIS_KEY = 'live:sleeper:players:v2';
const REDIS_TTL_S = 24 * 60 * 60;
const MEMORY_TTL_MS = 60 * 60 * 1000;
/** A failed build is retried, but not on every poll — that is how a board gets itself blocked. */
const FAILURE_TTL_MS = 5 * 60 * 1000;

let memory: { at: number; map: SleeperPlayerMap } | null = null;
let failedAt = 0;
let inflight: Promise<SleeperPlayerMap> | null = null;

/** Exported for tests only. */
export function clearSleeperPlayerCache(): void {
  memory = null;
  failedAt = 0;
  inflight = null;
}

/**
 * The MFL side: the feed's own rows (for the RotoWire id, which
 * `PlayerIdentity` does not carry) with `espn_id` replaced by `nflEspnId`, so
 * the backfilled NFL ids join too and a college id never can.
 */
const mflPlayersPath = (year: number) =>
  leagueFeedPath(getLeagueBySlug('theleague')!.dataPath, year, 'players.json');

/**
 * Load what {@link loadMflPlayerIndex} reads for `year` (league data lives in
 * the store in production — src/utils/league-data.ts).
 */
export async function preloadMflPlayerIndex(year: number): Promise<void> {
  await Promise.all([preloadLeagueData([mflPlayersPath(year)]), preloadPlayerIdentity([year])]);
}

function readMflPlayers(year: number): MflPlayerRow[] {
  const raw = readLeagueDataSync<any>(mflPlayersPath(year));
  const rows: MflPlayerRow[] = raw?.players?.player ?? [];
  if (!rows.length) return [];
  const identity = getPlayerMap(year);
  return rows.map((r) => ({ ...r, espn_id: identity.get(r.id)?.nflEspnId ?? r.espn_id ?? '' }));
}

/** One MFL player, as the fix list shows and searches him. */
export interface MflPlayerChoice {
  id: string;
  /** "First Last". */
  name: string;
  position: string;
  team: string;
}

const FANTASY_POSITIONS = new Set(Object.values(POSITION).flatMap(mflPositionsFor));
let indexMemory: { year: number; at: number; index: Map<string, MflPlayerChoice> } | null = null;

/**
 * Every fantasy-position MFL player, by id — what a crowd fix may point at.
 * Read from the committed feed, so it costs no network; held for an hour.
 */
export function loadMflPlayerIndex(year: number): Map<string, MflPlayerChoice> {
  if (indexMemory && indexMemory.year === year && Date.now() - indexMemory.at < MEMORY_TTL_MS) {
    return indexMemory.index;
  }
  const index = new Map<string, MflPlayerChoice>();
  for (const r of readMflPlayers(year)) {
    if (!r?.id || !r.position || !FANTASY_POSITIONS.has(r.position)) continue;
    index.set(r.id, {
      id: r.id,
      name: formatMflName(r.name ?? '') || `Player ${r.id}`,
      position: r.position,
      team: r.team ? canonicalNflCode(r.team) : '',
    });
  }
  indexMemory = { year, at: Date.now(), index };
  return index;
}

/**
 * MFL players whose name contains `query`, best first. Pure.
 *
 * Ranked: same position as the player being fixed, then a name that STARTS
 * with the query (or whose last name does), then alphabetical. A one-letter
 * query matches nobody, so an accidental submit is not 2,000 radio buttons.
 */
export function searchMflPlayers(
  index: Iterable<MflPlayerChoice>,
  query: string,
  position = '',
  limit = 8,
): MflPlayerChoice[] {
  const q = normalizePlayerName(query);
  if (q.length < 2) return [];
  const scored: Array<{ p: MflPlayerChoice; score: number }> = [];
  for (const p of index) {
    const name = normalizePlayerName(p.name);
    if (!name.includes(q)) continue;
    const last = name.split(' ').slice(1).join(' ');
    let score = 0;
    if (position && mflPositionsFor(position).includes(p.position)) score += 4;
    if (name.startsWith(q) || last.startsWith(q)) score += 2;
    if (name === q) score += 1;
    scored.push({ p, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map((s) => s.p);
}

/**
 * Likely matches for an unmatched Sleeper player, with no typing: MFL players
 * at his position sharing his last name. Sleeper and MFL usually disagree on a
 * FIRST name (a nickname, an initial, a suffix), which is exactly what the
 * name rung of the join refuses to guess at.
 */
export function suggestMflPlayers(
  index: Iterable<MflPlayerChoice>,
  player: Pick<SleeperPlayerEntry, 'name' | 'position'>,
  limit = 5,
): MflPlayerChoice[] {
  const parts = normalizePlayerName(player.name).split(' ');
  const last = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
  if (!last || last.length < 2) return [];
  const out: MflPlayerChoice[] = [];
  for (const p of index) {
    if (!mflPositionsFor(player.position).includes(p.position)) continue;
    const name = normalizePlayerName(p.name).split(' ');
    if (name.slice(1).join(' ') === last || name[name.length - 1] === parts[parts.length - 1]) out.push(p);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
}

/**
 * The map, from the cheapest place that has it. Never throws; an empty map
 * means every Sleeper starter renders under his Sleeper name, which is less,
 * not wrong.
 */
export async function loadSleeperPlayerMap(year: number): Promise<SleeperPlayerMap> {
  const now = Date.now();
  if (memory && now - memory.at < MEMORY_TTL_MS) return memory.map;
  if (inflight) return inflight;
  if (!memory && failedAt && now - failedAt < FAILURE_TTL_MS) return {};

  inflight = (async () => {
    const redis = await getRedis().catch(() => null);
    const cached = await redis?.get<SleeperPlayerMap>(`${REDIS_KEY}:${year}`).catch(() => null);
    if (cached && typeof cached === 'object' && Object.keys(cached).length) {
      memory = { at: Date.now(), map: cached };
      return cached;
    }

    const body = await sleeperGet('/players/nfl');
    if (!body || typeof body !== 'object') {
      failedAt = Date.now();
      return memory?.map ?? {};
    }
    await preloadMflPlayerIndex(year).catch(() => undefined);
    const map = buildSleeperPlayerMap(body as Record<string, SleeperPlayerRecord>, readMflPlayers(year));
    memory = { at: Date.now(), map };
    await redis?.set(`${REDIS_KEY}:${year}`, map, { ex: REDIS_TTL_S }).catch(() => undefined);
    return map;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
