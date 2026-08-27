/**
 * Tests for createKvFranchiseStore (Phase 2 registry sweep) and its two
 * instantiations, api/cr.ts and api/ri.ts.
 *
 * api/cr.ts (Custom Rankings) and api/ri.ts (Import Rankings) were 85%
 * identical — same GET/POST shape, same per-franchise Redis key. This locks
 * in their auth semantics after the merge into one factory.
 *
 * cr.ts was admin-only until Aug 2026, while the board was an unreleased
 * experiment. It now backs the My Draft List importer/exporter that every
 * owner uses, so both routes allow any authenticated owner and the franchise
 * scoping — not a role check — is what keeps one owner out of another's data.
 * That makes the isolation tests below the load-bearing ones.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionToken } from '../src/utils/session';
import { DEFAULT_LEAGUE_ID } from '../src/config/leagues';

const redisStore = new Map<string, unknown>();
const fakeRedis = {
  get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
  set: vi.fn(async (key: string, value: unknown) => {
    redisStore.set(key, value);
    return 'OK';
  }),
};
vi.mock('../src/utils/redis-client', () => ({
  getRedis: async () => fakeRedis,
}));

import { GET as crGET, POST as crPOST } from '../src/pages/api/cr';
import { GET as riGET, POST as riPOST } from '../src/pages/api/ri';

function makeContext(request: Request) {
  return {
    request,
    url: new URL(request.url),
    params: {},
    props: {},
    redirect: () => new Response('', { status: 302 }),
    rewrite: (() => new Response('')) as any,
    cookies: {} as any,
    locals: {} as any,
    site: new URL('http://test.invalid'),
    generator: 'astro',
    clientAddress: '127.0.0.1',
  } as any;
}

function sessionCookieFor(role: 'owner' | 'commissioner' | 'admin', franchiseId = '0002') {
  const token = createSessionToken({
    userId: 'mfl-user-1',
    username: 'Test Owner',
    franchiseId,
    leagueId: DEFAULT_LEAGUE_ID,
    role,
  });
  return `session_token=${token}`;
}

describe('createKvFranchiseStore — auth gate parity with pre-merge routes', () => {
  beforeEach(() => {
    redisStore.clear();
    fakeRedis.get.mockClear();
    fakeRedis.set.mockClear();
  });

  it('GET /api/cr succeeds for a plain owner (no longer admin-gated)', async () => {
    const cookie = sessionCookieFor('owner');
    const res = await crGET(makeContext(new Request('http://test.invalid/api/cr', { headers: { cookie } })));
    expect(res.status).toBe(200);
  });

  it('POST /api/cr writes a plain owner to THEIR OWN franchise key, not a shared one', async () => {
    const cookie = sessionCookieFor('owner', '0007');
    const res = await crPOST(
      makeContext(
        new Request('http://test.invalid/api/cr', {
          method: 'POST',
          headers: { cookie },
          body: JSON.stringify({ some: 'data' }),
        })
      )
    );
    expect(res.status).toBe(200);
    // The franchise number is what isolates owners now that the role check is
    // gone — a bare `cr:` key here would pool every owner's board together.
    expect(redisStore.has('cr:0007')).toBe(true);
    expect(redisStore.has('cr:')).toBe(false);
  });

  it('two owners in the same league never share a custom-rankings key', async () => {
    for (const franchise of ['0003', '0004']) {
      await crPOST(
        makeContext(
          new Request('http://test.invalid/api/cr', {
            method: 'POST',
            headers: { cookie: sessionCookieFor('owner', franchise) },
            body: JSON.stringify({ owner: franchise }),
          })
        )
      );
    }
    expect(redisStore.get('cr:0003')).toEqual({ owner: '0003' });
    expect(redisStore.get('cr:0004')).toEqual({ owner: '0004' });
  });

  it('GET /api/cr succeeds for a commissioner', async () => {
    const cookie = sessionCookieFor('commissioner', '0001');
    const res = await crGET(makeContext(new Request('http://test.invalid/api/cr', { headers: { cookie } })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ data: null });
  });

  it('GET /api/ri succeeds for a plain owner (ri.ts allows any authenticated user)', async () => {
    const cookie = sessionCookieFor('owner');
    const res = await riGET(makeContext(new Request('http://test.invalid/api/ri', { headers: { cookie } })));
    expect(res.status).toBe(200);
  });

  it('POST /api/ri succeeds for a plain owner and namespaces the key by franchise + prefix', async () => {
    const cookie = sessionCookieFor('owner', '0002');
    const res = await riPOST(
      makeContext(
        new Request('http://test.invalid/api/ri', {
          method: 'POST',
          headers: { cookie },
          body: JSON.stringify({ rankings: ['a', 'b'] }),
        })
      )
    );
    expect(res.status).toBe(200);
    expect(fakeRedis.set).toHaveBeenCalledWith('ri:0002', { rankings: ['a', 'b'] });
  });

  it('cr and ri namespace the same franchise under different key prefixes', async () => {
    const cookie = sessionCookieFor('commissioner', '0001');
    await crPOST(
      makeContext(
        new Request('http://test.invalid/api/cr', {
          method: 'POST',
          headers: { cookie },
          body: JSON.stringify({ tier: 'gold' }),
        })
      )
    );
    expect(fakeRedis.set).toHaveBeenCalledWith('cr:0001', { tier: 'gold' });
  });

  it('both routes return 401 when unauthenticated', async () => {
    const crRes = await crGET(makeContext(new Request('http://test.invalid/api/cr')));
    const riRes = await riGET(makeContext(new Request('http://test.invalid/api/ri')));
    expect(crRes.status).toBe(401);
    expect(riRes.status).toBe(401);
  });

  it('rejects a session with an empty franchiseId (would otherwise pool data under the bare key)', async () => {
    const cookie = sessionCookieFor('owner', '');
    const res = await riGET(makeContext(new Request('http://test.invalid/api/ri', { headers: { cookie } })));
    expect(res.status).toBe(401);
    expect(fakeRedis.get).not.toHaveBeenCalled();
  });
});
