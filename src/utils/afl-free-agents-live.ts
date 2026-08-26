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
import { fetchWithTimeout } from './fetch-with-timeout';
import { buildRosteredByConf, confsForPlayer, ownersForPlayer } from './afl-conference-rosters.mjs';

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
  /** `{ [conferenceId]: franchiseId }` for the conferences holding him. */
  owners?: Record<string, string>;
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
  /** Franchise count in the rosters feed at bake time (partial-payload guard). */
  rosterFranchiseCount?: number;
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

// Roster sets already computed by the fetch layer's cache-promotion
// validation, so the first applyLiveRosters call on a fresh payload doesn't
// repeat the 24-franchise walk. Keyed by payload identity; the validation
// inputs are stored so a mismatched caller recomputes instead of reusing.
type RosterSets = ReturnType<typeof buildRosteredByConf>;
const validatedSets = new WeakMap<
  object,
  { conferences: FaConferenceMeta | null; count: number | undefined; sets: RosterSets }
>();

function rosterSetsFor(
  rostersJson: unknown,
  conferences: FaConferenceMeta | null,
  count: number | undefined,
): RosterSets {
  if (rostersJson && typeof rostersJson === 'object') {
    const hit = validatedSets.get(rostersJson);
    if (hit && hit.conferences === conferences && hit.count === count) return hit.sets;
    const sets = buildRosteredByConf(rostersJson, conferences, count);
    validatedSets.set(rostersJson, { conferences, count, sets });
    return sets;
  }
  return buildRosteredByConf(rostersJson, conferences, count);
}

/**
 * Recompute rostered/confs flags (and the derived FA counts + hero spotlight)
 * from a live MFL rosters payload. Pure — never mutates the snapshot (it's an
 * imported JSON module shared across SSR requests). Returns the snapshot's
 * baked view untouched when buildRosteredByConf rejects the payload (missing,
 * malformed, empty, partial, or referencing a franchise the snapshot's
 * conference map doesn't know).
 */
// Shared derivation for "here are the free agents → counts + hero spotlight"
// — used by the league-wide view and every conference-scoped view so the two
// can't drift. Input must already be in default-sort order (snapshot players
// are; see the compute script).
function deriveFaStats(freeAgents: FaSnapshotPlayer[]): {
  faCounts: Record<string, number>;
  topFa: FaTopPlayer | null;
  freeAgentsCount: number;
} {
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
  return { faCounts, topFa, freeAgentsCount: freeAgents.length };
}

export function applyLiveRosters(snapshot: FaSnapshot, rostersJson: unknown): FaView {
  if (memo && memo.snapshot === snapshot && memo.rostersJson === rostersJson) return memo.view;

  const rosterSets = rosterSetsFor(rostersJson, snapshot.conferences, snapshot.rosterFranchiseCount);
  if (!rosterSets) return snapshotView(snapshot);
  const confCount: number = rosterSets.confIds.length;

  const players = snapshot.players.map((p) => {
    const confs: string[] = confsForPlayer(p.id, rosterSets);
    // Owners are re-derived here rather than carried over from the snapshot:
    // the whole point of the overlay is that the baked flags are stale, and a
    // player traded since the last deploy would otherwise be named under his
    // previous team while the row correctly shows him rostered.
    const owners: Record<string, string> = ownersForPlayer(p.id, rosterSets);
    return { ...p, confs, owners, rostered: confs.length === confCount };
  });

  const view: FaView = { players, ...deriveFaStats(players.filter((p) => !p.rostered)) };
  memo = { snapshot, rostersJson, view };
  return view;
}

/**
 * Re-scope a view to ONE conference: "free agent" means not rostered in that
 * conference, regardless of what the other conference holds. This is the
 * per-conference boundary the page renders — an AL owner browsing free
 * agents should only see (and count) players an AL team can actually add.
 * Players are NOT filtered here (the client needs the full pool for its
 * "include rostered" toggle); only the derived counts/spotlight are scoped.
 * Pass a null confId (single shared pool) for league-wide numbers.
 *
 * `includeRookies` must mirror the page's default client filter state — the
 * SSR-rendered counts/spotlight must match what the client's first render
 * computes, or the numbers visibly pop on hydration. The AFL page defaults to
 * rookies INCLUDED (its "Include rookies" checkbox starts checked), so it
 * passes true.
 */
export function conferenceScopedView(
  view: FaView,
  confId: string | null,
  { includeRookies = true }: { includeRookies?: boolean } = {},
): { faCounts: Record<string, number>; topFa: FaTopPlayer | null; freeAgentsCount: number } {
  const isFree = confId
    ? (p: FaSnapshotPlayer) => !(p.confs ?? []).includes(confId)
    : (p: FaSnapshotPlayer) => !p.rostered;
  return deriveFaStats(
    view.players.filter((p) => isFree(p) && (includeRookies || !(p as { rookie?: boolean }).rookie)),
  );
}

/**
 * Resolve which conference the page opens on, and which one is the viewer's
 * own. Precedence: a valid ?conf= request (conference id or abbrev,
 * case-insensitive — shareable links) → the signed-in owner's conference
 * (session must belong to this league; franchise must be an OWN property of
 * the map — a JSON-imported object still has Object.prototype, so a hostile
 * franchiseId like "constructor" must not resolve) → the first conference.
 * Single-pool leagues (null meta) resolve to null/null.
 */
export function resolveConferenceSelection(
  conferenceMeta: FaConferenceMeta | null,
  authUser: { franchiseId: string; leagueId: string } | null,
  aflLeagueId: string,
  requestedConf?: string | null,
): { userConfId: string | null; activeConfId: string | null } {
  if (!conferenceMeta) return { userConfId: null, activeConfId: null };

  let userConfId: string | null = null;
  if (
    authUser?.leagueId === aflLeagueId &&
    Object.hasOwn(conferenceMeta.franchiseConferences, authUser.franchiseId)
  ) {
    const conf = conferenceMeta.franchiseConferences[authUser.franchiseId];
    if (typeof conf === 'string') userConfId = conf;
  }

  if (requestedConf) {
    const want = String(requestedConf).toLowerCase();
    const match = conferenceMeta.ids.find(
      (id) =>
        id.toLowerCase() === want ||
        (conferenceMeta.names[id]?.abbrev || '').toLowerCase() === want,
    );
    if (match) return { userConfId, activeConfId: match };
  }

  return { userConfId, activeConfId: userConfId ?? conferenceMeta.ids[0] };
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

/** Snapshot fields the fetch layer uses to validate a payload before caching it. */
export type FaFetchValidation = Pick<FaSnapshot, 'conferences' | 'rosterFranchiseCount'>;

async function doFetchRosters(year: string, validation?: FaFetchValidation): Promise<unknown | null> {
  const prior = rostersCache;
  const afl = getLeagueBySlug('afl-fantasy')!;
  const url = buildMflExportUrl({ type: 'rosters', leagueId: afl.id, year });
  try {
    const res = await fetchWithTimeout(url, { timeoutMs: 5000 });
    if (!res.ok) throw new Error(`MFL rosters HTTP ${res.status}`);
    const data = await res.json();
    // Shape-valid junk must not evict the last-known-good payload, so a
    // payload has to pass the SAME plausibility bar the overlay applies
    // (missing/{error} body, partial, unmapped franchise, zero rostered)
    // before it is promoted into the cache as good. The computed sets are
    // reused by applyLiveRosters via rosterSetsFor's WeakMap.
    if (!rosterSetsFor(data, validation?.conferences ?? null, validation?.rosterFranchiseCount)) {
      throw new Error('MFL rosters payload failed plausibility validation');
    }
    rostersCache = { at: Date.now(), ok: true, year, data };
    return data;
  } catch (err) {
    // Loud enough to spot in Vercel logs if MFL persistently rejects the
    // request (e.g. the league stops answering unauthenticated reads) —
    // otherwise the page silently degrades to deploy-time flags forever.
    console.warn('[afl-free-agents-live] MFL rosters fetch failed — serving last-good/baked flags:', err);
    // Keep serving the last-known-good payload for this year during a blip
    // (a minute-old roster beats oscillating back to deploy-time flags);
    // the shorter error TTL retries soon. Chained off prior.data — not
    // prior.ok — so the payload survives consecutive failures across error
    // windows for the whole outage.
    const lastGood = prior && prior.year === year && prior.data != null ? prior.data : null;
    rostersCache = { at: Date.now(), ok: false, year, data: lastGood };
    return lastGood;
  }
}

/**
 * Fetch the AFL's live rosters export from MFL (public read, no auth), cached
 * in memory for 60s. Pass the snapshot (or its conferences +
 * rosterFranchiseCount) so the payload is validated to the overlay's
 * plausibility bar before being cached. Returns null on any failure —
 * callers fall back to the snapshot's baked roster flags via
 * applyLiveRosters.
 */
export async function fetchLiveAflRosters(
  year: number | string,
  validation?: FaFetchValidation,
): Promise<unknown | null> {
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
  const promise = doFetchRosters(yearKey, validation).finally(() => {
    if (inflight?.promise === promise) inflight = null;
  });
  inflight = { year: yearKey, promise };
  return promise;
}
