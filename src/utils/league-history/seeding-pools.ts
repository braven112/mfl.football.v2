/**
 * The seeding pools (conferences) of every season a league played, for the
 * rivalry "biggest game" ranking (ask-rivalry-games.mjs): a regular-season
 * game decided a playoff spot against the line of the team's OWN pool, so the
 * AFL's two conferences are read per season from that year's MFL league feed.
 * A league with no conferences resolves to `{}` (one league-wide pool).
 *
 * Server-only: reads through the league-data loader, which caches each feed.
 */
import { listLeagueData, loadLeagueData } from '../league-data';
import { seedingPoolsFromFeeds } from './ask-rivalry-games.mjs';

export type SeedingPools = Record<number, Record<string, string>>;

const built = new Map<string, Promise<SeedingPools>>();

export function loadSeedingPools(dataPath: string): Promise<SeedingPools> {
  let p = built.get(dataPath);
  if (!p) {
    p = (async () => {
      const files = listLeagueData(`${dataPath}/mfl-feeds/*/league.json`);
      const loaded = await Promise.all(files.map(async (f) => [f.split('/').at(-2)!, await loadLeagueData<any>(f)] as const));
      const feeds: Record<string, unknown> = {};
      for (const [year, feed] of loaded) if (feed && Number.isInteger(Number(year))) feeds[year] = feed;
      return seedingPoolsFromFeeds(feeds) as SeedingPools;
    })().catch((err) => {
      built.delete(dataPath);
      throw err;
    });
    built.set(dataPath, p);
  }
  return p;
}
