/**
 * A Sleeper or ESPN hiccup must read as "unavailable", never as a wrong board.
 *
 * Both were review findings on the first Sleeper PR, and both fail SILENTLY:
 *  - a failed league list read as "this owner is in no Sleeper leagues", so
 *    one timeout dropped every Sleeper panel from an otherwise good board;
 *  - a failed ESPN scoreboard read as an empty slate, so every starter had
 *    zero seconds left and every live Sleeper matchup was labelled Final.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const responses = new Map<string, unknown>();
vi.mock('../src/utils/sleeper/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/utils/sleeper/client')>()),
  sleeperGet: async (path: string) => (responses.has(path) ? responses.get(path) : null),
}));
const kv = new Map<string, unknown>();
vi.mock('../src/utils/redis-client', () => ({
  getRedis: async () => ({
    get: async (k: string) => kv.get(k) ?? null,
    set: async (k: string, v: unknown) => {
      kv.set(k, JSON.parse(JSON.stringify(v)));
      return 'OK';
    },
  }),
}));

const { discoverSleeperBoardLeagues, readSleeperLive, clearSleeperLeagueCache } = await import(
  '../src/utils/sleeper/live'
);

const LINK = { userId: 'u1', username: 'brandon', displayName: 'Brandon', avatar: '', linkedAt: '' };
const LIST = '/user/u1/leagues/nfl/2026';
const roster = (league: string) => {
  responses.set(`/league/${league}/rosters`, [{ roster_id: 1, owner_id: 'u1' }]);
  responses.set(`/league/${league}/users`, [{ user_id: 'u1', display_name: 'Brandon' }]);
};

beforeEach(() => {
  responses.clear();
  kv.clear();
  clearSleeperLeagueCache();
});

describe('discovering the linked Sleeper leagues', () => {
  it('a failed league list returns the last one that succeeded', async () => {
    responses.set(LIST, [{ league_id: 'L1', name: 'Dynasty' }]);
    roster('L1');
    expect((await discoverSleeperBoardLeagues(LINK, 2026)).map((l) => l.name)).toEqual(['Dynasty']);

    responses.delete(LIST);
    expect((await discoverSleeperBoardLeagues(LINK, 2026)).map((l) => l.name)).toEqual(['Dynasty']);
    // And from Redis, on an instance that never saw the good read.
    clearSleeperLeagueCache();
    expect((await discoverSleeperBoardLeagues(LINK, 2026)).map((l) => l.name)).toEqual(['Dynasty']);
  });

  it('only a successful read removes a league', async () => {
    responses.set(LIST, [{ league_id: 'L1', name: 'Dynasty' }]);
    roster('L1');
    await discoverSleeperBoardLeagues(LINK, 2026);
    responses.set(LIST, []);
    expect(await discoverSleeperBoardLeagues(LINK, 2026)).toEqual([]);
  });

  it('a successful empty list on a first read is genuinely empty', async () => {
    responses.set(LIST, []);
    expect(await discoverSleeperBoardLeagues(LINK, 2026)).toEqual([]);
    responses.delete(LIST);
    expect(await discoverSleeperBoardLeagues(LINK, 2026)).toEqual([]);
  });
});

describe('reading Sleeper scores without a scoreboard', () => {
  it('marks every league unavailable rather than treating the week as over', async () => {
    const leagues = [{ id: 'sl-L1', name: 'Dynasty', franchiseId: '1' }] as never;
    responses.set('/league/L1/matchups/7', [{ roster_id: 1, matchup_id: 1, points: 10, starters: [] }]);
    const reads = await readSleeperLive({ leagues, week: 7, players: {}, clock: null });
    expect(reads.map((r) => r.ok)).toEqual([false]);
  });
});
