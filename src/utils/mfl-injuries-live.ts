/**
 * The live injury report — server-only, so the client bundle that imports
 * mfl-injuries.ts for its badge helpers never pulls in the Redis client.
 *
 * The roster sync no longer commits injuries.json on every run (one snapshot a
 * day; see scripts/lib/held-sync-files.mjs), so pages read the report through
 * here: Redis's copy when it is at least as new as the bundled feed, else the
 * bundled feed.
 */
import { getRedis } from './redis-client';
import { newestBundledInjuries, type InjuryMap } from './mfl-injuries';

/** Redis key the roster sync publishes each league's injury report to (scripts/lib/held-sync-files.mjs). */
export const liveInjuriesKey = (slug: string) => `mfl:injuries:${slug}`;

/** How long one instance reuses a Redis read before asking again. */
export const LIVE_INJURIES_TTL_MS = 60_000;

const liveMemo = new Map<string, { at: number; value: InjuryMap }>();

/** Test hook: forget memoized live reads. */
export function resetLiveInjuryMemo(): void {
  liveMemo.clear();
}

type InjuryRedis = { get: <T = unknown>(key: string) => Promise<T | null> };

/**
 * The injury map a page should render: the roster sync's live copy in Redis
 * when it is at least as new as the bundled feed, else the bundled feed.
 *
 * The sync no longer commits injuries.json on every run (only one snapshot a
 * day), so the bundled copy can be up to a day old; Redis carries the latest
 * report. Same totality as loadInjuryMap: a missing key, an unreachable Redis
 * or a malformed value all fall back to the bundled map.
 */
export async function loadLiveInjuryMap(
  slug: string,
  getClient: () => Promise<InjuryRedis | null> = defaultRedis,
  nowMs: number = Date.now(),
): Promise<InjuryMap> {
  const memo = liveMemo.get(slug);
  if (memo && nowMs - memo.at < LIVE_INJURIES_TTL_MS) return memo.value;

  const bundled = newestBundledInjuries(slug);
  let value = bundled.injuries;
  try {
    const redis = await getClient();
    const raw = redis ? await redis.get<unknown>(liveInjuriesKey(slug)) : null;
    const live = (typeof raw === 'string' ? JSON.parse(raw) : raw) as
      | { year?: unknown; injuries?: unknown }
      | null;
    const year = Number(live?.year);
    if (live?.injuries && typeof live.injuries === 'object' && Number.isFinite(year) && year >= bundled.year) {
      value = live.injuries as InjuryMap;
    }
  } catch (err) {
    console.warn(`[mfl-injuries] live read failed for ${slug}; using the bundled feed:`, err);
  }
  liveMemo.set(slug, { at: nowMs, value });
  return value;
}

async function defaultRedis(): Promise<InjuryRedis | null> {
  return getRedis();
}
