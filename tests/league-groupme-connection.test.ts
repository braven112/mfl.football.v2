import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LEAGUES } from '../src/config/leagues';

/**
 * A GroupMe group an owner connected in the MFL Football app, for a league our
 * server does not run (outside chat, step 3).
 */

const store = new Map<string, unknown>();
vi.mock('../src/utils/redis-client', () => ({
  getRedis: async () => ({
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: unknown) => {
      store.set(k, v);
      return 'OK';
    },
    del: async (k: string) => (store.delete(k) ? 1 : 0),
  }),
}));

const { leagueConnectionKey, readLeagueConnection, removeLeagueConnection, saveLeagueConnection } = await import(
  '../src/utils/live/league-groupme-connection'
);
const { resolveLeagueGroupMe } = await import('../src/utils/live/league-groupme-chat');
const { saveGroupMeLink } = await import('../src/utils/live/groupme-owner-auth');

const row = {
  groupId: '59643096',
  groupName: 'Dynasty Degens',
  account: 'acct1',
  franchiseId: '0004',
  franchiseName: 'Dead Cap Walking',
  connectedAt: '2026-10-27T20:00:00.000Z',
};

beforeEach(() => {
  store.clear();
  vi.stubEnv('JWT_SECRET', 'test-secret-for-sealing');
});

describe('league GroupMe connection', () => {
  it('round-trips, and reads a group id Upstash handed back as a number', async () => {
    await saveLeagueConnection('55555', row);
    expect(await readLeagueConnection('55555')).toEqual(row);
    store.set(leagueConnectionKey('55555'), { ...row, groupId: 59643096 });
    expect((await readLeagueConnection('55555'))?.groupId).toBe('59643096');
  });

  it('is keyed by MFL league id, so one league never shows another’s group', async () => {
    await saveLeagueConnection('55555', row);
    expect(await readLeagueConnection('66666')).toBeNull();
  });

  it('switching back to MFL chat removes it', async () => {
    await saveLeagueConnection('55555', row);
    await removeLeagueConnection('55555');
    expect(await readLeagueConnection('55555')).toBeNull();
  });
});

describe('resolveLeagueGroupMe for a connected league', () => {
  it('reads with the connecting owner’s own sign-in, and says who connected it', async () => {
    await saveLeagueConnection('55555', row);
    await saveGroupMeLink('acct1', { token: 'tok123', userId: 'u1', name: 'JoBu' });
    expect(await resolveLeagueGroupMe('55555')).toEqual({
      groupId: '59643096',
      readToken: 'tok123',
      fixed: false,
      connectedBy: { franchiseId: '0004', name: 'Dead Cap Walking' },
      groupName: 'Dynasty Degens',
    });
  });

  it('falls back to MFL chat when the connector has signed out of GroupMe', async () => {
    await saveLeagueConnection('55555', row);
    expect(await resolveLeagueGroupMe('55555')).toBeNull();
  });

  it('never lets a stored connection override a league whose GroupMe our server runs', async () => {
    await saveLeagueConnection(LEAGUES.theleague.id, row);
    await saveGroupMeLink('acct1', { token: 'tok123', userId: 'u1', name: 'JoBu' });
    const group = await resolveLeagueGroupMe(LEAGUES.theleague.id);
    expect(group?.readToken).toBeUndefined();
    expect(group?.groupId).not.toBe('59643096');
  });
});
