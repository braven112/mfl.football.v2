/**
 * MFL Recent-Transactions Cache — Redis, 2-minute TTL
 *
 * Contract declaration windows are SHORT — 24 hours in season, 48 in the
 * offseason — and eligibility for one is derived entirely from the
 * transaction that acquired the player. But the committed transactions feed
 * (`data/<league>/mfl-feeds/<year>/transactions.json`) is written by the
 * roster-sync cron and read through `import.meta.glob`, i.e. BUNDLED AT BUILD
 * TIME: a page cannot see an acquisition until that cron has committed AND a
 * deploy has shipped. GitHub throttles that five-minute cron to a run every few
 * hours in practice, so a waiver claim processed at 02:00 stayed invisible to
 * eligibility for hours out of the 24 it had.
 *
 * Rosters already solved exactly this (`mfl-roster-cache.ts`); this is the
 * same shape for transactions. It is scoped with MFL's `DAYS` filter because
 * eligibility only ever reads recent acquisitions — the whole payload is a
 * handful of rows — and it MERGES over the static feed rather than replacing
 * it, so a consumer that wants older history still has it.
 *
 * Returns null when Redis is unavailable or the fetch fails, so every caller
 * keeps working off the static feed alone.
 *
 * Redis key: mfl:transactions-recent:{leagueId}:{season}
 */

import { getRedis } from './redis-client';
import { buildMflExportUrl } from './mfl-url';
import type { MFLRawTransaction } from '../types/contract-eligibility';

const STALE_TTL_MS = 2 * 60 * 1000; // 2 minutes, matching the roster cache

/**
 * How far back to ask MFL for. The longest declaration window is 48 hours
 * (offseason), so 3 days covers it with a full day of margin for clock skew
 * and for a deadline an owner is reading right as it expires.
 */
export const RECENT_TRANSACTION_DAYS = 3;

function cacheKey(leagueId: string, season: string): string {
  return `mfl:transactions-recent:${leagueId}:${season}`;
}

interface CachedTransactionsPayload {
  transactions: MFLRawTransaction[];
  /** When this data was fetched from MFL (epoch ms) */
  fetchedAt: number;
}

/** Identity of a transaction row, for de-duplicating the live and static lists. */
function rowKey(row: MFLRawTransaction): string {
  return [row.type, row.franchise, row.timestamp, row.transaction ?? ''].join('|');
}

/**
 * Merge live transaction rows over the static feed.
 *
 * Newest first, because `findAcquisitionTransaction` returns the FIRST match
 * it walks past and therefore depends on that order to find a player's most
 * recent acquisition. MFL's own array order is not guaranteed, so this sorts
 * rather than trusting it.
 *
 * Live rows win on a tie: same key means the same row, and the live copy is
 * the one MFL is serving right now.
 */
export function mergeTransactionRows(
  staticRows: MFLRawTransaction[] | null | undefined,
  liveRows: MFLRawTransaction[] | null | undefined,
): MFLRawTransaction[] {
  const merged = new Map<string, MFLRawTransaction>();
  for (const row of staticRows ?? []) {
    if (row) merged.set(rowKey(row), row);
  }
  for (const row of liveRows ?? []) {
    if (row) merged.set(rowKey(row), row);
  }
  return [...merged.values()].sort(
    (a, b) => (parseInt(b.timestamp, 10) || 0) - (parseInt(a.timestamp, 10) || 0),
  );
}

/** In-process guard against duplicate concurrent fetches for the same key. */
const refreshing = new Map<string, Promise<MFLRawTransaction[] | null>>();

/**
 * Get the last `RECENT_TRANSACTION_DAYS` of transactions from Redis, fetching
 * synchronously from MFL when the cache is missing or older than 2 minutes.
 *
 * The refresh is awaited inline rather than backgrounded: Vercel terminates
 * the function once the response is sent, so fire-and-forget never completes
 * (same reasoning as mfl-roster-cache.ts).
 *
 * Returns null when Redis is unavailable — callers fall back to the static
 * feed, which is stale but never wrong.
 */
export async function getCachedRecentTransactions(
  season: string,
  leagueId: string,
): Promise<MFLRawTransaction[] | null> {
  const redis = await getRedis();
  if (!redis) return null;

  try {
    const key = cacheKey(leagueId, season);
    const cached = await redis.get<CachedTransactionsPayload>(key);

    if (!Array.isArray(cached?.transactions)) {
      return await deduplicatedFetch(season, leagueId);
    }

    // Written as !(fresh) so a missing or corrupt fetchedAt (age NaN)
    // refreshes instead of being served as fresh until the hard expiry.
    const age = Date.now() - cached.fetchedAt;
    if (!(age <= STALE_TTL_MS)) {
      const fresh = await deduplicatedFetch(season, leagueId);
      return fresh ?? cached.transactions;
    }

    return cached.transactions;
  } catch (error) {
    console.warn('[mfl-transactions-cache] Redis read failed:', error);
    return null;
  }
}

async function deduplicatedFetch(
  season: string,
  leagueId: string,
): Promise<MFLRawTransaction[] | null> {
  const key = cacheKey(leagueId, season);
  const existing = refreshing.get(key);
  if (existing) return existing;

  const promise = fetchAndCacheTransactions(season, leagueId)
    .catch((err) => {
      console.warn('[mfl-transactions-cache] Fetch failed:', err);
      return null;
    })
    .finally(() => refreshing.delete(key));

  refreshing.set(key, promise);
  return promise;
}

async function fetchAndCacheTransactions(
  season: string,
  leagueId: string,
): Promise<MFLRawTransaction[]> {
  const url = buildMflExportUrl({
    type: 'transactions',
    leagueId,
    year: season,
    params: { DAYS: RECENT_TRANSACTION_DAYS },
  });
  const response = await fetch(url, {
    headers: { 'User-Agent': 'MFLFootball/2.0' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`MFL transactions API returned ${response.status}`);
  }

  const data = await response.json();

  // res.ok is NOT "the call worked". MFL answers an error with HTTP 200 and an
  // `error` body ({"error": "An error has occurred …"}, sometimes {$t}), so a
  // status check alone reads a throttle or a bad parameter as a quiet three
  // days. Throwing here is what makes the caller keep serving the last good
  // list instead of caching [] over it for the whole TTL — "nothing happened"
  // and "couldn't read it" must not merge.
  const mflError = data?.error;
  if (mflError) {
    const detail = typeof mflError === 'string' ? mflError : mflError?.$t ?? 'unknown error';
    throw new Error(`MFL transactions export returned an error body: ${detail}`);
  }
  // Same reason: a response with no `transactions` key at all is unreadable,
  // not empty. Only a present-but-rowless one is a genuinely quiet stretch.
  if (!data || typeof data.transactions !== 'object' || data.transactions === null) {
    throw new Error('Unexpected MFL transactions response shape');
  }

  // MFL collapses a single-row response to an object rather than a 1-element
  // array, and omits the key entirely when nothing happened.
  const raw = data.transactions.transaction;
  const transactions: MFLRawTransaction[] = raw === undefined || raw === null || raw === ''
    ? []
    : Array.isArray(raw) ? raw : [raw];
  if (!transactions.every((row) => row && typeof row === 'object')) {
    throw new Error('Unexpected MFL transactions response shape');
  }

  const redis = await getRedis();
  if (redis) {
    const payload: CachedTransactionsPayload = { transactions, fetchedAt: Date.now() };
    // 1-hour hard expiry as a safety net, same as the roster cache.
    await redis.set(cacheKey(leagueId, season), payload, { ex: 3600 });
  }

  return transactions;
}
