/**
 * Server-side data assembler for the live-scoring page.
 *
 * Resolves everything the page island needs on load: the teams map (franchise
 * crest + colors), each starter's static identity + weekly projection, the
 * matchup pairings, and the initial live snapshot. The island then polls
 * /api/live-scoring for the numbers that change during games and merges them
 * onto this static metadata by player id.
 *
 * League-agnostic: pass the league's id / MFL host / dataPath / config teams
 * from getLeagueContext() + the per-league config JSON, so the same helper
 * serves TheLeague and AFL.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPlayer } from './player-map';
import { resolveThrowbackIdentity } from './throwback-identity';
import type { FranchiseHistoryEntry } from './team-names';
import type {
  LivePlayerRow,
  MatchupPairing,
  PlayerMeta,
  TeamInfo,
} from '../types/live-scoring';

/** Minimal shape of a franchise entry in a `data/<slug>/*.config.json`. */
export interface ConfigTeam {
  franchiseId: string;
  name: string;
  nameMedium?: string;
  nameShort?: string;
  abbrev?: string;
  color?: string;
  colorPrimary?: string;
  colorSecondary?: string;
  colorPrimaryDark?: string;
  colorSecondaryDark?: string;
  icon?: string;
  banner?: string;
  history?: FranchiseHistoryEntry[];
}

/**
 * Swap each team's name/icon/banner for its resolved Throwback Week identity
 * when active. No-op (returns `configTeams` unchanged) otherwise. Applied
 * before `buildTeamsMap()` so the teams map, matchup pairings, and the live
 * scoring hero all pick up the swap without any changes downstream.
 */
export function applyThrowbackOverrides(
  configTeams: ConfigTeam[],
  isThrowbackActive: boolean,
  ownerOverrides: Record<string, number> = {}
): ConfigTeam[] {
  if (!isThrowbackActive) return configTeams;

  return configTeams.map((t) => {
    const identity = resolveThrowbackIdentity(t, ownerOverrides[t.franchiseId]);
    // Don't fall back to the CURRENT team's nameMedium/nameShort/abbrev when
    // the legacy era entry doesn't define its own — that would silently
    // re-show the current identity's short name next to a legacy icon.
    // Downstream render calls (e.g. LiveScoreboard's `nameShort ?? name`)
    // fall back to `name` correctly once these are cleared.
    //
    // Era colors: when the era defines its own palette, matchup washes and
    // win-probability bars tint in the legacy colors too. The *Dark variants
    // are cleared alongside — they belong to the CURRENT palette, and
    // downstream already falls back to the light colors when they're absent.
    const hasEraColors = identity.isHistorical && !!identity.colorPrimary;
    return {
      ...t,
      name: identity.name,
      nameMedium: identity.isHistorical ? identity.nameMedium : t.nameMedium,
      nameShort: identity.isHistorical ? identity.nameShort : t.nameShort,
      abbrev: identity.isHistorical ? identity.abbrev : t.abbrev,
      icon: identity.icon ?? t.icon,
      banner: identity.banner ?? t.banner,
      ...(hasEraColors
        ? {
            color: identity.colorPrimary,
            colorPrimary: identity.colorPrimary,
            colorSecondary: identity.colorSecondary ?? identity.colorPrimary,
            colorPrimaryDark: undefined,
            colorSecondaryDark: undefined,
          }
        : {}),
    };
  });
}

export interface LiveScoringData {
  /**
   * Whether the live snapshot fetch actually succeeded. Distinguishes an
   * empty-but-healthy feed (offseason: HTTP 200, no matchups) from a failed
   * fetch (the internal API errors resolve to the same empty collections). The
   * page only auto-falls back to the sample when `ok` AND there are no matchups,
   * so an in-season outage surfaces the empty/error state instead of silently
   * masquerading as offseason "Sample data".
   */
  ok: boolean;
  teams: Record<string, TeamInfo>;
  matchups: MatchupPairing[];
  playerMeta: Record<string, PlayerMeta>;
  scores: Record<string, number>;
  remaining: Record<string, number>;
  players: Record<string, LivePlayerRow[]>;
  playersYetToPlay: Record<string, number>;
}

export interface AssembleOpts {
  /** Astro.url — provides the origin for the internal API fetch. */
  siteUrl: URL;
  week: number;
  year: number;
  leagueId: string;
  /** Bare MFL host (e.g. www49.myfantasyleague.com). */
  host: string;
  /** Repo-relative data dir, e.g. data/theleague. */
  dataPath: string;
  configTeams: ConfigTeam[];
  userFranchiseId?: string;
}

/** Build the franchise display map (crest icon + colors) from config. */
export function buildTeamsMap(configTeams: ConfigTeam[]): Record<string, TeamInfo> {
  const map: Record<string, TeamInfo> = {};
  for (const t of configTeams) {
    map[t.franchiseId] = {
      franchiseId: t.franchiseId,
      name: t.name,
      nameMedium: t.nameMedium,
      nameShort: t.nameShort,
      abbrev: t.abbrev,
      color: t.color ?? t.colorPrimary ?? '#1c497c',
      colorPrimary: t.colorPrimary,
      colorSecondary: t.colorSecondary,
      colorPrimaryDark: t.colorPrimaryDark,
      colorSecondaryDark: t.colorSecondaryDark,
      icon: t.icon,
      banner: t.banner,
    };
  }
  return map;
}

/**
 * Load the week's league projections as a Map<playerId, points>. The MFL
 * `projectedScores` feed is a single-week snapshot whose `playerScore` may be
 * an array, a lone object, or empty (offseason) — all handled here.
 */
export function loadProjections(dataPath: string, year: number): Map<string, number> {
  const proj = new Map<string, number>();
  try {
    const file = join(process.cwd(), dataPath, 'mfl-feeds', String(year), 'projectedScores.json');
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    const rows = raw?.projectedScores?.playerScore;
    const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
    for (const r of list) {
      if (r?.id) proj.set(String(r.id), Number(r.score) || 0);
    }
  } catch {
    // Feed missing / offseason — no projections, model degrades to live-only.
  }
  return proj;
}

/** Resolve static identity + projection for every starter id in the snapshot. */
export function buildPlayerMeta(
  year: number,
  playerIds: Iterable<string>,
  projections: Map<string, number>,
): Record<string, PlayerMeta> {
  const meta: Record<string, PlayerMeta> = {};
  for (const id of playerIds) {
    if (meta[id]) continue;
    const p = getPlayer(year, id);
    meta[id] = {
      id,
      name: p?.name ?? 'Unknown Player',
      position: p?.position ?? '',
      nflTeam: p?.nflTeam ?? '',
      headshot: p?.headshot ?? '',
      espnId: p?.espnId ?? null,
      projected: projections.get(id) ?? 0,
    };
  }
  return meta;
}

/** Fetch the initial live snapshot from our own API (server-side). */
async function fetchInitialSnapshot(opts: AssembleOpts) {
  const api = new URL('/api/live-scoring', opts.siteUrl);
  api.searchParams.set('week', String(opts.week));
  api.searchParams.set('year', String(opts.year));
  api.searchParams.set('L', opts.leagueId);
  api.searchParams.set('host', `https://${opts.host}`);
  const res = await fetch(api);
  if (!res.ok) throw new Error(`live-scoring api ${res.status}`);
  return res.json();
}

/** Assemble the full page dataset. Best-effort: never throws to the page. */
export async function assembleLiveScoringData(opts: AssembleOpts): Promise<LiveScoringData> {
  const teams = buildTeamsMap(opts.configTeams);
  const projections = loadProjections(opts.dataPath, opts.year);

  let snapshot: any = {};
  let ok = false;
  try {
    snapshot = await fetchInitialSnapshot(opts);
    // Trust the fetch only when BOTH the internal API responded (no throw, res.ok)
    // AND its payload's `ok` isn't explicitly false (which the API sets when the
    // upstream MFL liveScoring request failed — the internal route still 200s).
    ok = snapshot?.ok !== false;
  } catch {
    snapshot = {};
  }

  const players: Record<string, LivePlayerRow[]> = snapshot.players ?? {};
  const ids = new Set<string>();
  for (const rows of Object.values(players)) {
    for (const r of rows as LivePlayerRow[]) ids.add(r.id);
  }
  const playerMeta = buildPlayerMeta(opts.year, ids, projections);

  return {
    ok,
    teams,
    matchups: snapshot.matchups ?? [],
    playerMeta,
    scores: snapshot.scores ?? {},
    remaining: snapshot.remaining ?? {},
    players,
    playersYetToPlay: snapshot.playersYetToPlay ?? {},
  };
}
