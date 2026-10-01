/**
 * The claim path of POST /api/throwback-preference, against an in-memory
 * Redis whose every call yields to the event loop — so two requests really do
 * interleave, the way two owners on two phones do.
 *
 * Deferred from hotfix #1275 (issue #1276): the check ("is this era free?")
 * and the write were two Redis calls, so two owners saving one open era at the
 * same moment were both told "Saved." Settled now by a league-wide lock; these
 * tests fail without it. Also pinned: a failed read is not an empty league,
 * the rightful winner of an old tie may re-save its own era, and a team's
 * default is reserved to it until its owner picks something else.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionToken } from '../src/utils/session';
import { LEAGUES } from '../src/config/leagues';

const store = new Map<string, unknown>();
let mgetFails = false;
const tick = () => new Promise((r) => setTimeout(r, 0));

vi.mock('../src/utils/redis-client', () => ({
  getRedis: async () => ({
    get: async (k: string) => {
      await tick();
      return store.get(k) ?? null;
    },
    mget: async (...keys: string[]) => {
      await tick();
      if (mgetFails) throw new Error('mget down');
      return keys.map((k) => store.get(k) ?? null);
    },
    set: async (k: string, v: unknown, opts?: { nx?: boolean; ex?: number }) => {
      await tick();
      if (opts?.nx && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    },
    eval: async (_script: string, keys: string[], args: string[]) => {
      await tick();
      if (store.get(keys[0]) !== args[0]) return 0;
      store.delete(keys[0]);
      return 1;
    },
  }),
}));

// The real lock window depends on today's date; these tests are about claims.
vi.mock('../src/utils/throwback-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/utils/throwback-scope')>()),
  isThrowbackPickLocked: () => false,
}));

import { POST } from '../src/pages/api/throwback-preference';
import { makeThrowbackKey, throwbackClaimLockKey } from '../src/utils/throwback-store';

const THELEAGUE = LEAGUES.theleague;
const cookie = (franchiseId: string) =>
  `session_token=${createSessionToken({
    userId: `u${franchiseId}`,
    username: 'Owner',
    franchiseId,
    leagueId: THELEAGUE.id,
    role: 'owner',
  })}`;
const save = (franchiseId: string, body: Record<string, unknown>) =>
  POST({
    request: new Request('http://test.invalid/api/throwback-preference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie(franchiseId) },
      body: JSON.stringify(body),
    }),
  } as any) as Promise<Response>;
const key = (id: string) => makeThrowbackKey(id, 'theleague');

// Heavy Chevy 2020: slot 0004 under an owner who has left, and not 0004's
// default (Drunk Indians 2019) — plainly open to anyone.
const HEAVY_CHEVY = { yearStart: 2020, sourceFranchiseId: '0004' };
// Drunk Indians 2019: franchise 0004's DEFAULT, from a departed owner.
const DRUNK_INDIANS = { yearStart: 2019, sourceFranchiseId: '0004' };

beforeEach(() => {
  store.clear();
  mgetFails = false;
});

describe('claiming an era is atomic', () => {
  it('two owners saving one open era at the same moment: one saves, one is refused', async () => {
    const [a, b] = await Promise.all([save('0001', HEAVY_CHEVY), save('0002', HEAVY_CHEVY)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const stored = [store.get(key('0001')), store.get(key('0002'))].filter(Boolean);
    expect(stored).toHaveLength(1);
  });

  it('releases the lock after every outcome', async () => {
    await save('0001', HEAVY_CHEVY);
    await save('0002', HEAVY_CHEVY);
    expect(store.has(throwbackClaimLockKey('theleague'))).toBe(false);
  });

  it('refuses rather than proceeding unlocked when the lock stays busy', async () => {
    store.set(throwbackClaimLockKey('theleague'), 'someone-else');
    const res = await save('0001', HEAVY_CHEVY);
    expect(res.status).toBe(503);
    expect(store.has(key('0001'))).toBe(false);
  });

  it('a failed read is not an empty league: 503, nothing written', async () => {
    store.set(key('0002'), { ...HEAVY_CHEVY, claimedAt: 1 });
    mgetFails = true;
    const res = await save('0001', HEAVY_CHEVY);
    expect(res.status).toBe(503);
    expect(store.has(key('0001'))).toBe(false);
  });
});

describe('who holds an era is resolved from every saved pick', () => {
  it('the winner of an old tie re-saves its own era and keeps its place in line', async () => {
    store.set(key('0002'), { ...HEAVY_CHEVY, claimedAt: 1000 });
    store.set(key('0001'), { ...HEAVY_CHEVY, claimedAt: 2000 });
    const winner = await save('0002', HEAVY_CHEVY);
    expect(winner.status).toBe(200);
    expect((store.get(key('0002')) as any).claimedAt).toBe(1000);
    const loser = await save('0001', HEAVY_CHEVY);
    expect(loser.status).toBe(409);
  });
});

describe("a team's default is reserved until its owner picks something else", () => {
  it('refuses a claim on the default of a team that has picked nothing', async () => {
    const res = await save('0001', DRUNK_INDIANS);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.claimedBy).toBe('0004');
    expect(body.error).toMatch(/default/);
  });

  it('opens it once that owner picks a different era, and does not hand it back', async () => {
    expect((await save('0004', { yearStart: 2020 })).status).toBe(200);
    expect((await save('0001', DRUNK_INDIANS)).status).toBe(200);
    // 0004 changes its mind — but its default is 0001's now.
    const back = await save('0004', { yearStart: 2019 });
    expect(back.status).toBe(409);
    expect((await back.json()).claimedBy).toBe('0001');
  });

  it('its owner may still pick it outright', async () => {
    expect((await save('0004', { yearStart: 2019 })).status).toBe(200);
  });
});
