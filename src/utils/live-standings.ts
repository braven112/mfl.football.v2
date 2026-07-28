/**
 * Live standings refresh for the current season.
 *
 * The standings pages get their data from committed
 * `data/<league>/mfl-feeds/<year>/standings.json` snapshots baked into the
 * server bundle by `import.meta.glob` at BUILD time. That means standings only
 * refresh when the roster-sync bot commits and Vercel redeploys — on a Sunday
 * slate they lag hours behind the games.
 *
 * This helper fetches fresh standings server-side from the MFL export API
 * (TYPE=leagueStandings — same payload root as the committed snapshot) for the
 * CURRENT season year only, with a short in-memory TTL cache so a busy game
 * day doesn't hammer MFL, and a hard fetch timeout so a slow MFL never hangs
 * the page. On any error / timeout / malformed response it falls back to the
 * committed feed, exactly as the page rendered before. Historical years never
 * hit the network — the committed snapshot is authoritative and static.
 *
 * League id + host always come from the registry entry passed in
 * (src/config/leagues.ts) — never hardcode them here.
 */

import type { LeagueDefinition } from '../config/leagues';
import { getCurrentSeasonYear } from './league-year';
import { buildMflExportUrl } from './mfl-url';
import { fetchWithTimeout } from './fetch-with-timeout';

/** Shape of a committed standings.json snapshot (and of the live payload). */
export interface StandingsFeed {
  version?: string;
  leagueStandings?: { franchise: any[] };
  error?: unknown;
  [key: string]: unknown;
}

export interface StandingsFeedResult {
  /** The feed to render (live when fresh data arrived, committed otherwise). */
  feed: StandingsFeed | undefined;
  /** True when `feed` came from a live MFL fetch (possibly TTL-cached). */
  live: boolean;
  /** When the live data was fetched; null when serving the committed feed. */
  fetchedAt: Date | null;
}

/** Serve a cached live payload for this long before refetching. */
const TTL_MS = 60_000;
/** After a failed fetch, don't retry (serve committed) for this long. */
const FAILURE_COOLDOWN_MS = 30_000;
/** Hard cap on the upstream MFL request. */
const FETCH_TIMEOUT_MS = 5_000;

interface CacheEntry {
  feed: StandingsFeed;
  fetchedAtMs: number;
}

// Module-level caches — per serverless instance, which is exactly the scope
// we want: a warm lambda serves repeat page views without refetching.
const liveCache = new Map<string, CacheEntry>();
const failureAtMs = new Map<string, number>();

/**
 * Resolve the standings feed for a league + year: live MFL data for the
 * current season (60s TTL, 5s timeout), the committed snapshot for everything
 * else and for every failure mode.
 */
export async function getStandingsFeedWithLiveRefresh(options: {
  league: LeagueDefinition;
  year: number;
  committedFeed: StandingsFeed | undefined;
  /** Injectable clock for tests. */
  now?: () => number;
}): Promise<StandingsFeedResult> {
  const { league, year, committedFeed, now = Date.now } = options;
  const fallback: StandingsFeedResult = { feed: committedFeed, live: false, fetchedAt: null };

  // Historical (and future) years keep using the committed feeds untouched.
  if (year !== getCurrentSeasonYear()) {
    return fallback;
  }

  const key = `${league.id}:${year}`;
  const nowMs = now();

  const cached = liveCache.get(key);
  if (cached && nowMs - cached.fetchedAtMs < TTL_MS) {
    return { feed: cached.feed, live: true, fetchedAt: new Date(cached.fetchedAtMs) };
  }

  const lastFailure = failureAtMs.get(key);
  if (lastFailure !== undefined && nowMs - lastFailure < FAILURE_COOLDOWN_MS) {
    return fallback;
  }

  try {
    const url = buildMflExportUrl({
      type: 'leagueStandings',
      leagueId: league.id,
      year,
      host: `https://${league.mflHost}`,
    });
    const response = await fetchWithTimeout(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' },
    });
    if (!response.ok) {
      throw new Error(`MFL leagueStandings responded ${response.status}`);
    }

    const data = (await response.json()) as StandingsFeed | null;
    // MFL reports errors as HTTP 200 with an `error` payload.
    if (!data || data.error) {
      throw new Error('MFL leagueStandings returned an error payload');
    }
    const rawFranchise = (data as any)?.leagueStandings?.franchise;
    // MFL collapses single-element collections to a bare object — normalize to
    // an array so the shape matches the committed snapshot exactly.
    const franchise = Array.isArray(rawFranchise)
      ? rawFranchise
      : rawFranchise
        ? [rawFranchise]
        : [];
    if (franchise.length === 0) {
      throw new Error('MFL leagueStandings response has no franchise list');
    }

    const feed: StandingsFeed = {
      ...data,
      leagueStandings: { ...(data as any).leagueStandings, franchise },
    };
    liveCache.set(key, { feed, fetchedAtMs: nowMs });
    failureAtMs.delete(key);
    return { feed, live: true, fetchedAt: new Date(nowMs) };
  } catch (err) {
    failureAtMs.set(key, nowMs);
    console.error(
      `[live-standings] live fetch failed for ${league.slug} ${year}; serving committed feed:`,
      err instanceof Error ? err.message : err
    );
    return fallback;
  }
}

/** Test hook: clear the module-level caches between cases. */
export function __resetLiveStandingsCacheForTests(): void {
  liveCache.clear();
  failureAtMs.clear();
}
