/**
 * The MFL Football app's draft room, for ANY MFL league the account is in:
 * the board, who is on the clock, your next pick, your MFL pre-draft list,
 * and the players still available.
 *
 * Split like the other app endpoints: `readMflLiveDraft` / `readMflLiveDraftPool`
 * do the network work with the owner's own MFL cookie; `buildMflLiveDraft` /
 * `buildMflLiveDraftPool` are pure functions of those payloads, which is what
 * `tests/mfl-live-draft.test.ts` pins.
 *
 * ── WHAT THE SITE'S DRAFT ROOM ALREADY LEARNED ────────────────────────────
 * (docs/plans/draft-hub-and-results.md, docs/claude/insights/domains/mfl-api.md)
 * - Rounds are not one size, so `overall` is a running count of the real
 *   picks, never `(round - 1) * teams + pick`.
 * - `draftUnit` is an object for most leagues and an ARRAY for one that drafts
 *   by conference. The room shows the unit YOUR team picks in: an AFL owner
 *   shown the other conference's board would be watching someone else's draft.
 * - `----` is a pick the commissioner skipped.
 * - MFL's JSON export lags a live room by several picks; its static XML file
 *   does not. The board is read from both and the fresher wins, by the same
 *   rules `/api/draft/status` uses (`draft-board-freshness.ts`).
 *
 * SERVER-SIDE ONLY. Store-safe: no headshots, no ESPN ids, no NFL marks.
 */

import type {
  MflLiveAppDraftKind,
  MflLiveAppDraftPlayer,
  MflLiveAppDraftPool,
  MflLiveAppDraftPoolPlayer,
  MflLiveAppDraftRoom,
  MflLiveAppDraftSlot,
  MflLiveAppDraftStatus,
} from '../../../packages/shared-types/src/mfl-live-app-draft';
import type { OwnerLeague } from './owner-league';
import { buildMflExportUrl } from '../mfl-url';
import { mflFetch } from '../mfl-fetch';
import { getPlayerMap } from '../player-map';
import { formatMflName } from '../player-name-matching';
import { positionLabel, positionRank } from '../mfl-live-lineup';
import { normalizeTeamCode } from '../nfl-logo';
import { parseTradeFromComment } from '../draft-utils';
import { pullDraftList } from '../mfl-draft-list';
import { toSafeMflUrl } from '../draft-broadcast-source';
import { atLeastAsFresh, fetchStaticBoard, picksFreshness, type RawDraftPick } from '../draft-board-freshness';

const asArray = <T>(v: T | T[] | null | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : []);
const pad = (id: unknown) => {
  const s = `${id ?? ''}`.trim();
  return /^\d+$/.test(s) ? s.padStart(4, '0') : s;
};
const int = (v: unknown): number => {
  const n = parseInt(`${v ?? ''}`, 10);
  return Number.isFinite(n) ? n : 0;
};

/** MFL's mark for a pick the commissioner skipped. */
const SKIPPED = '----';

/** A payload that parsed and is not one of MFL's 200-status errors. */
function isReadable(body: unknown): body is Record<string, any> {
  return !!body && typeof body === 'object' && !(body as { error?: unknown }).error;
}

export interface DraftIdentity {
  name: string;
  position: string;
  nflTeam: string;
  /** NFL draft year, e.g. '2026'; '' when unknown. */
  draftYear?: string;
}

/** One draft unit, already chosen and with its picks in a list. */
export interface DraftBoardRead {
  unit?: string;
  picks: RawDraftPick[];
}

export function draftKindOf(raw: unknown): MflLiveAppDraftKind {
  const kind = `${raw ?? ''}`.trim().toLowerCase();
  if (!kind) return 'unknown';
  if (kind.includes('auction')) return 'auction';
  if (kind === 'live') return 'live';
  if (kind === 'email') return 'email';
  return 'unknown';
}

/** MFL's `draftLimitHours` ("12:00", "0:02") in words, or undefined. */
export function pickClockText(raw: unknown): string | undefined {
  const m = `${raw ?? ''}`.trim().match(/^(\d+):(\d{1,2})$/);
  if (!m) return undefined;
  const hours = int(m[1]);
  const minutes = int(m[2]);
  if (hours === 0 && minutes === 0) return undefined;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  return `${parts.join(' ')} a pick`;
}

const POOL_TEXT: Record<string, string> = {
  rookie: 'Rookies only',
  veteran: 'Veterans only',
  both: 'Rookies and veterans',
};

/**
 * The unit this franchise picks in. A league with one board has one; in a
 * conference league it is the unit where the franchise holds picks, falling
 * back to the first when it holds none this year.
 */
export function chooseDraftUnit(draftResults: unknown, franchiseId: string): DraftBoardRead | null {
  if (!isReadable(draftResults)) return null;
  const units = asArray<any>((draftResults as any).draftResults?.draftUnit);
  if (units.length === 0) return null;
  const mine =
    units.find((u) => asArray<any>(u?.draftPick).some((p) => pad(p?.franchise) === franchiseId)) ?? units[0];
  const unit = `${mine?.unit ?? ''}`.trim();
  return { ...(unit ? { unit } : {}), picks: asArray<RawDraftPick>(mine?.draftPick) };
}

/** The unit's advertised static file, allowlisted to MFL's own hosts. */
function staticUrlOf(draftResults: unknown, unit: string | undefined): string | null {
  if (!isReadable(draftResults)) return null;
  const units = asArray<any>((draftResults as any).draftResults?.draftUnit);
  const found = units.find((u) => `${u?.unit ?? ''}`.trim() === (unit ?? '')) ?? (units.length === 1 ? units[0] : null);
  return toSafeMflUrl(found?.static_url);
}

function toPlayer(id: string, identity: (id: string) => DraftIdentity | undefined, year: number): MflLiveAppDraftPlayer {
  const who = identity(id);
  const player: MflLiveAppDraftPlayer = {
    id,
    name: who?.name || `Player ${id}`,
    position: positionLabel(who?.position ?? ''),
    nflTeam: who?.nflTeam ?? '',
  };
  if (who?.draftYear && who.draftYear === String(year)) player.rookie = true;
  return player;
}

/** Seconds until the app should ask again. Busy while a draft is running. */
export function pollAfterMs(kind: MflLiveAppDraftKind, status: MflLiveAppDraftStatus, mineOnClock: boolean): number {
  if (status === 'live') {
    if (kind === 'live') return 8_000;
    return mineOnClock ? 20_000 : 45_000;
  }
  if (status === 'upcoming') return 120_000;
  return 600_000;
}

export interface BuildMflLiveDraftInput {
  league: Pick<OwnerLeague, 'leagueId' | 'leagueName' | 'franchiseId' | 'franchiseName' | 'year'>;
  board: DraftBoardRead | null;
  leagueSettings: unknown;
  /** The owner's MFL pre-draft list, in order; null when it could not be read. */
  queueIds: string[] | null;
  identity: (id: string) => DraftIdentity | undefined;
  now: Date;
}

export function buildMflLiveDraft(input: BuildMflLiveDraftInput): MflLiveAppDraftRoom {
  const { league, identity, now } = input;
  const settings = isReadable(input.leagueSettings) ? (input.leagueSettings as any).league ?? {} : {};
  const kind = draftKindOf(settings.draft_kind);

  const teamNames = new Map<string, string>(
    asArray<any>(settings.franchises?.franchise).map((f) => [pad(f?.id), `${f?.name ?? ''}`.trim()] as [string, string]),
  );
  const nameOf = (id: string) => teamNames.get(id) || (id === league.franchiseId ? league.franchiseName : '') || `Team ${id}`;

  const sorted = [...(input.board?.picks ?? [])]
    .filter((p) => int(p.round) > 0)
    .sort((a, b) => int(a.round) - int(b.round) || int(a.pick) - int(b.pick));

  const slots: MflLiveAppDraftSlot[] = sorted.map((p, idx) => {
    const round = int(p.round);
    const pick = int(p.pick) || 1;
    const playerId = `${p.player ?? ''}`.trim();
    const slot: MflLiveAppDraftSlot = {
      overall: idx + 1,
      round,
      pick,
      label: `${round}.${String(pick).padStart(2, '0')}`,
      franchiseId: pad(p.franchise),
    };
    const fromTeam = parseTradeFromComment(`${p.comments ?? ''}`);
    if (fromTeam) slot.fromTeam = fromTeam;
    if (playerId === SKIPPED) slot.skipped = true;
    else if (playerId) slot.player = toPlayer(playerId, identity, league.year);
    const ts = int(p.timestamp);
    if ((slot.player || slot.skipped) && ts > 0) slot.madeAt = new Date(ts * 1000).toISOString();
    return slot;
  });

  const done = (s: MflLiveAppDraftSlot) => !!s.player || !!s.skipped;
  const madeCount = slots.filter(done).length;
  const status: MflLiveAppDraftStatus =
    slots.length === 0 ? 'not-set' : madeCount === 0 ? 'upcoming' : madeCount === slots.length ? 'complete' : 'live';

  // The first slot still open. MFL fills picks in order, so a made pick after
  // an open one only happens when the commissioner edits the board by hand —
  // the open one is still the one on the clock.
  const clockIdx = status === 'complete' ? -1 : slots.findIndex((s) => !done(s));
  const clockSlot = clockIdx >= 0 ? slots[clockIdx] : undefined;
  const previous = clockIdx > 0 ? slots[clockIdx - 1] : undefined;
  const onClock = clockSlot
    ? {
        overall: clockSlot.overall,
        label: clockSlot.label,
        franchiseId: clockSlot.franchiseId,
        mine: clockSlot.franchiseId === league.franchiseId,
        ...(previous?.madeAt ? { since: previous.madeAt } : {}),
      }
    : undefined;

  const next = slots.find((s) => !done(s) && s.franchiseId === league.franchiseId);
  const myNextPick =
    next && clockSlot ? { overall: next.overall, label: next.label, picksAway: next.overall - clockSlot.overall } : undefined;

  // Order of first appearance on the board, which is round 1's order.
  const teamOrder: string[] = [];
  for (const s of slots) if (!teamOrder.includes(s.franchiseId)) teamOrder.push(s.franchiseId);
  for (const id of teamNames.keys()) if (!teamOrder.includes(id)) teamOrder.push(id);

  const taken = new Set(slots.map((s) => s.player?.id).filter((id): id is string => !!id));
  const queue = input.queueIds
    ? input.queueIds.filter((id) => !taken.has(id)).map((id) => toPlayer(id, identity, league.year))
    : null;

  const pool = POOL_TEXT[`${settings.draftPlayerPool ?? ''}`.trim().toLowerCase()];
  const pickClock = pickClockText(settings.draftLimitHours);

  return {
    ok: true,
    leagueId: league.leagueId,
    leagueName: `${settings.name ?? ''}`.trim() || league.leagueName,
    year: league.year,
    franchiseId: league.franchiseId,
    kind,
    status,
    ...(input.board?.unit ? { unit: input.board.unit } : {}),
    ...(pool ? { pool } : {}),
    ...(pickClock ? { pickClock } : {}),
    rounds: new Set(slots.map((s) => s.round)).size,
    teams: teamOrder.map((franchiseId) => ({ franchiseId, name: nameOf(franchiseId) })),
    slots,
    ...(onClock ? { onClock } : {}),
    ...(myNextPick ? { myNextPick } : {}),
    queue,
    generatedAt: now.toISOString(),
    pollAfterMs: pollAfterMs(kind, status, !!onClock?.mine),
  };
}

/** How many available players the pool returns. Enough to draft from, small enough for a phone. */
export const POOL_LIMIT = 400;

export interface BuildMflLiveDraftPoolInput {
  leagueId: string;
  year: number;
  /** Ids MFL lists as free agents in this owner's unit. */
  freeAgentIds: string[];
  /** Players already picked on the board, removed whatever MFL's roster says. */
  takenIds: Set<string>;
  /** `draftPlayerPool` from the league settings. */
  draftPlayerPool: unknown;
  /** MFL player id → ADP rank. */
  adpRanks: Map<string, number>;
  identity: (id: string) => DraftIdentity | undefined;
  now: Date;
}

export function buildMflLiveDraftPool(input: BuildMflLiveDraftPoolInput): MflLiveAppDraftPool {
  const { year, identity } = input;
  const rookiesOnly = `${input.draftPlayerPool ?? ''}`.trim().toLowerCase() === 'rookie';
  const seen = new Set<string>();
  const players: MflLiveAppDraftPoolPlayer[] = [];
  for (const raw of input.freeAgentIds) {
    const id = `${raw}`.trim();
    if (!id || seen.has(id) || input.takenIds.has(id)) continue;
    seen.add(id);
    const who = identity(id);
    // A player nothing can name is not someone an owner can choose.
    if (!who) continue;
    const player: MflLiveAppDraftPoolPlayer = toPlayer(id, identity, year);
    if (rookiesOnly && !player.rookie) continue;
    const rank = input.adpRanks.get(id);
    if (rank) player.adpRank = rank;
    players.push(player);
  }
  players.sort(
    (a, b) =>
      (a.adpRank ?? Number.MAX_SAFE_INTEGER) - (b.adpRank ?? Number.MAX_SAFE_INTEGER) ||
      positionRank(a.position) - positionRank(b.position) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
  return {
    ok: true,
    leagueId: input.leagueId,
    players: players.slice(0, POOL_LIMIT),
    rookiesOnly,
    generatedAt: input.now.toISOString(),
  };
}

/** The ids in a `freeAgents` export for this unit. */
export function freeAgentIdsOf(freeAgents: unknown, unit: string | undefined): string[] | null {
  if (!isReadable(freeAgents)) return null;
  const units = asArray<any>((freeAgents as any).freeAgents?.leagueUnit);
  if (units.length === 0) return [];
  const mine = (unit && units.find((u) => `${u?.unit ?? ''}`.trim() === unit)) || units[0];
  return asArray<any>(mine?.player).map((p) => `${p?.id ?? ''}`.trim()).filter(Boolean);
}

// ── Network ──────────────────────────────────────────────────────────────────

/** One MFL export with the owner's cookie; null for anything that is not a usable payload. */
async function readExport(
  league: OwnerLeague,
  mflUserCookie: string,
  type: string,
  params: Record<string, string | number> = {},
): Promise<Record<string, any> | null> {
  try {
    const url = buildMflExportUrl({
      type,
      leagueId: league.leagueId,
      year: league.year,
      params,
      ...(league.host ? { host: league.host } : {}),
    });
    const res = await mflFetch({ url, method: 'GET', mflUserCookie });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    if (!isReadable(body)) {
      if (body) console.warn(`[mfl-live-draft] ${type} for ${league.leagueId}: ${String((body as any).error).slice(0, 120)}`);
      return null;
    }
    return body;
  } catch {
    return null;
  }
}

/**
 * The board this owner picks on, from the JSON export or MFL's static file,
 * whichever is fresher. Null when MFL would not give us draft results at all.
 */
async function readBoard(league: OwnerLeague, mflUserCookie: string): Promise<DraftBoardRead | null> {
  const draftResults = await readExport(league, mflUserCookie, 'draftResults');
  const board = chooseDraftUnit(draftResults, league.franchiseId);
  if (!board) return draftResults ? { picks: [] } : null;
  const staticUrl = staticUrlOf(draftResults, board.unit);
  const staticPicks = staticUrl ? await fetchStaticBoard(staticUrl) : null;
  if (staticPicks && atLeastAsFresh(picksFreshness(staticPicks), picksFreshness(board.picks))) {
    return { ...board, picks: staticPicks };
  }
  return board;
}

/** The host MFL's write and read helpers take: `wwwNN.myfantasyleague.com`, no scheme. */
function bareHost(league: OwnerLeague): string {
  return (league.host ?? 'https://api.myfantasyleague.com').replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

/**
 * Names for players the bundled player map does not carry — an IDP league's
 * defenders, a rookie the nightly feed has not caught up with. One public
 * `players` export for just those ids.
 */
async function readMissingIdentities(year: number, ids: string[]): Promise<Map<string, DraftIdentity>> {
  const out = new Map<string, DraftIdentity>();
  if (ids.length === 0) return out;
  try {
    // Public export, so no cookie: the owner's credential goes only where it must.
    const query = new URLSearchParams({ TYPE: 'players', PLAYERS: ids.slice(0, POOL_LIMIT).join(','), DETAILS: '1', JSON: '1' });
    const res = await fetch(`https://api.myfantasyleague.com/${year}/export?${query}`, {
      signal: AbortSignal.timeout(6000),
    });
    const body = res.ok ? await res.json().catch(() => null) : null;
    for (const p of asArray<any>(body?.players?.player)) {
      if (!p?.id) continue;
      out.set(`${p.id}`, {
        name: formatMflName(`${p.name ?? ''}`),
        position: `${p.position ?? ''}`,
        nflTeam: normalizeTeamCode(`${p.team ?? ''}`),
        draftYear: `${p.draft_year ?? ''}`,
      });
    }
  } catch {
    /* fall back to ids */
  }
  return out;
}

async function identityFor(year: number, ids: string[]): Promise<(id: string) => DraftIdentity | undefined> {
  const map = getPlayerMap(year);
  const missing = await readMissingIdentities(year, ids.filter((id) => id && id !== SKIPPED && !map.has(id)));
  return (id) => {
    const hit = map.get(id);
    return hit ? { name: hit.name, position: hit.position, nflTeam: hit.nflTeam, draftYear: hit.draftYear } : missing.get(id);
  };
}

/** Read the room. Null when MFL would not give us the draft results. */
export async function readMflLiveDraft(
  league: OwnerLeague,
  mflUserCookie: string,
  now: Date = new Date(),
): Promise<MflLiveAppDraftRoom | null> {
  const [board, leagueSettings, list] = await Promise.all([
    readBoard(league, mflUserCookie),
    readExport(league, mflUserCookie, 'league'),
    pullDraftList({ league: { id: league.leagueId, mflHost: bareHost(league) }, year: league.year, mflUserCookie }).catch(
      () => null,
    ),
  ]);
  if (!board) return null;
  const queueIds = list?.ok ? list.playerIds : null;
  const ids = [...board.picks.map((p) => `${p.player ?? ''}`.trim()), ...(queueIds ?? [])];
  const identity = await identityFor(league.year, ids);
  return buildMflLiveDraft({ league, board, leagueSettings, queueIds, identity, now });
}

/** MFL's ADP is the same for every viewer, so one read serves every room for a while. */
const ADP_TTL_MS = 6 * 60 * 60 * 1000;
const adpCache = new Map<number, { at: number; ranks: Map<string, number> }>();

async function readAdpRanks(year: number): Promise<Map<string, number>> {
  const hit = adpCache.get(year);
  if (hit && Date.now() - hit.at < ADP_TTL_MS) return hit.ranks;
  const ranks = new Map<string, number>();
  try {
    // The same public export the built-in "MFL ADP" ranking source reads
    // (scripts/fetch-ranking-sources.mjs).
    const res = await fetch(`https://api.myfantasyleague.com/${year}/export?TYPE=adp&IS_PPR=1&IS_MOCK=0&JSON=1`, {
      signal: AbortSignal.timeout(6000),
    });
    const body = res.ok ? await res.json().catch(() => null) : null;
    for (const p of asArray<any>(body?.adp?.player)) {
      const rank = int(p?.rank);
      if (p?.id && rank > 0) ranks.set(`${p.id}`, rank);
    }
  } catch {
    /* no ADP: the pool sorts by position and name */
  }
  // An empty answer is not cached, so a blip doesn't leave every room unsorted for hours.
  if (ranks.size > 0) adpCache.set(year, { at: Date.now(), ranks });
  return ranks;
}

/** Read the players still available. Null when MFL would not give us its free-agent list. */
export async function readMflLiveDraftPool(
  league: OwnerLeague,
  mflUserCookie: string,
  now: Date = new Date(),
): Promise<MflLiveAppDraftPool | null> {
  const [board, leagueSettings, freeAgents, adpRanks] = await Promise.all([
    readBoard(league, mflUserCookie),
    readExport(league, mflUserCookie, 'league'),
    readExport(league, mflUserCookie, 'freeAgents'),
    readAdpRanks(league.year),
  ]);
  const freeAgentIds = freeAgentIdsOf(freeAgents, board?.unit);
  if (!freeAgentIds) return null;

  // Name the likeliest picks first: the bundled map covers the usual positions,
  // and the extra read is only for ids it doesn't know, best ADP first.
  const ordered = [...freeAgentIds].sort(
    (a, b) => (adpRanks.get(a) ?? Number.MAX_SAFE_INTEGER) - (adpRanks.get(b) ?? Number.MAX_SAFE_INTEGER),
  );
  const identity = await identityFor(league.year, ordered);
  const takenIds = new Set(
    (board?.picks ?? []).map((p) => `${p.player ?? ''}`.trim()).filter((id) => id && id !== SKIPPED),
  );
  const settings = isReadable(leagueSettings) ? (leagueSettings as any).league ?? {} : {};
  return buildMflLiveDraftPool({
    leagueId: league.leagueId,
    year: league.year,
    freeAgentIds,
    takenIds,
    draftPlayerPool: settings.draftPlayerPool,
    adpRanks,
    identity,
    now,
  });
}
