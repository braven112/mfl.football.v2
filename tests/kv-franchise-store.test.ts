/**
 * Tests for createKvFranchiseStore (Phase 2 registry sweep) and its two
 * instantiations, api/cr.ts and api/ri.ts.
 *
 * api/cr.ts (Custom Rankings, admin-only) and api/ri.ts (Import Rankings,
 * any authenticated owner) were 85% identical — same GET/POST shape, same
 * per-franchise Redis key, different auth gate. This locks in that each
 * route kept its exact prior auth semantics after the merge into one
 * factory.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionToken } from '../src/utils/session';

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
    leagueId: '13522',
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

  it('GET /api/cr returns 401 for a non-admin owner (cr.ts requires commissioner/admin)', async () => {
    const cookie = sessionCookieFor('owner');
    const res = await crGET(makeContext(new Request('http://test.invalid/api/cr', { headers: { cookie } })));
    expect(res.status).toBe(401);
  });

  it('POST /api/cr returns 401 for a non-admin owner', async () => {
    const cookie = sessionCookieFor('owner');
    const res = await crPOST(
      makeContext(
        new Request('http://test.invalid/api/cr', {
          method: 'POST',
          headers: { cookie },
          body: JSON.stringify({ some: 'data' }),
        })
      )
    );
    expect(res.status).toBe(401);
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
});
