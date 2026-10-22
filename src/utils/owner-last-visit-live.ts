/**
 * The live MFL last-visit map, for the Activity pages.
 *
 * The owner-activity sync no longer commits owner-last-visit.json on every run
 * (one snapshot a day; see scripts/lib/held-sync-files.mjs). It publishes each
 * league's file to Redis on every run instead, so the page reads it through
 * here: Redis's copy when it is at least as fresh as the copy on disk, else
 * disk. With no Redis, a missing key or a broken read, the disk copy stands.
 */
import { getRedis } from './redis-client';

/** Redis key the sync publishes to (`lastVisitKey` in scripts/lib/held-sync-files.mjs). */
export const liveLastVisitKey = (slug: string) => `mfl:owner-last-visit:${slug}`;

/** The owner-last-visit.json shape, as the sync writes and publishes it. */
export interface LastVisitFeed {
  generatedAt?: unknown;
  lastVisit?: unknown;
}

type LastVisitRedis = { get: <T = unknown>(key: string) => Promise<T | null> };
export type GetClient = () => Promise<LastVisitRedis | null>;

const stampMs = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : NaN);

/**
 * Whether `live` should replace `disk`: a stamped live copy no older than the
 * disk copy's stamp. A live copy without a stamp never wins over a stamped one,
 * since a sync whose publish failed commits a file newer than Redis's.
 */
export function liveIsFresher(live: LastVisitFeed, disk: LastVisitFeed | null): boolean {
  const liveMs = stampMs(live.generatedAt);
  if (!Number.isFinite(liveMs)) return !disk;
  const diskMs = stampMs(disk?.generatedAt);
  return !Number.isFinite(diskMs) || liveMs >= diskMs;
}

/** The fresher of Redis's copy and `disk` (null included) for one league. */
export async function loadLiveLastVisit(
  slug: string,
  disk: LastVisitFeed | null,
  getClient: GetClient = getRedis,
): Promise<LastVisitFeed | null> {
  let live: LastVisitFeed | null = null;
  try {
    const redis = await getClient();
    const raw = redis ? await redis.get<unknown>(liveLastVisitKey(slug)) : null;
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as LastVisitFeed | null;
    if (parsed && parsed.lastVisit && typeof parsed.lastVisit === 'object') live = parsed;
  } catch (err) {
    console.warn(`[owner-last-visit] live read failed for ${slug}; using the copy on disk:`, err);
  }
  return live && liveIsFresher(live, disk) ? live : disk;
}
