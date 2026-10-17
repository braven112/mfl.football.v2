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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getRedis } from '../redis-client';
import { canonicalNflCode } from '../espn-game-detail';
import { getPlayerMap } from '../player-map';
import { formatMflName, normalizePlayerName } from '../player-name-matching';
import { sleeperGet, type SleeperPlayerRecord } from './client';

/** One Sleeper player, as the board needs him. */
export interface SleeperPlayerEntry {
  /** MFL player id, or '' when no rung of the join resolved him. */
  mfl: string;
  name: string;
  /** MFL's position vocabulary: QB RB WR TE PK Def. */
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
};

/** Prefix for a row id Sleeper could not resolve. Never collides with an MFL id, which is all digits. */
export const UNRESOLVED_PREFIX = 'sleeper:';

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
      byName.get(`${normalizePlayerName(name)}|${position}`) ??
      '';
    out[sid] = { mfl: mflId || '', name: name || `Player ${sid}`, position, team };
  }
  return out;
}

// ── Loading ─────────────────────────────────────────────────────────────────

const REDIS_KEY = 'live:sleeper:players:v1';
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
function readMflPlayers(year: number): MflPlayerRow[] {
  let rows: MflPlayerRow[] = [];
  try {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), `data/theleague/mfl-feeds/${year}/players.json`), 'utf-8'),
    );
    rows = raw?.players?.player ?? [];
  } catch {
    return [];
  }
  const identity = getPlayerMap(year);
  return rows.map((r) => ({ ...r, espn_id: identity.get(r.id)?.nflEspnId ?? r.espn_id ?? '' }));
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
    const map = buildSleeperPlayerMap(body as Record<string, SleeperPlayerRecord>, readMflPlayers(year));
    memory = { at: Date.now(), map };
    await redis?.set(`${REDIS_KEY}:${year}`, map, { ex: REDIS_TTL_S }).catch(() => undefined);
    return map;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
