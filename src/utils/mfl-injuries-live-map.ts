/**
 * The live injury map for pages — server-only. Split from mfl-injuries-live.ts
 * because this half needs the globbed bundle (see that file's header).
 */
import { newestBundledInjuries, type InjuryMap } from './mfl-injuries';
import { defaultRedis, liveIsFresher, readLiveFeed, type GetClient } from './mfl-injuries-live';

/**
 * The injury map a page should render: the live report when it is at least as
 * fresh as the bundled feed, else the bundled feed. Same totality as
 * loadInjuryMap: a missing key, an unreachable Redis or a malformed value all
 * fall back to the bundled map.
 */
export async function loadLiveInjuryMap(
  slug: string,
  getClient: GetClient = defaultRedis,
  nowMs: number = Date.now(),
): Promise<InjuryMap> {
  const bundled = newestBundledInjuries(slug);
  const live = await readLiveFeed(slug, getClient, nowMs);
  return live && liveIsFresher(live, bundled) ? (live.injuries as InjuryMap) : bundled.injuries;
}
