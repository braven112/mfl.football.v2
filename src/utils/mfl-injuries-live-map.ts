/**
 * The injury map for pages — server-only. Split from mfl-injuries.ts, whose
 * badge helpers also run in client scripts, because this half reads league
 * data: the committed injuries.json through the league-data loader, and the
 * roster sync's live Redis copy (mfl-injuries-live.ts).
 *
 * The committed feed is read through the loader, never a glob: the roster
 * sync publishes it without a build. It is keyed by the NEWEST year present,
 * not the page's year — see mfl-injuries.ts for why.
 */
import { getLeagueBySlug } from '../config/leagues';
import { listLeagueData, loadLeagueData } from './league-data';
import type { InjuryMap } from './mfl-injuries';
import { defaultRedis, liveIsFresher, readLiveFeed, type GetClient } from './mfl-injuries-live';

/**
 * The committed feed's newest year, its map and when the sync wrote it
 * ({ year: -1, injuries: {} } when there is none). Total: an unknown slug, a
 * missing feed or a malformed payload all yield an empty map.
 */
export async function newestCommittedInjuries(
  slug: string,
): Promise<{ year: number; generatedAt?: string; injuries: InjuryMap }> {
  const dataPath = getLeagueBySlug(slug)?.dataPath;
  if (!dataPath) return { year: -1, injuries: {} };

  // Newest first; the first year carrying a usable map wins.
  const paths = listLeagueData(`${dataPath}/mfl-feeds/*/injuries.json`)
    .map((path) => ({ path, year: Number(path.match(/mfl-feeds\/(\d{4})\//)?.[1] ?? -1) }))
    .sort((a, b) => b.year - a.year);
  for (const { path, year } of paths) {
    const data = await loadLeagueData<{ injuries?: unknown; generatedAt?: unknown }>(path).catch(() => null);
    const injuries = data?.injuries;
    if (!injuries || typeof injuries !== 'object') continue;
    const stamp = data?.generatedAt;
    return { year, generatedAt: typeof stamp === 'string' ? stamp : undefined, injuries: injuries as InjuryMap };
  }
  return { year: -1, injuries: {} };
}

/** The committed feed's map alone. */
export async function loadCommittedInjuryMap(slug: string): Promise<InjuryMap> {
  return (await newestCommittedInjuries(slug)).injuries;
}

/**
 * The injury map a page should render: the live report when it is at least as
 * fresh as the committed feed, else the committed feed. A missing key, an
 * unreachable Redis or a malformed value all fall back to the committed map.
 */
export async function loadLiveInjuryMap(
  slug: string,
  getClient: GetClient = defaultRedis,
  nowMs: number = Date.now(),
): Promise<InjuryMap> {
  const [committed, live] = await Promise.all([newestCommittedInjuries(slug), readLiveFeed(slug, getClient, nowMs)]);
  return live && liveIsFresher(live, committed) ? (live.injuries as InjuryMap) : committed.injuries;
}
