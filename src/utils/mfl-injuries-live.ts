/**
 * The live injury report — server-only, so the client bundle that imports
 * mfl-injuries.ts for its badge helpers never pulls in the Redis client.
 *
 * The roster sync no longer commits injuries.json on every run (one snapshot a
 * day; see scripts/lib/held-sync-files.mjs). It publishes the current report
 * to Redis on every run instead, so every reader that wants today's report —
 * the pages' badges and the lineup warnings alike — reads it through here:
 * Redis's copy when it is at least as fresh as the copy on disk, else disk.
 *
 * Pages use loadLiveInjuryMap (./mfl-injuries-live-map.ts). It lives apart
 * because it needs the globbed bundle in mfl-injuries.ts, and this module is
 * reached from the homepages' story graph (via my-team-week.ts), which must
 * not import cron-written feeds (a snapshot must never read live data).
 */
import { getRedis } from './redis-client';

/** Redis key the roster sync publishes each league's injury report to (scripts/lib/held-sync-files.mjs). */
export const liveInjuriesKey = (slug: string) => `mfl:injuries:${slug}`;

/** How long one instance reuses a Redis read before asking again. */
export const LIVE_INJURIES_TTL_MS = 60_000;

/** The injuries.json shape, as the sync writes it and publishes it. */
export interface InjuryFeed {
  year?: unknown;
  generatedAt?: unknown;
  injuries?: unknown;
}

const liveMemo = new Map<string, { at: number; value: InjuryFeed | null }>();

/** Test hook: forget memoized live reads. */
export function resetLiveInjuryMemo(): void {
  liveMemo.clear();
}

type InjuryRedis = { get: <T = unknown>(key: string) => Promise<T | null> };
export type GetClient = () => Promise<InjuryRedis | null>;

export async function defaultRedis(): Promise<InjuryRedis | null> {
  return getRedis();
}

/** The published report, or null (no Redis, no key, a broken read, a malformed value). Memoized per slug. */
export async function readLiveFeed(slug: string, getClient: GetClient, nowMs: number): Promise<InjuryFeed | null> {
  const memo = liveMemo.get(slug);
  if (memo && nowMs - memo.at < LIVE_INJURIES_TTL_MS) return memo.value;

  let value: InjuryFeed | null = null;
  try {
    const redis = await getClient();
    const raw = redis ? await redis.get<unknown>(liveInjuriesKey(slug)) : null;
    const live = (typeof raw === 'string' ? JSON.parse(raw) : raw) as InjuryFeed | null;
    if (live && live.injuries && typeof live.injuries === 'object') value = live;
  } catch (err) {
    console.warn(`[mfl-injuries] live read failed for ${slug}; using the copy on disk:`, err);
  }
  liveMemo.set(slug, { at: nowMs, value });
  return value;
}

const stampMs = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : NaN);

/**
 * Whether the live report should replace `base` (the copy on disk): a newer
 * year, or the same year with a `generatedAt` no older than the base's. A year
 * match alone is not freshness — a sync whose publish failed commits a report
 * newer than the one Redis still holds — so a live copy without a stamp loses
 * to a stamped base.
 */
export function liveIsFresher(live: InjuryFeed, base: { year: number; generatedAt?: unknown }): boolean {
  const year = Number(live.year);
  if (!Number.isFinite(year) || year < base.year) return false;
  if (year > base.year) return true;
  const baseMs = stampMs(base.generatedAt);
  if (!Number.isFinite(baseMs)) return true;
  const liveMs = stampMs(live.generatedAt);
  return Number.isFinite(liveMs) && liveMs >= baseMs;
}

/**
 * For readers that load a year's injuries.json from disk (the lineup warnings,
 * the app badge): the live report in place of `diskFeed` when it is for that
 * same year and at least as fresh, else `diskFeed` unchanged (null included).
 */
export async function loadLiveInjuryFeed(
  slug: string,
  year: number,
  diskFeed: InjuryFeed | null,
  getClient: GetClient = defaultRedis,
  nowMs: number = Date.now(),
): Promise<InjuryFeed | null> {
  const live = await readLiveFeed(slug, getClient, nowMs);
  if (!live || Number(live.year) !== year) return diskFeed;
  return liveIsFresher(live, { year, generatedAt: diskFeed?.generatedAt }) ? live : diskFeed;
}
