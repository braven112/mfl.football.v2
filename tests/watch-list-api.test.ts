/**
 * /api/watch-list — MFL's myWatchList behind a Redis mirror.
 *
 * The rules that matter: nothing without a franchise session, no
 * cross-league write, a change goes to MFL BEFORE the mirror believes it,
 * and a stale mirror is served when MFL is down rather than a blank list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionToken } from '../src/utils/session';
import { LEAGUES } from '../src/config/leagues';
import { watchListKey } from '../src/utils/watch-list-keys.mjs';

const redisStore = new Map<string, unknown>();
const fakeRedis = {
  get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
  set: vi.fn(async (key: string, value: unknown) => { redisStore.set(key, value); return 'OK'; }),
  incr: vi.fn(async () => 1),
  expire: vi.fn(async () => 1),
};
vi.mock('../src/utils/redis-client', () => ({ getRedis: async () => fakeRedis }));

const pullWatchList = vi.fn();
const updateWatchList = vi.fn();
vi.mock('../src/utils/mfl-watch-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/mfl-watch-list')>();
  return {
    ...actual,
    pullWatchList: (...a: unknown[]) => pullWatchList(...a),
    updateWatchList: (...a: unknown[]) => updateWatchList(...a),
  };
});

import { GET, POST } from '../src/pages/api/watch-list';

const ctx = (request: Request) => ({ request, url: new URL(request.url) }) as any;

function cookieFor(leagueId = LEAGUES.theleague.id, franchiseId = '0002') {
  const token = createSessionToken({
    userId: 'mfl-cookie-abc',
    username: 'Test Owner',
    franchiseId,
    leagueId,
    role: 'owner',
  });
  return `session_token=${token}`;
}

const get = ({ cookie = cookieFor(), query = '' } = {}) =>
  GET(ctx(new Request(`http://t.invalid/api/watch-list${query}`, { headers: { cookie } })));

const post = (body: unknown, { cookie = cookieFor(), query = '' } = {}) =>
  POST(ctx(new Request(`http://t.invalid/api/watch-list${query}`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })));

const mirrorKey = watchListKey(LEAGUES.theleague.slug, '0002');

beforeEach(() => {
  redisStore.clear();
  pullWatchList.mockReset();
  updateWatchList.mockReset();
  fakeRedis.incr.mockResolvedValue(1);
});

describe('auth', () => {
  it('rejects an anonymous caller', async () => {
    const res = await GET(ctx(new Request('http://t.invalid/api/watch-list')));
    expect(res.status).toBe(401);
  });

  it('rejects a session with no franchise', async () => {
    const token = createSessionToken({ userId: 'u', username: 'x', franchiseId: '', leagueId: LEAGUES.theleague.id, role: 'owner' } as any);
    const res = await get({ cookie: `session_token=${token}` });
    expect(res.status).toBe(401);
    expect(pullWatchList).not.toHaveBeenCalled();
  });

  it('rejects a league param that disagrees with the session', async () => {
    const res = await post({ add: ['1'] }, { query: '?league=afl' });
    expect(res.status).toBe(401);
    expect(updateWatchList).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('serves a fresh mirror without touching MFL', async () => {
    redisStore.set(mirrorKey, { playerIds: ['14836'], syncedAt: new Date().toISOString() });
    const res = await get();
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, playerIds: ['14836'], source: 'mirror' });
    expect(pullWatchList).not.toHaveBeenCalled();
  });

  it('re-reads MFL when the mirror is stale, and rewrites the mirror', async () => {
    redisStore.set(mirrorKey, { playerIds: ['1'], syncedAt: '2020-01-01T00:00:00.000Z' });
    pullWatchList.mockResolvedValue({ ok: true, playerIds: ['2', '3'] });
    const body = await (await get()).json();
    expect(body).toMatchObject({ ok: true, playerIds: ['2', '3'], source: 'mfl' });
    expect((redisStore.get(mirrorKey) as any).playerIds).toEqual(['2', '3']);
  });

  it('?refresh=1 forces the MFL read', async () => {
    redisStore.set(mirrorKey, { playerIds: ['1'], syncedAt: new Date().toISOString() });
    pullWatchList.mockResolvedValue({ ok: true, playerIds: ['9'] });
    const body = await (await get({ query: '?refresh=1' })).json();
    expect(body.playerIds).toEqual(['9']);
  });

  it('serves the stale mirror with a warning when MFL is down', async () => {
    redisStore.set(mirrorKey, { playerIds: ['1'], syncedAt: '2020-01-01T00:00:00.000Z' });
    pullWatchList.mockResolvedValue({ ok: false, playerIds: [], error: 'boom' });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, playerIds: ['1'], source: 'mirror-stale', warning: 'boom' });
  });

  it('502s when MFL is down and there is no mirror', async () => {
    pullWatchList.mockResolvedValue({ ok: false, playerIds: [], error: 'boom' });
    expect((await get()).status).toBe(502);
  });

  it('keys the mirror per league — franchise 0002 exists in both', async () => {
    pullWatchList.mockResolvedValue({ ok: true, playerIds: ['5'] });
    await get({ cookie: cookieFor(LEAGUES['afl-fantasy'].id) });
    expect(redisStore.has(watchListKey(LEAGUES['afl-fantasy'].slug, '0002'))).toBe(true);
    expect(redisStore.has(mirrorKey)).toBe(false);
  });
});

describe('POST', () => {
  it('writes the change to MFL, then applies it to the mirror', async () => {
    redisStore.set(mirrorKey, { playerIds: ['1', '2'], syncedAt: new Date().toISOString() });
    updateWatchList.mockResolvedValue({ ok: true });
    const body = await (await post({ add: ['3'], remove: ['1'] })).json();
    expect(updateWatchList).toHaveBeenCalledWith(expect.objectContaining({ add: ['3'], remove: ['1'], mflUserCookie: 'mfl-cookie-abc' }));
    expect(body).toMatchObject({ ok: true, playerIds: ['2', '3'], added: ['3'], removed: ['1'], mirrored: true });
    expect((redisStore.get(mirrorKey) as any).playerIds).toEqual(['2', '3']);
  });

  it('does NOT touch the mirror when MFL rejects the change', async () => {
    redisStore.set(mirrorKey, { playerIds: ['1'], syncedAt: new Date().toISOString() });
    updateWatchList.mockResolvedValue({ ok: false, error: 'nope' });
    const res = await post({ add: ['3'] });
    expect(res.status).toBe(502);
    expect((redisStore.get(mirrorKey) as any).playerIds).toEqual(['1']);
  });

  it('seeds the mirror from MFL when there is none yet', async () => {
    updateWatchList.mockResolvedValue({ ok: true });
    pullWatchList.mockResolvedValue({ ok: true, playerIds: ['7'] });
    const body = await (await post({ add: ['8'] })).json();
    expect(body.playerIds).toEqual(['7', '8']);
  });

  it('rejects a body with nothing valid to do', async () => {
    expect((await post({ add: ['abc'] })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ add: 'x' })).status).toBe(400);
    expect(updateWatchList).not.toHaveBeenCalled();
  });

  it('rate-limits writes', async () => {
    fakeRedis.incr.mockResolvedValue(999);
    expect((await post({ add: ['1'] })).status).toBe(429);
    expect(updateWatchList).not.toHaveBeenCalled();
  });
});
