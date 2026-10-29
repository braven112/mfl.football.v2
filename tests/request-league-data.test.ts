import { afterEach, describe, expect, it } from 'vitest';
import {
  __setLeagueDataManifestForTests,
  hasLeagueData,
  isLeagueDataLoaded,
  leagueFeedPath,
} from '../src/utils/league-data';
import { hotIdentityYears, preloadRequestLeagueData } from '../src/utils/request-league-data';
import { clearPlayerMapCache, getPlayerMap, playerIdentityPaths, preloadPlayerIdentity } from '../src/utils/player-map';
import { getLeagueBySlug } from '../src/config/leagues';
import { getCurrentLeagueYear, getCurrentSeasonYear } from '../src/utils/league-year';

/**
 * The SYNC helpers called site-wide (player-map's getPlayerMap / getPlayer /
 * getGlobalPlayerMap, the bye calendar) read league data that lives in Vercel
 * Blob in production. src/middleware.ts preloads their hot set on every
 * request (src/utils/request-league-data.ts); these pin that the preload
 * covers what they read, that a preloaded read is served from the loader's
 * memory rather than the disk, and that a year nobody preloaded degrades
 * instead of throwing.
 */
const theleague = getLeagueBySlug('theleague')!;

afterEach(() => {
  __setLeagueDataManifestForTests(undefined);
  clearPlayerMapCache();
});

describe('preloadRequestLeagueData', () => {
  it('loads the identity files for the current league and season years, and the bye calendar', async () => {
    __setLeagueDataManifestForTests(null);
    await preloadRequestLeagueData();
    for (const year of hotIdentityYears()) {
      const path = leagueFeedPath(theleague.dataPath, year, 'players.json');
      // A year whose feed is not committed yet (rollover day) is simply absent.
      if (hasLeagueData(path)) expect(isLeagueDataLoaded(path), path).toBe(true);
    }
    expect(isLeagueDataLoaded(`${theleague.dataPath}/derived/player-identity-union.json`)).toBe(true);
    expect(isLeagueDataLoaded('data/nfl/bye-weeks.json')).toBe(true);
  });

  it('covers both clocks, and a ?testDate= one too', () => {
    expect(hotIdentityYears()).toEqual(
      expect.arrayContaining([getCurrentLeagueYear(), getCurrentSeasonYear()]),
    );
    const testDate = new Date('2019-10-01T12:00:00-07:00');
    expect(hotIdentityYears(undefined, testDate)).toEqual(expect.arrayContaining([2019]));
  });

  it('never throws, even when the store is unreachable', async () => {
    __setLeagueDataManifestForTests({ base: 'https://store.invalid/', files: { 'data/nfl/bye-weeks.json': 'f'.repeat(32) } });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    try {
      await expect(preloadRequestLeagueData()).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('getPlayerMap on the preloaded path', () => {
  it('builds the map from what the STORE served, not from disk', async () => {
    const year = 2099; // no such feed on disk: only the store can answer
    const feed = {
      players: { player: [{ id: '13116', name: 'Mahomes, Patrick', position: 'QB', team: 'KCC', espn_id: '3139477' }] },
    };
    const files: Record<string, unknown> = {
      [leagueFeedPath(theleague.dataPath, year, 'players.json')]: feed,
      [`${theleague.dataPath}/espn-college-ids.json`]: { players: {} },
      [`${theleague.dataPath}/derived/espn-nfl-id-backfill.json`]: { ids: {} },
    };
    const hashes = Object.fromEntries(Object.keys(files).map((p, i) => [p, String(i).repeat(32)]));
    const byHash = Object.fromEntries(Object.entries(hashes).map(([p, h]) => [h, files[p]]));
    __setLeagueDataManifestForTests({ base: 'https://store.example/', files: hashes });

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      const hash = String(url).match(/([0-9a-f]{32})\.json$/)?.[1] ?? '';
      return new Response(JSON.stringify(byHash[hash] ?? null), { status: hash in byHash ? 200 : 404 });
    }) as typeof fetch;
    try {
      expect(playerIdentityPaths([year])).toContain(leagueFeedPath(theleague.dataPath, year, 'players.json'));
      await preloadPlayerIdentity([year]);
      const map = getPlayerMap(year);
      expect(map.get('13116')).toMatchObject({ name: 'Patrick Mahomes', nflTeam: 'KC', nflEspnId: '3139477' });
      // Cached once preloaded: the same instance on the next call.
      expect(getPlayerMap(year)).toBe(map);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('an unpreloaded year with no file degrades to an empty map, and is not cached', () => {
    __setLeagueDataManifestForTests(null);
    const first = getPlayerMap(2098);
    expect(first.size).toBe(0);
    expect(getPlayerMap(2098)).not.toBe(first);
  });

  it('an unpreloaded year that IS on disk still resolves (dev, or a file still in the function)', () => {
    __setLeagueDataManifestForTests(null);
    expect(getPlayerMap(getCurrentLeagueYear()).size).toBeGreaterThan(0);
  });
});
