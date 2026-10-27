/**
 * The MFL Football app's Players tab: search, the free-agent list, trending
 * adds and one player's card, for ANY MFL league the account is in.
 *
 * Read only. Every league-scoped read carries the owner's own MFL cookie and
 * goes to the league's own host (`OwnerLeague.host`, already restricted to
 * `*.myfantasyleague.com` by `hostOf`). Nothing here uses our env credentials.
 *
 * Three rules this file keeps:
 *
 *  - **A projection or a total belongs to a player IN A LEAGUE.** They are
 *    read with `L=` and keyed per league, never pooled across leagues. Only
 *    `topOwns` / `topAdds` (MFL-wide percentages), the player list, the
 *    injury report and NFL byes are league-agnostic.
 *  - **Free agency is per UNIT.** A league whose `playerLimitUnit` is a
 *    conference or division answers one `freeAgents` list per unit, and a
 *    player rostered in one unit can be free in another. The account's own
 *    franchise decides which unit counts (the same unit keys the drop-lock
 *    reader uses). The `locked` flag is NOT read here: it means
 *    "no instant add", which only the add/drop flow can interpret
 *    (docs/claude/insights/domains/mfl-api.md § 2026-09-30).
 *  - **`res.ok` is not "the data is good."** MFL answers errors and throttles
 *    as a 200 with an error body or HTML; both become `null` and the list
 *    degrades (no projections, no owned %) rather than lying.
 *
 * Store rules: no headshots and no NFL club marks are produced here — the
 * club is its text code.
 */

import { mflFetch } from '../mfl-fetch';
import { buildMflExportUrl } from '../mfl-url';
import { getRedis } from '../redis-client';
import type {
  MflLiveAppPlayerCardResponse,
  MflLiveAppPlayerOwner,
  MflLiveAppPlayersResponse,
  MflLiveAppPlayersSort,
  MflLiveAppPlayersStatus,
  MflLiveAppPlayerSummary,
  MflLiveAppPlayerWeek,
} from '../../../packages/shared-types/src/mfl-live-app-k';

// ── Parsing (pure) ────────────────────────────────────────────────────────

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function num(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface PlayerIdentityRow {
  id: string;
  name: string;
  position: string;
  team: string;
}

/**
 * MFL names a player "Last, First" and a team defense "Bills, Buffalo".
 * Both read as "First Last" ("Buffalo Bills"); a name with no comma is kept.
 */
export function displayName(raw: string): string {
  const name = raw.trim();
  const comma = name.indexOf(',');
  if (comma < 0) return name;
  const last = name.slice(0, comma).trim();
  const first = name.slice(comma + 1).trim();
  return first ? `${first} ${last}` : last;
}

/** `TYPE=players` → id → identity. Null when the payload is not a player list. */
export function parsePlayers(payload: unknown): Map<string, PlayerIdentityRow> | null {
  const rows = (payload as any)?.players?.player;
  if (rows === undefined) return null;
  const map = new Map<string, PlayerIdentityRow>();
  for (const p of asArray<any>(rows)) {
    const id = `${p?.id ?? ''}`.trim();
    if (!id) continue;
    map.set(id, {
      id,
      name: displayName(`${p?.name ?? ''}`),
      position: `${p?.position ?? ''}`.trim(),
      team: `${p?.team ?? ''}`.trim() || 'FA',
    });
  }
  return map;
}

/** `playerScores` / `projectedScores` → id → points. Blank rows (an unscored week) are skipped. */
export function parseScores(payload: unknown, root: 'playerScores' | 'projectedScores'): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of asArray<any>((payload as any)?.[root]?.playerScore)) {
    const id = `${r?.id ?? ''}`.trim();
    const score = num(r?.score);
    if (id && score !== null) map.set(id, score);
  }
  return map;
}

/**
 * `topOwns` / `topAdds` → id → percent. The row carries `percent`; a payload
 * without one for a row leaves that player off rather than guessing.
 */
export function parseTopList(payload: unknown, root: 'topOwns' | 'topAdds'): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of asArray<any>((payload as any)?.[root]?.player)) {
    const id = `${r?.id ?? ''}`.trim();
    const pct = num(r?.percent);
    if (id && pct !== null) map.set(id, pct);
  }
  return map;
}

/** `TYPE=injuries` → id → MFL's injury detail. */
export function parseInjuries(
  payload: unknown,
): Map<string, { status: string; bodyPart: string | null; expectedReturn: string | null }> {
  const map = new Map<string, { status: string; bodyPart: string | null; expectedReturn: string | null }>();
  for (const r of asArray<any>((payload as any)?.injuries?.injury)) {
    const id = `${r?.id ?? ''}`.trim();
    const status = `${r?.status ?? ''}`.trim();
    if (!id || !status) continue;
    map.set(id, {
      status,
      bodyPart: `${r?.details ?? ''}`.trim() || null,
      expectedReturn: `${r?.exp_return ?? ''}`.trim() || null,
    });
  }
  return map;
}

/** Unit key for a `freeAgents` unit label, as the drop-lock reader keys it: `CONFERENCE00` → '00', `LEAGUE` → ''. */
export function unitKey(unit: unknown): string {
  const m = /^(?:CONFERENCE|DIVISION)(\w+)$/i.exec(String(unit ?? ''));
  return m ? m[1] : '';
}

export interface LeagueShape {
  /** franchiseId → franchise name. */
  franchises: Map<string, string>;
  /** franchiseId → unit key ('' for a single pool). */
  unitOf: Map<string, string>;
  /** The positions the league starts, as MFL labels them, in roster order. */
  positions: string[];
  endWeek: number | null;
}

/**
 * The starter labels a league uses, and which MFL player positions each one
 * admits. A slot can be a combination ("DE+DT", "RB+WR+TE"), and the IDP
 * group labels DL / DB name positions players never carry.
 */
const GROUPS: Record<string, string[]> = { DL: ['DE', 'DT'], DB: ['CB', 'S'] };

export function positionsFor(label: string): string[] {
  return label
    .split(/[+|/]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => GROUPS[p] ?? [p]);
}

/** `TYPE=league` → franchises, their free-agency unit, and the starting positions. */
export function parseLeague(payload: unknown): LeagueShape | null {
  const l = (payload as any)?.league;
  if (!l || typeof l !== 'object') return null;

  const franchises = new Map<string, string>();
  const divisionOf = new Map<string, string>();
  for (const f of asArray<any>(l.franchises?.franchise)) {
    const id = `${f?.id ?? ''}`.trim();
    if (!id) continue;
    franchises.set(id, `${f?.name ?? ''}`.trim() || `Team ${id}`);
    if (f?.division !== undefined) divisionOf.set(id, `${f.division}`);
  }

  const conferenceOfDivision = new Map<string, string>();
  for (const d of asArray<any>(l.divisions?.division)) {
    if (d?.id !== undefined && d?.conference !== undefined) conferenceOfDivision.set(`${d.id}`, `${d.conference}`);
  }

  const limitUnit = `${l.playerLimitUnit ?? 'LEAGUE'}`.toUpperCase();
  const unitOf = new Map<string, string>();
  for (const id of franchises.keys()) {
    const division = divisionOf.get(id);
    if (limitUnit === 'CONFERENCE') unitOf.set(id, conferenceOfDivision.get(division ?? '') ?? '');
    else if (limitUnit === 'DIVISION') unitOf.set(id, division ?? '');
    else unitOf.set(id, '');
  }

  const positions: string[] = [];
  for (const s of asArray<any>(l.starters?.position)) {
    const name = `${s?.name ?? ''}`.trim();
    if (name && !positions.includes(name)) positions.push(name);
  }

  return { franchises, unitOf, positions, endWeek: num(l.endWeek) };
}

/** `TYPE=rosters` → playerId → the franchises rostering him. */
export function parseRosters(payload: unknown): Map<string, string[]> | null {
  const rows = (payload as any)?.rosters?.franchise;
  if (rows === undefined) return null;
  const map = new Map<string, string[]>();
  for (const f of asArray<any>(rows)) {
    const fid = `${f?.id ?? ''}`.trim();
    if (!fid) continue;
    for (const p of asArray<any>(f?.player)) {
      const pid = `${p?.id ?? ''}`.trim();
      if (!pid) continue;
      const list = map.get(pid) ?? [];
      list.push(fid);
      map.set(pid, list);
    }
  }
  return map;
}

/** `TYPE=freeAgents` → unit key → the free agents in it. Null when the payload is not a free-agent list. */
export function parseFreeAgents(payload: unknown): Map<string, Set<string>> | null {
  const fa = (payload as any)?.freeAgents;
  if (!fa || fa.leagueUnit == null) return null;
  const map = new Map<string, Set<string>>();
  for (const u of asArray<any>(fa.leagueUnit)) {
    const ids = new Set<string>();
    for (const p of asArray<any>(u?.player)) {
      const id = `${p?.id ?? ''}`.trim();
      if (id) ids.add(id);
    }
    map.set(unitKey(u?.unit), ids);
  }
  return map;
}

// ── The assembled league view (pure) ──────────────────────────────────────

export interface LeaguePlayersData {
  leagueId: string;
  /** The account's own franchise in this league (from `requireOwnerLeague`). */
  franchiseId: string;
  week: number;
  identities: Map<string, PlayerIdentityRow>;
  league: LeagueShape;
  rosters: Map<string, string[]>;
  /** The account's unit's free agents; null when MFL's list could not be read. */
  freeAgents: Set<string> | null;
  projections: Map<string, number>;
  seasonPoints: Map<string, number>;
  ownedPct: Map<string, number>;
  addedPct: Map<string, number>;
  injuries: Map<string, { status: string; bodyPart: string | null; expectedReturn: string | null }>;
  byes: Record<string, number>;
}

function ownersInUnit(data: LeaguePlayersData, playerId: string): MflLiveAppPlayerOwner[] {
  const myUnit = data.league.unitOf.get(data.franchiseId) ?? '';
  return (data.rosters.get(playerId) ?? [])
    .filter((fid) => (data.league.unitOf.get(fid) ?? '') === myUnit)
    .map((fid) => ({ franchiseId: fid, name: data.league.franchises.get(fid) ?? `Team ${fid}` }));
}

export function summarize(data: LeaguePlayersData, id: string): MflLiveAppPlayerSummary | null {
  const who = data.identities.get(id);
  if (!who) return null;
  const owners = ownersInUnit(data, id);
  return {
    id,
    name: who.name,
    position: who.position,
    team: who.team,
    bye: data.byes[who.team] ?? null,
    injury: data.injuries.get(id)?.status ?? null,
    projected: data.projections.get(id) ?? null,
    points: data.seasonPoints.get(id) ?? null,
    ownedPct: data.ownedPct.get(id) ?? null,
    addedPct: data.addedPct.get(id) ?? null,
    owners,
    // MFL's own list decides; when it could not be read, "nobody in my unit
    // rosters him" is the honest fallback.
    isFreeAgent: data.freeAgents ? data.freeAgents.has(id) : owners.length === 0,
  };
}

export interface PlayerListQuery {
  status: MflLiveAppPlayersStatus;
  sort: MflLiveAppPlayersSort;
  q: string;
  /** One of the league's position labels, or '' for every position. */
  pos: string;
  limit: number;
}

export const PLAYER_LIST_DEFAULT_LIMIT = 100;
export const PLAYER_LIST_MAX_LIMIT = 300;

export function parsePlayerListQuery(params: URLSearchParams): PlayerListQuery {
  const status = params.get('status');
  const sort = params.get('sort');
  const limit = Number.parseInt(params.get('limit') ?? '', 10);
  return {
    status: status === 'all' || status === 'trending' ? status : 'fa',
    sort: sort === 'pts' || sort === 'owned' ? sort : 'proj',
    q: (params.get('q') ?? '').trim().slice(0, 60),
    pos: (params.get('pos') ?? '').trim(),
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, PLAYER_LIST_MAX_LIMIT) : PLAYER_LIST_DEFAULT_LIMIT,
  };
}

/** Lowercase, accents and punctuation stripped, so "ja'marr" finds "Ja'Marr" and "Jamarr". */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '');
}

const SORT_KEY: Record<MflLiveAppPlayersSort, (p: MflLiveAppPlayerSummary) => number | null> = {
  proj: (p) => p.projected,
  pts: (p) => p.points,
  owned: (p) => p.ownedPct,
};

/** Highest first; a missing number sorts after every real one, then season points, then name. */
function compare(sort: MflLiveAppPlayersSort) {
  const key = SORT_KEY[sort];
  return (a: MflLiveAppPlayerSummary, b: MflLiveAppPlayerSummary): number => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== kb) {
      if (ka === null) return 1;
      if (kb === null) return -1;
      return kb - ka;
    }
    const pa = a.points ?? -Infinity;
    const pb = b.points ?? -Infinity;
    if (pa !== pb) return pb - pa;
    return a.name.localeCompare(b.name);
  };
}

export function buildPlayerList(data: LeaguePlayersData, query: PlayerListQuery): MflLiveAppPlayersResponse {
  const leaguePositions = new Set(data.league.positions.flatMap(positionsFor));
  const wanted = query.pos && data.league.positions.includes(query.pos) ? new Set(positionsFor(query.pos)) : null;
  const needle = fold(query.q);

  // The pool: every player the league could start, plus anyone rostered here
  // whatever his position (a league can roster positions it never starts).
  const pool: string[] =
    query.status === 'trending'
      ? [...data.addedPct.keys()]
      : query.status === 'fa' && data.freeAgents
        ? [...data.freeAgents]
        : [...data.identities.keys()];

  const players: MflLiveAppPlayerSummary[] = [];
  for (const id of pool) {
    const who = data.identities.get(id);
    if (!who) continue;
    const rostered = data.rosters.has(id);
    if (!leaguePositions.has(who.position) && !rostered) continue;
    if (wanted && !wanted.has(who.position)) continue;
    if (needle && !fold(who.name).includes(needle)) continue;
    const row = summarize(data, id);
    if (!row) continue;
    if (query.status === 'fa' && !row.isFreeAgent) continue;
    players.push(row);
  }

  players.sort(
    query.status === 'trending'
      ? (a, b) => (b.addedPct ?? 0) - (a.addedPct ?? 0) || compare(query.sort)(a, b)
      : compare(query.sort),
  );

  return {
    ok: true,
    leagueId: data.leagueId,
    week: data.week,
    status: query.status,
    sort: query.sort,
    positions: data.league.positions,
    total: players.length,
    players: players.slice(0, query.limit),
  };
}

export function buildPlayerCard(
  data: LeaguePlayersData,
  playerId: string,
  weeklyScores: Map<number, Map<string, number>>,
): MflLiveAppPlayerCardResponse | null {
  const player = summarize(data, playerId);
  if (!player) return null;
  const weeks: MflLiveAppPlayerWeek[] = [...weeklyScores.entries()]
    .filter(([, scores]) => scores.has(playerId))
    .map(([week, scores]) => ({ week, points: scores.get(playerId) as number }))
    .sort((a, b) => b.week - a.week);
  return {
    ok: true,
    leagueId: data.leagueId,
    week: data.week,
    player,
    injuryDetail: data.injuries.get(playerId) ?? null,
    weeks,
  };
}

// ── Reading MFL (cached) ──────────────────────────────────────────────────

/** Reads MFL; `null` for a failed request, a non-JSON body or MFL's `{ error }` answer. */
async function readExport(url: string, mflUserCookie: string): Promise<unknown | null> {
  try {
    const response = await mflFetch({ url, method: 'GET', mflUserCookie });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    if (!body || typeof body !== 'object' || 'error' in (body as object)) return null;
    return body;
  } catch {
    return null;
  }
}

const memo = new Map<string, { at: number; ttlMs: number; value: unknown }>();

/**
 * One instance's memory first, then Redis (only for `shared: true`, the small
 * per-league exports), then MFL. Only a good answer is cached, so a throttled
 * read is retried on the next request instead of pinned.
 */
async function cached(
  key: string,
  ttlSeconds: number,
  load: () => Promise<unknown | null>,
  opts: { redis: boolean },
): Promise<unknown | null> {
  const now = Date.now();
  const hit = memo.get(key);
  if (hit && now - hit.at < hit.ttlMs) return hit.value;

  const redis = opts.redis ? await getRedis().catch(() => null) : null;
  if (redis) {
    try {
      const stored = await redis.get<unknown>(key);
      if (stored) {
        memo.set(key, { at: now, ttlMs: ttlSeconds * 1000, value: stored });
        return stored;
      }
    } catch (error) {
      console.warn('[mfl-players] cache read failed:', error);
    }
  }

  const value = await load();
  if (value === null) return null;
  memo.set(key, { at: now, ttlMs: ttlSeconds * 1000, value });
  if (redis) {
    try {
      await redis.set(key, value, { ex: ttlSeconds });
    } catch (error) {
      console.warn('[mfl-players] cache write failed:', error);
    }
  }
  return value;
}

/** Test hook. */
export function resetPlayersMemo(): void {
  memo.clear();
}

export interface LeagueRef {
  leagueId: string;
  franchiseId: string;
  year: number;
  host: string | null;
}

function urlFor(ref: LeagueRef, type: string, params: Record<string, string | number> = {}): string {
  return buildMflExportUrl({ type, leagueId: ref.leagueId, year: ref.year, params, host: ref.host ?? undefined });
}

/** Scores for one week, as a plain object so it survives Redis. */
async function weekScores(ref: LeagueRef, cookie: string, week: number, currentWeek: number): Promise<Map<number, Map<string, number>>> {
  // A finished week does not change; the week being played does.
  const ttl = week < currentWeek ? 7 * 24 * 60 * 60 : 5 * 60;
  const value = await cached(
    `mfllive:players:${ref.leagueId}:${ref.year}:w${week}`,
    ttl,
    async () => {
      const payload = await readExport(urlFor(ref, 'playerScores', { W: week }), cookie);
      if (!payload) return null;
      return Object.fromEntries(parseScores(payload, 'playerScores'));
    },
    { redis: true },
  );
  const scores = new Map<string, number>(Object.entries((value as Record<string, number> | null) ?? {}));
  return new Map([[week, scores]]);
}

/** Every scored week of the season so far, under this league's rules. */
export async function loadWeeklyScores(
  ref: LeagueRef,
  cookie: string,
  currentWeek: number,
  endWeek: number | null,
): Promise<Map<number, Map<string, number>>> {
  const last = Math.min(currentWeek, endWeek ?? currentWeek);
  const weeks = Array.from({ length: Math.max(0, last) }, (_, i) => i + 1);
  const parts = await Promise.all(weeks.map((w) => weekScores(ref, cookie, w, currentWeek)));
  const out = new Map<number, Map<string, number>>();
  for (const part of parts) for (const [w, s] of part) if (s.size > 0) out.set(w, s);
  return out;
}

/**
 * Everything the list and the card need for one league. Null only when the
 * league itself (franchises, positions) or the player list could not be read;
 * every other export degrades to empty.
 */
export async function loadLeaguePlayersData(input: {
  ref: LeagueRef;
  cookie: string;
  week: number;
  byes: Record<string, number>;
}): Promise<LeaguePlayersData | null> {
  const { ref, cookie, week, byes } = input;
  const base = `mfllive:players:${ref.leagueId}:${ref.year}`;
  // League-agnostic, so one copy per instance serves every league. The player
  // list is large (~2,700 rows), which is why it stays out of Redis.
  const globalUrl = (type: string, params: Record<string, string | number> = {}) =>
    urlFor({ ...ref, host: null }, type, params);

  const [leaguePayload, playersPayload, rostersPayload, faPayload, projPayload, ytdPayload, ownsPayload, addsPayload, injPayload] =
    await Promise.all([
      cached(`${base}:league`, 6 * 60 * 60, () => readExport(urlFor(ref, 'league'), cookie), { redis: true }),
      cached(`mfllive:players:list:${ref.year}`, 12 * 60 * 60, () => readExport(globalUrl('players'), cookie), { redis: false }),
      cached(`${base}:rosters`, 60, () => readExport(urlFor(ref, 'rosters'), cookie), { redis: true }),
      cached(`${base}:fa`, 60, () => readExport(urlFor(ref, 'freeAgents'), cookie), { redis: true }),
      week > 0
        ? cached(`${base}:proj:w${week}`, 30 * 60, () => readExport(urlFor(ref, 'projectedScores', { W: week }), cookie), { redis: true })
        : Promise.resolve(null),
      cached(`${base}:ytd`, 10 * 60, () => readExport(urlFor(ref, 'playerScores', { W: 'YTD' }), cookie), { redis: true }),
      cached(`mfllive:players:owns:${ref.year}`, 60 * 60, () => readExport(globalUrl('topOwns'), cookie), { redis: false }),
      cached(`mfllive:players:adds:${ref.year}`, 60 * 60, () => readExport(globalUrl('topAdds'), cookie), { redis: false }),
      cached(`mfllive:players:injuries:${ref.year}`, 15 * 60, () => readExport(globalUrl('injuries'), cookie), { redis: false }),
    ]);

  const league = parseLeague(leaguePayload);
  const identities = parsePlayers(playersPayload);
  if (!league || !identities) return null;

  const freeAgentsByUnit = parseFreeAgents(faPayload);
  const myUnit = league.unitOf.get(ref.franchiseId) ?? '';

  return {
    leagueId: ref.leagueId,
    franchiseId: ref.franchiseId,
    week,
    identities,
    league,
    rosters: parseRosters(rostersPayload) ?? new Map(),
    freeAgents: freeAgentsByUnit?.get(myUnit) ?? null,
    projections: parseScores(projPayload, 'projectedScores'),
    seasonPoints: parseScores(ytdPayload, 'playerScores'),
    ownedPct: parseTopList(ownsPayload, 'topOwns'),
    addedPct: parseTopList(addsPayload, 'topAdds'),
    injuries: parseInjuries(injPayload),
    byes,
  };
}
