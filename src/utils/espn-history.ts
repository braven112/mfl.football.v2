/**
 * ESPN League History — pilot import (upload-based).
 *
 * WHY UPLOADS, NOT FETCHES. A private ESPN league answers only to its own
 * members' browsers (`AUTH_LEAGUE_NOT_VISIBLE` otherwise). Validated
 * 2026-09-23: a commissioner logged in at espn.com can open
 * `lm-api-reads.fantasy.espn.com/.../leagues/<id>` directly and read the full
 * JSON. So the commissioner fetches, and uploads (or pastes) what they got;
 * we never hold an ESPN login or cookie.
 *
 * WHO CAN UPLOAD. Whoever holds the import's secret link. The commissioner of
 * an ESPN league has no session on this site, so the link IS the credential:
 * 32 random bytes, minted by a site admin per league, revocable by deleting
 * the import. Uploads are rate-limited per link.
 *
 * STORAGE. Redis for the pilot. Every upload is kept as an immutable,
 * gzip-compressed snapshot (deduplicated by content hash) so a translator bug
 * can be fixed and re-run against the originals; the translated season is
 * derived from the snapshots, never edited in place. Nothing here is committed
 * to the repo, which is public.
 *
 * The ESPN v3 shapes read here (teams, members, schedule, status, settings)
 * are defensive: every field is optional and a missing one degrades the
 * summary rather than failing the import.
 */

import { createHash, randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { getRedis } from './redis-client';

// ---------------------------------------------------------------------------
// ESPN links the commissioner opens
// ---------------------------------------------------------------------------

const ESPN_API = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';

/** The views that carry what the history pages need. */
export const ESPN_VIEWS = [
  { view: 'mTeam', label: 'Teams, owners and records' },
  { view: 'mMatchup', label: 'Weekly scores' },
  { view: 'mSettings', label: 'League name and settings' },
] as const;

/** Seasons from 2018 on live under /seasons/<year>; earlier ones under /leagueHistory. */
export const ESPN_MODERN_SEASON_FLOOR = 2018;

export function espnSeasonUrl(leagueId: string, seasonId: number, view: string): string {
  if (seasonId < ESPN_MODERN_SEASON_FLOOR) {
    const url = new URL(`${ESPN_API}/leagueHistory/${leagueId}`);
    url.searchParams.set('seasonId', String(seasonId));
    url.searchParams.set('view', view);
    return url.href;
  }
  const url = new URL(`${ESPN_API}/seasons/${seasonId}/segments/0/leagues/${leagueId}`);
  url.searchParams.set('view', view);
  return url.href;
}

/** ESPN numbers a season by the year it starts, so September–December is that year and January–August the previous one. */
export function currentEspnSeason(now: Date = new Date()): number {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() >= 8 ? year : year - 1;
}

// ---------------------------------------------------------------------------
// Validation + translation (pure)
// ---------------------------------------------------------------------------

export const ESPN_LEAGUE_ID = /^\d{1,12}$/;
export const MAX_UPLOAD_CHARS = 8_000_000;

interface RawTeam {
  id?: number;
  name?: string;
  location?: string;
  nickname?: string;
  abbrev?: string;
  owners?: string[];
  primaryOwner?: string;
  playoffSeed?: number;
  rankCalculatedFinal?: number;
  record?: { overall?: { wins?: number; losses?: number; ties?: number; pointsFor?: number; pointsAgainst?: number } };
}
interface RawMember { id?: string; displayName?: string; firstName?: string; lastName?: string }
interface RawSide { teamId?: number; totalPoints?: number }
interface RawMatchup {
  matchupPeriodId?: number;
  home?: RawSide;
  away?: RawSide;
  winner?: string;
  playoffTierType?: string;
}
interface RawSeason {
  id?: number;
  seasonId?: number;
  teams?: RawTeam[];
  members?: RawMember[];
  schedule?: RawMatchup[];
  settings?: { name?: string };
  status?: { isActive?: boolean; currentMatchupPeriod?: number; finalScoringPeriod?: number };
}

export interface EspnTeamSummary {
  id: number;
  name: string;
  abbrev: string | null;
  owners: string[];
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  playoffSeed: number | null;
  finalRank: number | null;
}

export interface EspnMatchupSummary {
  week: number;
  homeTeamId: number;
  homePoints: number;
  awayTeamId: number | null;
  awayPoints: number | null;
  winner: 'HOME' | 'AWAY' | 'TIE' | 'UNDECIDED';
  playoff: boolean;
}

export interface EspnSeasonSummary {
  leagueId: string;
  seasonId: number;
  leagueName: string | null;
  isActive: boolean | null;
  currentWeek: number | null;
  teams: EspnTeamSummary[];
  matchups: EspnMatchupSummary[];
  /** Team id with final rank 1, only once ESPN has calculated final ranks. */
  championTeamId: number | null;
}

export type ParseResult =
  | { ok: true; seasons: Array<{ raw: RawSeason; summary: EspnSeasonSummary; views: string[] }> }
  | { ok: false; error: string };

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function teamName(t: RawTeam): string {
  if (t.name?.trim()) return t.name.trim();
  const joined = [t.location, t.nickname].filter(Boolean).join(' ').trim();
  return joined || `Team ${t.id ?? '?'}`;
}

function memberName(m: RawMember | undefined): string | null {
  if (!m) return null;
  if (m.displayName?.trim()) return m.displayName.trim();
  const full = [m.firstName, m.lastName].filter(Boolean).join(' ').trim();
  return full || null;
}

const WINNERS = new Set(['HOME', 'AWAY', 'TIE', 'UNDECIDED']);

/** Which of our views a payload actually carries — so the page can say what is still missing. */
export function viewsPresent(raw: RawSeason): string[] {
  const views: string[] = [];
  if (raw.teams?.some((t) => t.record || t.owners)) views.push('mTeam');
  if (raw.schedule?.length) views.push('mMatchup');
  if (raw.settings?.name) views.push('mSettings');
  return views;
}

export function summarizeSeason(raw: RawSeason, leagueId: string): EspnSeasonSummary {
  const members = new Map((raw.members ?? []).map((m) => [m.id ?? '', m]));
  const teams: EspnTeamSummary[] = (raw.teams ?? [])
    .filter((t) => typeof t.id === 'number')
    .map((t) => {
      const ownerIds = t.owners?.length ? t.owners : t.primaryOwner ? [t.primaryOwner] : [];
      const overall = t.record?.overall;
      return {
        id: t.id as number,
        name: teamName(t),
        abbrev: t.abbrev?.trim() || null,
        owners: ownerIds.map((id) => memberName(members.get(id)) ?? 'Unknown owner'),
        wins: num(overall?.wins),
        losses: num(overall?.losses),
        ties: num(overall?.ties),
        pointsFor: num(overall?.pointsFor),
        pointsAgainst: num(overall?.pointsAgainst),
        playoffSeed: t.playoffSeed && t.playoffSeed > 0 ? t.playoffSeed : null,
        finalRank: t.rankCalculatedFinal && t.rankCalculatedFinal > 0 ? t.rankCalculatedFinal : null,
      };
    });

  const matchups: EspnMatchupSummary[] = (raw.schedule ?? [])
    .filter((m) => typeof m.home?.teamId === 'number' && typeof m.matchupPeriodId === 'number')
    .map((m) => ({
      week: m.matchupPeriodId as number,
      homeTeamId: m.home!.teamId as number,
      homePoints: num(m.home!.totalPoints),
      awayTeamId: typeof m.away?.teamId === 'number' ? m.away.teamId : null,
      awayPoints: typeof m.away?.teamId === 'number' ? num(m.away.totalPoints) : null,
      winner: (WINNERS.has(m.winner ?? '') ? m.winner : 'UNDECIDED') as EspnMatchupSummary['winner'],
      playoff: Boolean(m.playoffTierType && m.playoffTierType !== 'NONE'),
    }));

  const champion = teams.find((t) => t.finalRank === 1);
  return {
    leagueId,
    seasonId: raw.seasonId as number,
    leagueName: raw.settings?.name?.trim() || null,
    isActive: typeof raw.status?.isActive === 'boolean' ? raw.status.isActive : null,
    currentWeek: typeof raw.status?.currentMatchupPeriod === 'number' ? raw.status.currentMatchupPeriod : null,
    teams,
    matchups,
    championTeamId: champion ? champion.id : null,
  };
}

/**
 * Parse one upload (a file's text or pasted text). Accepts a single season
 * object (the /seasons endpoint) or an array of them (/leagueHistory), and
 * refuses anything that is not this league's data — including ESPN's own
 * "not authorized" body, which is what a logged-out commissioner gets.
 */
export function parseEspnUpload(text: string, leagueId: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'The upload was empty.' };
  if (trimmed.length > MAX_UPLOAD_CHARS) return { ok: false, error: 'That file is too large to be one ESPN league response.' };

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      error: "That isn't the raw text ESPN shows. Open the link, select all of the text, copy it, and paste it here.",
    };
  }

  if (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray((data as { messages?: unknown }).messages)) {
    return {
      ok: false,
      error: 'ESPN answered "not authorized". Log in at espn.com in this same browser, then open the link again.',
    };
  }

  const candidates = (Array.isArray(data) ? data : [data]) as RawSeason[];
  const seasons: Array<{ raw: RawSeason; summary: EspnSeasonSummary; views: string[] }> = [];
  for (const raw of candidates) {
    if (!raw || typeof raw !== 'object') continue;
    if (String(raw.id) !== leagueId) {
      return { ok: false, error: `That data belongs to ESPN league ${raw.id ?? 'unknown'}, not ${leagueId}.` };
    }
    if (typeof raw.seasonId !== 'number' || raw.seasonId < 2000 || raw.seasonId > 2100) {
      return { ok: false, error: 'That data has no season year, so it cannot be filed.' };
    }
    seasons.push({ raw, summary: summarizeSeason(raw, leagueId), views: viewsPresent(raw) });
  }
  if (!seasons.length) return { ok: false, error: 'No league seasons were found in that upload.' };
  return { ok: true, seasons };
}

/**
 * Fold a newer summary over an older one for the same season: each part keeps
 * the most recent upload that actually carried it, so an mMatchup upload does
 * not blank the owners an earlier mTeam upload supplied.
 */
export function mergeSummaries(older: EspnSeasonSummary | null, newer: EspnSeasonSummary): EspnSeasonSummary {
  if (!older) return newer;
  const teams = newer.teams.some((t) => t.owners.length || t.wins || t.losses) ? newer.teams : older.teams;
  return {
    ...newer,
    leagueName: newer.leagueName ?? older.leagueName,
    isActive: newer.isActive ?? older.isActive,
    currentWeek: newer.currentWeek ?? older.currentWeek,
    teams: teams.length ? teams : older.teams,
    matchups: newer.matchups.length ? newer.matchups : older.matchups,
    championTeamId: newer.championTeamId ?? older.championTeamId,
  };
}

// ---------------------------------------------------------------------------
// Storage (Redis)
// ---------------------------------------------------------------------------

export interface EspnImport {
  leagueId: string;
  label: string;
  token: string;
  createdAt: string;
}

export interface SnapshotMeta {
  seasonId: number;
  views: string[];
  sha256: string;
  bytes: number;
  uploadedAt: string;
}

const K = {
  imports: 'espn-history:imports',
  import: (leagueId: string) => `espn-history:import:${leagueId}`,
  token: (token: string) => `espn-history:token:${token}`,
  snaps: (leagueId: string) => `espn-history:${leagueId}:snaps`,
  snap: (leagueId: string, sha: string) => `espn-history:${leagueId}:snap:${sha}`,
  season: (leagueId: string, seasonId: number) => `espn-history:${leagueId}:season:${seasonId}`,
  seasons: (leagueId: string) => `espn-history:${leagueId}:seasons`,
};

/** Upstash's request ceiling is 1 MB on the smallest plan; stay under it after compression. */
const MAX_STORED_BYTES = 900_000;

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export async function createEspnImport(leagueId: string, label: string): Promise<EspnImport | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const existing = await redis.get<EspnImport>(K.import(leagueId));
  if (existing) return existing;
  const record: EspnImport = {
    leagueId,
    label: label.trim().slice(0, 80) || `ESPN league ${leagueId}`,
    token: randomBytes(32).toString('base64url'),
    createdAt: new Date().toISOString(),
  };
  await redis.set(K.import(leagueId), record);
  await redis.set(K.token(record.token), leagueId);
  await redis.sadd(K.imports, leagueId);
  return record;
}

export async function listEspnImports(): Promise<EspnImport[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const ids = await redis.smembers(K.imports);
  const records = await Promise.all(ids.map((id) => redis.get<EspnImport>(K.import(id))));
  return records.filter((r): r is EspnImport => Boolean(r)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getEspnImport(leagueId: string): Promise<EspnImport | null> {
  const redis = await getRedis();
  if (!redis) return null;
  return redis.get<EspnImport>(K.import(leagueId));
}

export async function resolveImportToken(token: string): Promise<EspnImport | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const redis = await getRedis();
  if (!redis) return null;
  const leagueId = await redis.get<string>(K.token(token));
  if (!leagueId) return null;
  const record = await redis.get<EspnImport>(K.import(String(leagueId)));
  return record && record.token === token ? record : null;
}

export type StoreResult =
  | { ok: true; stored: Array<{ seasonId: number; views: string[]; duplicate: boolean }> }
  | { ok: false; error: string };

/** Save each season in an upload as a snapshot and refresh its translated summary. */
export async function storeEspnUpload(leagueId: string, text: string): Promise<StoreResult> {
  const parsed = parseEspnUpload(text, leagueId);
  if (!parsed.ok) return parsed;
  const redis = await getRedis();
  if (!redis) return { ok: false, error: 'Storage is not configured, so nothing was saved.' };

  const known = new Set((await redis.lrange<SnapshotMeta>(K.snaps(leagueId), 0, -1)).map((m) => m.sha256));
  const stored: Array<{ seasonId: number; views: string[]; duplicate: boolean }> = [];

  for (const { raw, summary, views } of parsed.seasons) {
    const json = JSON.stringify(raw);
    const sha256 = createHash('sha256').update(json).digest('hex');
    if (known.has(sha256)) {
      stored.push({ seasonId: summary.seasonId, views, duplicate: true });
      continue;
    }
    const packed = gzipSync(json).toString('base64');
    if (packed.length > MAX_STORED_BYTES) {
      return { ok: false, error: `Season ${summary.seasonId} is too large to store in the pilot (${packed.length.toLocaleString()} bytes compressed).` };
    }
    const meta: SnapshotMeta = { seasonId: summary.seasonId, views, sha256, bytes: json.length, uploadedAt: new Date().toISOString() };
    await redis.set(K.snap(leagueId, sha256), packed);
    await redis.lpush(K.snaps(leagueId), meta);
    const previous = await redis.get<EspnSeasonSummary>(K.season(leagueId, summary.seasonId));
    await redis.set(K.season(leagueId, summary.seasonId), mergeSummaries(previous, summary));
    await redis.sadd(K.seasons(leagueId), String(summary.seasonId));
    known.add(sha256);
    stored.push({ seasonId: summary.seasonId, views, duplicate: false });
  }
  return { ok: true, stored };
}

export async function listSnapshots(leagueId: string): Promise<SnapshotMeta[]> {
  const redis = await getRedis();
  if (!redis) return [];
  return redis.lrange<SnapshotMeta>(K.snaps(leagueId), 0, -1);
}

export async function readSeasonSummaries(leagueId: string): Promise<EspnSeasonSummary[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const years = (await redis.smembers(K.seasons(leagueId))).map(Number).filter(Number.isFinite);
  const summaries = await Promise.all(years.map((y) => redis.get<EspnSeasonSummary>(K.season(leagueId, y))));
  return summaries.filter((s): s is EspnSeasonSummary => Boolean(s)).sort((a, b) => b.seasonId - a.seasonId);
}

/** The original upload, for re-running a fixed translator. Server-side only. */
export async function readSnapshotRaw(leagueId: string, sha256: string): Promise<unknown | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const packed = await redis.get<string>(K.snap(leagueId, sha256));
  if (!packed) return null;
  return JSON.parse(gunzipSync(Buffer.from(packed, 'base64')).toString('utf8'));
}

/**
 * Display order for a season's teams. ESPN data, not MFL's, so there is no
 * official row order to preserve: final rank once ESPN has it, then playoff
 * seed, then record and points.
 */
export function sortStandings(teams: EspnTeamSummary[]): EspnTeamSummary[] {
  const rank = (v: number | null) => (v == null ? Number.POSITIVE_INFINITY : v);
  return [...teams].sort(
    (a, b) =>
      rank(a.finalRank) - rank(b.finalRank) ||
      rank(a.playoffSeed) - rank(b.playoffSeed) ||
      b.wins - a.wins ||
      a.losses - b.losses ||
      b.pointsFor - a.pointsFor,
  );
}
