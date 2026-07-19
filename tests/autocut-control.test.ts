/**
 * Tests for the commissioner autocut control route
 * (src/pages/api/admin/autocut-control.ts).
 *
 * Covers the Wave-3 audit-surface contract:
 *  - auth gating: 401 without a session, 403 for a non-admin owner session,
 *    200 for commissioner/admin sessions;
 *  - kill-switch round-trip: pause writes JSON { by, at } to
 *    autocut:paused:{year}, GET reflects it, resume deletes it;
 *  - legacy plain-string paused flags still read as paused (the job treats
 *    ANY value as halt);
 *  - manual-done append: read-modify-write into the snapshot entry's
 *    outcomes array, idempotent, 404 without a snapshot/entry;
 *  - custody invariant: the route NEVER touches an autocut:cred:* key and
 *    no response ever contains credential material.
 *
 * Conventions follow tests/autocut-storage.test.ts: Map-backed redis fake,
 * real session JWTs via createSessionToken, synthetic APIContext.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionToken } from '../src/utils/session';
import { DEFAULT_LEAGUE_ID } from '../src/config/leagues';
import { getCurrentLeagueYear } from '../src/utils/league-year';

// ---------------------------------------------------------------------------
// Mocks (hoisted above the module imports below)
// ---------------------------------------------------------------------------

const redisStore = new Map<string, unknown>();
let redisAvailable = true;
const fakeRedis = {
  get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
  set: vi.fn(async (key: string, value: unknown) => {
    redisStore.set(key, value);
    return 'OK';
  }),
  del: vi.fn(async (key: string) => {
    redisStore.delete(key);
    return 1;
  }),
};
vi.mock('../src/utils/redis-client', () => ({
  getRedis: async () => (redisAvailable ? fakeRedis : null),
}));

import { GET, POST, parsePausedValue } from '../src/pages/api/admin/autocut-control';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const YEAR = getCurrentLeagueYear();
const PAUSED_KEY = `autocut:paused:${YEAR}`;
const SNAPSHOT_KEY = `autocut:snapshot:${YEAR}`;

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

function sessionCookieFor(
  role: 'owner' | 'commissioner' | 'admin',
  franchiseId = '0003',
  username = 'Test Commish',
) {
  const token = createSessionToken({
    userId: 'MFL_COOKIE_VALUE_secret123',
    username,
    franchiseId,
    leagueId: DEFAULT_LEAGUE_ID,
    role,
  });
  return `session_token=${token}`;
}

// Franchise 0003 is NOT in navConfig.adminFranchiseIds (0001/0000), so an
// 'owner' session on 0003 exercises the non-admin path.
const ownerCookie = () => sessionCookieFor('owner', '0003', 'Regular Owner');
const commishCookie = () => sessionCookieFor('commissioner', '0003', 'The Commish');

function postRequest(body: unknown, cookie?: string) {
  return new Request('http://test.invalid/api/admin/autocut-control', {
    method: 'POST',
    headers: cookie ? { cookie } : {},
    body: JSON.stringify(body),
  });
}

function getRequest(cookie?: string) {
  return new Request('http://test.invalid/api/admin/autocut-control', {
    headers: cookie ? { cookie } : {},
  });
}

function seedSnapshot() {
  redisStore.set(SNAPSHOT_KEY, {
    version: 1,
    year: YEAR,
    mode: 'live',
    generatedAt: '2026-08-16T03:45:00.000Z',
    franchises: {
      '0007': {
        franchiseId: '0007',
        markedList: { year: YEAR, playerIds: ['111', '222'], updatedAt: '2026-08-01T00:00:00Z' },
        rosterAtExecution: [],
        slate: { cuts: [{ playerId: '111', reason: 'marked' }], activeCount: 23, overage: 1, target: 22 },
        outcomes: [
          { playerId: '111', reason: 'marked', status: 'failed: timeout', at: '2026-08-17T04:00:00Z' },
        ],
      },
    },
  });
}

beforeEach(() => {
  redisStore.clear();
  redisAvailable = true;
  fakeRedis.get.mockClear();
  fakeRedis.set.mockClear();
  fakeRedis.del.mockClear();
});

// ---------------------------------------------------------------------------
// parsePausedValue
// ---------------------------------------------------------------------------

describe('parsePausedValue', () => {
  it('reads absent values as not paused', () => {
    expect(parsePausedValue(null)).toEqual({ paused: false, pausedBy: null, pausedAt: null });
    expect(parsePausedValue(undefined).paused).toBe(false);
    expect(parsePausedValue('').paused).toBe(false);
  });

  it('reads a { by, at } object (Upstash-deserialized) with attribution', () => {
    expect(parsePausedValue({ by: 'Commish', at: '2026-08-16T01:00:00Z' })).toEqual({
      paused: true,
      pausedBy: 'Commish',
      pausedAt: '2026-08-16T01:00:00Z',
    });
  });

  it('reads a JSON string flag with attribution', () => {
    expect(parsePausedValue('{"by":"Commish","at":"2026-08-16T01:00:00Z"}')).toEqual({
      paused: true,
      pausedBy: 'Commish',
      pausedAt: '2026-08-16T01:00:00Z',
    });
  });

  it('reads any legacy/unparseable value as paused without attribution', () => {
    expect(parsePausedValue('1')).toEqual({ paused: true, pausedBy: null, pausedAt: null });
    expect(parsePausedValue('stop please')).toEqual({ paused: true, pausedBy: null, pausedAt: null });
  });
});

// ---------------------------------------------------------------------------
// Auth + storage gates
// ---------------------------------------------------------------------------

describe('/api/admin/autocut-control — auth gates', () => {
  it('GET and POST return 401 without a session', async () => {
    expect((await GET(makeContext(getRequest()))).status).toBe(401);
    expect((await POST(makeContext(postRequest({ action: 'pause' })))).status).toBe(401);
  });

  it('GET and POST return 403 for a non-admin owner session', async () => {
    expect((await GET(makeContext(getRequest(ownerCookie())))).status).toBe(403);
    expect((await POST(makeContext(postRequest({ action: 'pause' }, ownerCookie())))).status).toBe(403);
    // Nothing was written by the rejected request.
    expect(redisStore.size).toBe(0);
  });

  it('allows commissioner and admin roles through the gate', async () => {
    expect((await GET(makeContext(getRequest(commishCookie())))).status).toBe(200);
    const adminCookie = sessionCookieFor('admin', '0009', 'Site Admin');
    expect((await GET(makeContext(getRequest(adminCookie)))).status).toBe(200);
  });

  it('returns 503 when Redis is unconfigured', async () => {
    redisAvailable = false;
    expect((await GET(makeContext(getRequest(commishCookie())))).status).toBe(503);
    expect((await POST(makeContext(postRequest({ action: 'pause' }, commishCookie())))).status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// Kill switch round-trip
// ---------------------------------------------------------------------------

describe('/api/admin/autocut-control — pause/resume round-trip', () => {
  it('defaults to not paused', async () => {
    const res = await GET(makeContext(getRequest(commishCookie())));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ paused: false, pausedBy: null, pausedAt: null, year: YEAR });
  });

  it('pause writes JSON { by, at } to autocut:paused:{year} and GET reflects it', async () => {
    const res = await POST(makeContext(postRequest({ action: 'pause' }, commishCookie())));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.paused).toBe(true);
    expect(body.pausedBy).toBe('The Commish');
    expect(Date.parse(body.pausedAt)).not.toBeNaN();

    // Stored value carries who/when — the deadline job only needs it truthy.
    const stored = redisStore.get(PAUSED_KEY) as { by: string; at: string };
    expect(stored.by).toBe('The Commish');
    expect(Date.parse(stored.at)).not.toBeNaN();

    const getRes = await GET(makeContext(getRequest(commishCookie())));
    const getBody = await getRes.json();
    expect(getBody.paused).toBe(true);
    expect(getBody.pausedBy).toBe('The Commish');
    expect(getBody.pausedAt).toBe(stored.at);
  });

  it('resume deletes the flag and GET flips back to not paused', async () => {
    await POST(makeContext(postRequest({ action: 'pause' }, commishCookie())));
    expect(redisStore.has(PAUSED_KEY)).toBe(true);

    const res = await POST(makeContext(postRequest({ action: 'resume' }, commishCookie())));
    expect(res.status).toBe(200);
    expect((await res.json()).paused).toBe(false);
    expect(redisStore.has(PAUSED_KEY)).toBe(false);

    const getBody = await (await GET(makeContext(getRequest(commishCookie())))).json();
    expect(getBody.paused).toBe(false);
  });

  it('surfaces a legacy plain-string flag as paused without attribution', async () => {
    redisStore.set(PAUSED_KEY, '1');
    const body = await (await GET(makeContext(getRequest(commishCookie())))).json();
    expect(body).toEqual({ paused: true, pausedBy: null, pausedAt: null, year: YEAR });
  });
});

// ---------------------------------------------------------------------------
// manual-done
// ---------------------------------------------------------------------------

describe('/api/admin/autocut-control — manual-done', () => {
  it('appends a { type, playerId, by, at } outcome to the snapshot entry', async () => {
    seedSnapshot();
    const res = await POST(
      makeContext(postRequest({ action: 'manual-done', franchiseId: '0007', playerId: '111' }, commishCookie())),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.outcome).toMatchObject({ type: 'manual-done', playerId: '111', by: 'The Commish' });

    const snapshot = redisStore.get(SNAPSHOT_KEY) as any;
    const outcomes = snapshot.franchises['0007'].outcomes;
    expect(outcomes).toHaveLength(2);
    expect(outcomes[1].type).toBe('manual-done');
    expect(outcomes[1].playerId).toBe('111');
    expect(outcomes[1].by).toBe('The Commish');
    expect(Date.parse(outcomes[1].at)).not.toBeNaN();
    // The frozen plan is never modified — only outcomes grow.
    expect(outcomes[0]).toEqual({
      playerId: '111', reason: 'marked', status: 'failed: timeout', at: '2026-08-17T04:00:00Z',
    });
    expect(snapshot.franchises['0007'].slate.cuts).toHaveLength(1);
  });

  it('normalizes the franchise id ("7" hits the 0007 entry)', async () => {
    seedSnapshot();
    const res = await POST(
      makeContext(postRequest({ action: 'manual-done', franchiseId: '7', playerId: '111' }, commishCookie())),
    );
    expect(res.status).toBe(200);
    expect((redisStore.get(SNAPSHOT_KEY) as any).franchises['0007'].outcomes).toHaveLength(2);
  });

  it('is idempotent — a second check does not duplicate the outcome', async () => {
    seedSnapshot();
    const req = () =>
      postRequest({ action: 'manual-done', franchiseId: '0007', playerId: '111' }, commishCookie());
    await POST(makeContext(req()));
    const res = await POST(makeContext(req()));
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyDone).toBe(true);
    expect((redisStore.get(SNAPSHOT_KEY) as any).franchises['0007'].outcomes).toHaveLength(2);
  });

  it('404s when there is no snapshot or no entry for the franchise', async () => {
    const noSnapshot = await POST(
      makeContext(postRequest({ action: 'manual-done', franchiseId: '0007', playerId: '111' }, commishCookie())),
    );
    expect(noSnapshot.status).toBe(404);

    seedSnapshot();
    const noEntry = await POST(
      makeContext(postRequest({ action: 'manual-done', franchiseId: '0012', playerId: '111' }, commishCookie())),
    );
    expect(noEntry.status).toBe(404);
  });

  it('400s on a bad playerId, missing franchiseId, or unknown action', async () => {
    seedSnapshot();
    for (const body of [
      { action: 'manual-done', franchiseId: '0007', playerId: 'abc' },
      { action: 'manual-done', franchiseId: '0007' },
      { action: 'manual-done', playerId: '111' },
      { action: 'self-destruct' },
    ]) {
      const res = await POST(makeContext(postRequest(body, commishCookie())));
      expect(res.status).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------
// Credential custody — the route must never go near autocut:cred:* keys
// ---------------------------------------------------------------------------

describe('/api/admin/autocut-control — credential custody', () => {
  it('never reads, writes, or deletes an autocut:cred key, and no response leaks one', async () => {
    seedSnapshot();
    const SECRET = 'PLAINTEXT_MFL_COOKIE_should_never_appear';
    redisStore.set('autocut:cred:0007', { v: 1, alg: 'aes-256-gcm', data: SECRET });

    const responses = [
      await GET(makeContext(getRequest(commishCookie()))),
      await POST(makeContext(postRequest({ action: 'pause' }, commishCookie()))),
      await POST(makeContext(postRequest({ action: 'resume' }, commishCookie()))),
      await POST(
        makeContext(
          postRequest({ action: 'manual-done', franchiseId: '0007', playerId: '111' }, commishCookie()),
        ),
      ),
    ];

    const touchedKeys = [
      ...fakeRedis.get.mock.calls,
      ...fakeRedis.set.mock.calls,
      ...fakeRedis.del.mock.calls,
    ].map((args) => String(args[0]));
    expect(touchedKeys.length).toBeGreaterThan(0);
    for (const key of touchedKeys) {
      expect(key.startsWith('autocut:cred:')).toBe(false);
    }

    for (const res of responses) {
      expect(await res.text()).not.toContain(SECRET);
    }
  });
});
