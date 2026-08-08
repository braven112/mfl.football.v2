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
 * The per-conference math (AFL is a duplicate-player conference league —
 * league registry `duplicatePlayers: true` — so `rostered` means "held in
 * EVERY conference" and `confs` lists the holders) is the shared
 * implementation in afl-conference-rosters.mjs, also used by
 * scripts/compute-afl-free-agents.mjs. Don't re-implement it here.
 */
import { getLeagueBySlug } from '../config/leagues';
import { buildMflExportUrl } from './mfl-url';
import { buildRosteredByConf, confsForPlayer } from './afl-conference-rosters.mjs';

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
  confs?: string[];
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

function snapshotView(snapshot: FaSnapshot): FaView {
  return {
    players: snapshot.players,
    faCounts: snapshot.faCounts,
    topFa: snapshot.topFa,
    freeAgentsCount: snapshot.faCounts.ALL ?? 0,
  };
}

// The overlay's inputs change at most once per cache TTL (the rosters payload
// object is reused from the fetch cache), so memoize the finished view by
// input identity — steady-state requests skip the ~1000-player rebuild.
let memo: { snapshot: FaSnapshot; rostersJson: unknown; view: FaView } | null = null;

/**
 * Recompute rostered/confs flags (and the derived FA counts + hero spotlight)
 * from a live MFL rosters payload. Pure — never mutates the snapshot (it's an
 * imported JSON module shared across SSR requests). Returns the snapshot's
 * baked view untouched when buildRosteredByConf rejects the payload (missing,
 * malformed, empty, partial, or referencing a franchise the snapshot's
 * conference map doesn't know).
 */
export function applyLiveRosters(snapshot: FaSnapshot, rostersJson: unknown): FaView {
  if (memo && memo.snapshot === snapshot && memo.rostersJson === rostersJson) return memo.view;

  const rosterSets = buildRosteredByConf(rostersJson, snapshot.conferences);
  if (!rosterSets) return snapshotView(snapshot);
  const confCount: number = rosterSets.confIds.length;

  const players = snapshot.players.map((p) => {
    const confs: string[] = confsForPlayer(p.id, rosterSets);
    return { ...p, confs, rostered: confs.length === confCount };
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
        confs: top.confs,
      }
    : null;

  const view: FaView = { players, faCounts, topFa, freeAgentsCount: freeAgents.length };
  memo = { snapshot, rostersJson, view };
  return view;
}

// Module-level cache: one MFL fetch per warm serverless instance per minute,
// so page traffic never hammers MFL. Failures are cached briefly too, so an
// MFL outage doesn't add a 5s timeout to every request. Keyed by year (a
// caller passing a different year must not get the cached year's rosters),
// and concurrent cold-cache callers share one in-flight fetch.
const LIVE_TTL_MS = 60_000;
const ERROR_TTL_MS = 20_000;
let rostersCache: { at: number; ok: boolean; year: string; data: unknown } | null = null;
let inflight: { year: string; promise: Promise<unknown | null> } | null = null;

async function doFetchRosters(year: string): Promise<unknown | null> {
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
    rostersCache = { at: Date.now(), ok: true, year, data };
    return data;
  } catch (err) {
    // Loud enough to spot in Vercel logs if MFL persistently rejects the
    // request (e.g. the league stops answering unauthenticated reads) —
    // otherwise the page silently degrades to deploy-time flags forever.
    console.warn('[afl-free-agents-live] MFL rosters fetch failed — serving baked snapshot flags:', err);
    rostersCache = { at: Date.now(), ok: false, year, data: null };
    return null;
  }
}

/**
 * Fetch the AFL's live rosters export from MFL (public read, no auth), cached
 * in memory for 60s. Returns null on any failure — callers fall back to the
 * snapshot's baked roster flags via applyLiveRosters.
 */
export async function fetchLiveAflRosters(year: number | string): Promise<unknown | null> {
  const yearKey = String(year);
  const now = Date.now();
  if (
    rostersCache &&
    rostersCache.year === yearKey &&
    now - rostersCache.at < (rostersCache.ok ? LIVE_TTL_MS : ERROR_TTL_MS)
  ) {
    return rostersCache.data;
  }
  if (inflight && inflight.year === yearKey) return inflight.promise;
  const promise = doFetchRosters(yearKey).finally(() => {
    if (inflight?.promise === promise) inflight = null;
  });
  inflight = { year: yearKey, promise };
  return promise;
}
