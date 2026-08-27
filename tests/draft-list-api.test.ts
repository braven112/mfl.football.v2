/**
 * /api/draft-list — the endpoint that overwrites an owner's MFL draft list.
 *
 * The write is destructive and has no undo on MFL's side, so the rules that
 * matter here are about what must NOT happen: no push without first capturing
 * what it replaces, no cross-league write, no franchise-less session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionToken } from '../src/utils/session';
import { LEAGUES } from '../src/config/leagues';

const redisStore = new Map<string, unknown>();
const fakeRedis = {
  get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
  set: vi.fn(async (key: string, value: unknown) => { redisStore.set(key, value); return 'OK'; }),
  incr: vi.fn(async () => 1),
  expire: vi.fn(async () => 1),
};
vi.mock('../src/utils/redis-client', () => ({ getRedis: async () => fakeRedis }));

const pullDraftList = vi.fn();
const pushDraftList = vi.fn();
vi.mock('../src/utils/mfl-draft-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/mfl-draft-list')>();
  return {
    ...actual,
    pullDraftList: (...a: unknown[]) => pullDraftList(...a),
    pushDraftList: (...a: unknown[]) => pushDraftList(...a),
  };
});

import { GET, POST } from '../src/pages/api/draft-list';

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

const post = (body: unknown, { cookie = cookieFor(), query = '' } = {}) =>
  POST(ctx(new Request(`http://t.invalid/api/draft-list${query}`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })));

beforeEach(() => {
  redisStore.clear();
  pullDraftList.mockReset();
  pushDraftList.mockReset();
  fakeRedis.incr.mockResolvedValue(1);
});

describe('auth', () => {
  it('rejects an anonymous caller', async () => {
    const res = await GET(ctx(new Request('http://t.invalid/api/draft-list')));
    expect(res.status).toBe(401);
  });

  it('rejects a session with no franchise — it would share a bare KV key', async () => {
    const token = createSessionToken({
      userId: 'u', username: 'u', franchiseId: '', leagueId: LEAGUES.theleague.id, role: 'owner',
    });
    const res = await GET(ctx(new Request('http://t.invalid/api/draft-list', {
      headers: { cookie: `session_token=${token}` },
    })));
    expect(res.status).toBe(401);
  });

  it('rejects a league param that disagrees with the session', async () => {
    // An owner of one league can browse the other's board page; without this
    // their cookie would carry that page's push into the wrong league.
    const res = await GET(ctx(new Request('http://t.invalid/api/draft-list?league=afl', {
      headers: { cookie: cookieFor(LEAGUES.theleague.id) },
    })));
    expect(res.status).toBe(401);
    expect(pullDraftList).not.toHaveBeenCalled();
  });
});

describe('POST — snapshot before overwrite', () => {
  it('does NOT push when the pre-write read fails', async () => {
    // The whole point of the snapshot is to survive a bad push. If we cannot
    // read what we are about to destroy, the correct move is to destroy
    // nothing.
    pullDraftList.mockResolvedValue({ ok: false, playerIds: [], error: 'MFL is down' });
    const res = await post({ playerIds: ['14836'] });
    expect(res.status).toBe(502);
    expect(pushDraftList).not.toHaveBeenCalled();
  });

  it('snapshots the CURRENT MFL list, then pushes', async () => {
    pullDraftList.mockResolvedValue({ ok: true, playerIds: ['999', '888'] });
    pushDraftList.mockResolvedValue({ ok: true });

    const res = await post({ playerIds: ['14836', '17634'] });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, count: 2, snapshotSaved: true });

    expect(redisStore.get('dl:snapshot:0002')).toMatchObject({ playerIds: ['999', '888'] });
    expect(pushDraftList).toHaveBeenCalledWith(
      expect.objectContaining({ playerIds: ['14836', '17634'] }),
    );
  });

  it('scopes the snapshot key per league — franchise 0002 exists in both', async () => {
    pullDraftList.mockResolvedValue({ ok: true, playerIds: ['999'] });
    pushDraftList.mockResolvedValue({ ok: true });
    await post({ playerIds: ['14836'] }, {
      cookie: cookieFor(LEAGUES['afl-fantasy'].id),
      query: '?league=afl',
    });
    expect(redisStore.has('dl:snapshot:afl:0002')).toBe(true);
    expect(redisStore.has('dl:snapshot:0002')).toBe(false);
  });

  it('reports snapshotSaved even with nothing to save (owner had no board)', async () => {
    pullDraftList.mockResolvedValue({ ok: true, playerIds: [] });
    pushDraftList.mockResolvedValue({ ok: true });
    const res = await post({ playerIds: ['14836'] });
    await expect(res.json()).resolves.toMatchObject({ ok: true, snapshotSaved: true });
  });
});

describe('POST — input handling', () => {
  it('rejects a body with no valid ids rather than pushing junk', async () => {
    const res = await post({ playerIds: ['nope', ''] });
    expect(res.status).toBe(400);
    expect(pushDraftList).not.toHaveBeenCalled();
  });

  it('rejects an absurdly long list', async () => {
    const res = await post({ playerIds: Array.from({ length: 1001 }, (_, i) => `${i + 1}`) });
    expect(res.status).toBe(400);
  });

  it('surfaces an MFL rejection as a 502, not a success', async () => {
    pullDraftList.mockResolvedValue({ ok: true, playerIds: ['999'] });
    pushDraftList.mockResolvedValue({ ok: false, error: 'API requires a logged in user' });
    const res = await post({ playerIds: ['14836'] });
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ ok: false });
  });

  it('rate-limits writes', async () => {
    fakeRedis.incr.mockResolvedValue(999);
    const res = await post({ playerIds: ['14836'] });
    expect(res.status).toBe(429);
    expect(pushDraftList).not.toHaveBeenCalled();
  });
});

describe('POST ?restore=1', () => {
  it('pushes the snapshot back and does not re-snapshot over it', async () => {
    redisStore.set('dl:snapshot:0002', { playerIds: ['999', '888'], takenAt: 'x' });
    pushDraftList.mockResolvedValue({ ok: true });

    const res = await POST(ctx(new Request('http://t.invalid/api/draft-list?restore=1', {
      method: 'POST', headers: { cookie: cookieFor() },
    })));

    expect(res.status).toBe(200);
    expect(pullDraftList).not.toHaveBeenCalled();
    expect(pushDraftList).toHaveBeenCalledWith(
      expect.objectContaining({ playerIds: ['999', '888'] }),
    );
    // The undo buffer must survive being used, or a failed restore is fatal.
    expect(redisStore.get('dl:snapshot:0002')).toMatchObject({ playerIds: ['999', '888'] });
  });

  it('404s when there is no snapshot', async () => {
    const res = await POST(ctx(new Request('http://t.invalid/api/draft-list?restore=1', {
      method: 'POST', headers: { cookie: cookieFor() },
    })));
    expect(res.status).toBe(404);
  });
});
