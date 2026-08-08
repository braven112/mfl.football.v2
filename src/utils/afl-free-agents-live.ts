/**
 * Live roster overlay for the AFL Free Agents page.
 *
 * The page's player pool (identity, physicals, ADP, projections) comes from
 * the build-time snapshot data/afl-fantasy/derived/free-agents.json, which
 * only refreshes on deploy — so an add/drop made on MFL after the last deploy
 * kept showing the stale roster state until the next deploy. This module
 * re-derives ONLY the roster-membership flags at request time from the live
 * MFL rosters export (small, public, ~16KB) with a short in-memory cache,
 * and falls back to the snapshot's baked flags whenever MFL is unreachable
 * or returns something implausible.
 *
 * Conference math mirrors scripts/compute-afl-free-agents.mjs (keep in
 * sync): the AFL is a duplicate-player conference league (league registry
 * `duplicatePlayers: true`), so `rostered` means "held in EVERY conference"
 * and `confs` lists the conferences currently holding the player. A player
 * dropped in one conference is a free agent there even while the other
 * conference still rosters him.
 */
import { getLeagueBySlug } from '../config/leagues';
import { buildMflExportUrl } from './mfl-url';

export interface FaConferenceMeta {
  ids: string[];
  names: Record<string, { name: string; abbrev: string }>;
  franchiseConferences: Record<string, string>;
}

export interface FaSnapshotPlayer {
  id: string;
  name: string;
  position: string;
  team: string;
  espnId: string | null;
  projected: number | null;
  rostered: boolean;
  confs?: string[];
  [key: string]: unknown;
}

export interface FaTopPlayer {
  id: string;
  name: string;
  position: string;
  team: string;
  espnId: string | null;
  projected: number | null;
}

export interface FaSnapshot {
  generatedForYear: number;
  conferences: FaConferenceMeta | null;
  faCounts: Record<string, number>;
  topFa: FaTopPlayer | null;
  players: FaSnapshotPlayer[];
  [key: string]: unknown;
}

export interface FaView {
  players: FaSnapshotPlayer[];
  faCounts: Record<string, number>;
  topFa: FaTopPlayer | null;
  freeAgentsCount: number;
}

interface MflRosterFranchise {
  id?: string;
  player?: { id?: string } | Array<{ id?: string }>;
}

function snapshotView(snapshot: FaSnapshot): FaView {
  return {
    players: snapshot.players,
    faCounts: snapshot.faCounts,
    topFa: snapshot.topFa,
    freeAgentsCount: snapshot.faCounts.ALL ?? 0,
  };
}

/**
 * Recompute rostered/confs flags (and the derived FA counts + hero spotlight)
 * from a live MFL rosters payload. Pure — never mutates the snapshot (it's an
 * imported JSON module shared across SSR requests). Returns the snapshot's
 * baked view untouched when the payload is missing, malformed, empty, or
 * references a franchise the snapshot's conference map doesn't know.
 */
export function applyLiveRosters(snapshot: FaSnapshot, rostersJson: unknown): FaView {
  const franchisesRaw = (rostersJson as { rosters?: { franchise?: unknown } } | null)?.rosters
    ?.franchise;
  if (!franchisesRaw) return snapshotView(snapshot);
  const franchises = (
    Array.isArray(franchisesRaw) ? franchisesRaw : [franchisesRaw]
  ) as MflRosterFranchise[];

  const confIds = snapshot.conferences?.ids?.length ? snapshot.conferences.ids : [''];
  const franchiseConfs = snapshot.conferences?.franchiseConferences ?? {};
  const rosteredByConf = new Map<string, Set<string>>(confIds.map((id) => [id, new Set()]));

  for (const franchise of franchises) {
    const confId = confIds.length > 1 ? franchiseConfs[franchise?.id ?? ''] : confIds[0];
    const confSet = confId != null ? rosteredByConf.get(confId) : undefined;
    // A franchise the baked conference map can't place (league restructured
    // since the last deploy) → don't guess, keep the baked flags.
    if (!confSet) return snapshotView(snapshot);
    const rosterPlayers = franchise?.player
      ? Array.isArray(franchise.player)
        ? franchise.player
        : [franchise.player]
      : [];
    for (const p of rosterPlayers) {
      if (p?.id) confSet.add(String(p.id));
    }
  }

  // An all-empty rosters payload is far more likely an MFL hiccup than a
  // league-wide purge — keep the baked flags rather than marking everyone FA.
  let totalRostered = 0;
  for (const confSet of rosteredByConf.values()) totalRostered += confSet.size;
  if (totalRostered === 0) return snapshotView(snapshot);

  const players = snapshot.players.map((p) => {
    const confs = confIds.filter((cid) => rosteredByConf.get(cid)!.has(p.id));
    return { ...p, confs, rostered: confs.length === confIds.length };
  });

  // Snapshot players are already in default-sort order, so the first
  // available player is the hero spotlight (mirrors the compute script).
  const freeAgents = players.filter((p) => !p.rostered);
  const faCounts: Record<string, number> = { ALL: freeAgents.length };
  for (const p of freeAgents) faCounts[p.position] = (faCounts[p.position] || 0) + 1;
  const top = freeAgents[0] ?? null;
  const topFa: FaTopPlayer | null = top
    ? {
        id: top.id,
        name: top.name,
        position: top.position,
        team: top.team,
        espnId: top.espnId,
        projected: top.projected,
      }
    : null;

  return { players, faCounts, topFa, freeAgentsCount: freeAgents.length };
}

// Module-level cache: one MFL fetch per warm serverless instance per minute,
// so page traffic never hammers MFL. Failures are cached briefly too, so an
// MFL outage doesn't add a 5s timeout to every request.
const LIVE_TTL_MS = 60_000;
const ERROR_TTL_MS = 20_000;
let rostersCache: { at: number; ok: boolean; data: unknown } | null = null;

/**
 * Fetch the AFL's live rosters export from MFL (public read, no auth), cached
 * in memory for 60s. Returns null on any failure — callers fall back to the
 * snapshot's baked roster flags via applyLiveRosters.
 */
export async function fetchLiveAflRosters(year: number | string): Promise<unknown | null> {
  const now = Date.now();
  if (rostersCache && now - rostersCache.at < (rostersCache.ok ? LIVE_TTL_MS : ERROR_TTL_MS)) {
    return rostersCache.data;
  }
  const afl = getLeagueBySlug('afl-fantasy')!;
  const url = buildMflExportUrl({ type: 'rosters', leagueId: afl.id, year });
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`MFL rosters HTTP ${res.status}`);
    const data = await res.json();
    // MFL answers 200 with an {error} body for a bad league/year.
    if (!(data as { rosters?: { franchise?: unknown } })?.rosters?.franchise) {
      throw new Error('MFL rosters payload missing rosters.franchise');
    }
    rostersCache = { at: now, ok: true, data };
    return data;
  } catch {
    rostersCache = { at: now, ok: false, data: null };
    return null;
  }
}
