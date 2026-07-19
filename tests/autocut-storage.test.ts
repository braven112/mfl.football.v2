/**
 * Tests for the August auto-cut storage layer (src/utils/autocut-storage.ts)
 * and the /api/autocut-list route (src/pages/api/autocut-list.ts).
 *
 * Covers the credential custody contract from the feature plan:
 * AES-256-GCM round-trip, missing-env no-op (never throws), the 30-day
 * freshness threshold, step-up auth (`requiresReauth` persists nothing),
 * and that no credential material ever crosses the HTTP response boundary.
 *
 * Route testing follows tests/kv-franchise-store.test.ts: mock the shared
 * redis client with a Map-backed fake, mint real session JWTs, and invoke
 * the exported GET/POST handlers with a synthetic APIContext.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

const mflFetchMock = vi.fn();
vi.mock('../src/utils/mfl-fetch', () => ({
  mflFetch: (...args: unknown[]) => mflFetchMock(...args),
}));

import {
  getCutList,
  saveCutList,
  captureCredential,
  readCredential,
  getCredentialCapturedAt,
  deleteCredential,
  isCredentialFresh,
  cutListKey,
  credentialKey,
  CREDENTIAL_MAX_AGE_DAYS,
} from '../src/utils/autocut-storage';
import { GET, POST } from '../src/pages/api/autocut-list';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_KEY = 'unit-test-passphrase-not-a-real-secret';
const TEST_COOKIE = 'MFL_COOKIE_VALUE_abc123XYZ';

function mockLiveMflCookie() {
  mflFetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ leagues: { league: [{ league_id: 'test-league' }] } }), {
        status: 200,
      }),
  );
}

function mockDeadMflCookie() {
  mflFetchMock.mockImplementation(
    async () => new Response(JSON.stringify({ leagues: {} }), { status: 200 }),
  );
}

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

function sessionCookieFor(franchiseId = '0003', userId = TEST_COOKIE) {
  const token = createSessionToken({
    userId,
    username: 'Test Owner',
    franchiseId,
    leagueId: DEFAULT_LEAGUE_ID,
    role: 'owner',
  });
  return `session_token=${token}`;
}

function postRequest(body: unknown, cookie?: string) {
  return new Request('http://test.invalid/api/autocut-list', {
    method: 'POST',
    headers: cookie ? { cookie } : {},
    body: JSON.stringify(body),
  });
}

function getRequest(cookie?: string) {
  return new Request('http://test.invalid/api/autocut-list', {
    headers: cookie ? { cookie } : {},
  });
}

const CURRENT_YEAR = getCurrentLeagueYear();

beforeEach(() => {
  redisStore.clear();
  redisAvailable = true;
  fakeRedis.get.mockClear();
  fakeRedis.set.mockClear();
  fakeRedis.del.mockClear();
  mflFetchMock.mockReset();
  vi.stubEnv('AUTOCUT_CRED_KEY', TEST_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Key naming
// ---------------------------------------------------------------------------

describe('autocut-storage — key naming', () => {
  it('normalizes numeric franchise ids to 4 digits so "1" and "0001" share keys', () => {
    expect(cutListKey('1')).toBe('autocut:0001');
    expect(cutListKey('0001')).toBe('autocut:0001');
    expect(credentialKey('1')).toBe('autocut:cred:0001');
    expect(credentialKey('0012')).toBe('autocut:cred:0012');
  });
});

// ---------------------------------------------------------------------------
// Cut list storage
// ---------------------------------------------------------------------------

describe('autocut-storage — cut list', () => {
  it('round-trips a cut list and stamps updatedAt', async () => {
    const saved = await saveCutList('0004', { year: CURRENT_YEAR, playerIds: ['111', '222'] });
    expect(saved).not.toBeNull();
    expect(saved!.year).toBe(CURRENT_YEAR);
    expect(saved!.playerIds).toEqual(['111', '222']);
    expect(Date.parse(saved!.updatedAt)).not.toBeNaN();

    const loaded = await getCutList('0004');
    expect(loaded).toEqual(saved);
  });

  it('returns null for a missing list', async () => {
    expect(await getCutList('0009')).toBeNull();
  });

  it('returns null for a malformed stored record', async () => {
    redisStore.set('autocut:0004', { bogus: true });
    expect(await getCutList('0004')).toBeNull();
  });

  it('returns null when Redis is unconfigured', async () => {
    redisAvailable = false;
    expect(await saveCutList('0004', { year: CURRENT_YEAR, playerIds: [] })).toBeNull();
    expect(await getCutList('0004')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Credential encryption
// ---------------------------------------------------------------------------

describe('autocut-storage — credential custody', () => {
  it('round-trips a credential through AES-256-GCM encryption', async () => {
    const capturedAt = await captureCredential('0004', TEST_COOKIE);
    expect(capturedAt).not.toBeNull();
    expect(Date.parse(capturedAt!)).not.toBeNaN();

    const read = await readCredential('0004');
    expect(read).toEqual({ cookie: TEST_COOKIE, capturedAt });
    expect(await getCredentialCapturedAt('0004')).toBe(capturedAt);
  });

  it('never stores the cookie in plaintext', async () => {
    await captureCredential('0004', TEST_COOKIE);
    const stored = redisStore.get('autocut:cred:0004');
    expect(stored).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain(TEST_COOKIE);
  });

  it('accepts a direct 32-byte base64 key without scrypt derivation', async () => {
    const rawKey = Buffer.alloc(32, 7).toString('base64');
    vi.stubEnv('AUTOCUT_CRED_KEY', rawKey);
    const capturedAt = await captureCredential('0005', TEST_COOKIE);
    expect(capturedAt).not.toBeNull();
    expect((await readCredential('0005'))?.cookie).toBe(TEST_COOKIE);
  });

  it('no-ops gracefully (never throws) when AUTOCUT_CRED_KEY is unset', async () => {
    vi.stubEnv('AUTOCUT_CRED_KEY', '');
    delete process.env.AUTOCUT_CRED_KEY;

    await expect(captureCredential('0004', TEST_COOKIE)).resolves.toBeNull();
    expect(redisStore.size).toBe(0);
    await expect(readCredential('0004')).resolves.toBeNull();
  });

  it('no-ops gracefully when Redis is unconfigured', async () => {
    redisAvailable = false;
    await expect(captureCredential('0004', TEST_COOKIE)).resolves.toBeNull();
    await expect(readCredential('0004')).resolves.toBeNull();
    await expect(deleteCredential('0004')).resolves.toBeUndefined();
  });

  it('skips capture for an empty cookie value', async () => {
    expect(await captureCredential('0004', '')).toBeNull();
    expect(redisStore.size).toBe(0);
  });

  it('returns null (not garbage, no throw) when decrypting with a rotated key', async () => {
    await captureCredential('0004', TEST_COOKIE);
    vi.stubEnv('AUTOCUT_CRED_KEY', 'a-different-key-after-rotation');
    expect(await readCredential('0004')).toBeNull();
  });

  it('returns null for a tampered ciphertext', async () => {
    await captureCredential('0004', TEST_COOKIE);
    const record = redisStore.get('autocut:cred:0004') as { data: string };
    record.data = Buffer.from('tampered-bytes').toString('base64');
    expect(await readCredential('0004')).toBeNull();
  });

  it('binds the envelope to its franchise (AAD): transplanting A\'s envelope to B fails decrypt', async () => {
    await captureCredential('0004', TEST_COOKIE);
    const envelope = redisStore.get('autocut:cred:0004');
    // Same key (env unchanged), but stored under a different franchise: the
    // GCM AAD (= franchise id) no longer matches → treated as missing.
    redisStore.set('autocut:cred:0005', envelope);
    expect(await readCredential('0005')).toBeNull();
    // The original franchise still decrypts fine.
    expect((await readCredential('0004'))?.cookie).toBe(TEST_COOKIE);
  });

  it('writes a v2 (franchise-bound) envelope', async () => {
    await captureCredential('0004', TEST_COOKIE);
    expect((redisStore.get('autocut:cred:0004') as { v: number }).v).toBe(2);
  });

  it('deleteCredential removes the stored record', async () => {
    await captureCredential('0004', TEST_COOKIE);
    await deleteCredential('0004');
    expect(redisStore.has('autocut:cred:0004')).toBe(false);
    expect(await readCredential('0004')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Freshness threshold
// ---------------------------------------------------------------------------

describe('autocut-storage — isCredentialFresh', () => {
  const now = new Date('2026-08-01T12:00:00Z');
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

  it('defaults the threshold to 30 days', () => {
    expect(CREDENTIAL_MAX_AGE_DAYS).toBe(30);
  });

  it('is fresh just inside the threshold and stale just outside', () => {
    expect(isCredentialFresh(daysAgo(0), 30, now)).toBe(true);
    expect(isCredentialFresh(daysAgo(29), 30, now)).toBe(true);
    expect(isCredentialFresh(daysAgo(30), 30, now)).toBe(true); // boundary: exactly 30d is still fresh
    expect(isCredentialFresh(daysAgo(31), 30, now)).toBe(false);
  });

  it('honors a custom maxAgeDays', () => {
    expect(isCredentialFresh(daysAgo(5), 7, now)).toBe(true);
    expect(isCredentialFresh(daysAgo(8), 7, now)).toBe(false);
  });

  it('treats missing, malformed, and future timestamps as stale', () => {
    expect(isCredentialFresh(null, 30, now)).toBe(false);
    expect(isCredentialFresh(undefined, 30, now)).toBe(false);
    expect(isCredentialFresh('not-a-date', 30, now)).toBe(false);
    expect(isCredentialFresh(daysAgo(-1), 30, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// /api/autocut-list route
// ---------------------------------------------------------------------------

describe('/api/autocut-list — auth and storage gates', () => {
  it('GET and POST return 401 without a session', async () => {
    expect((await GET(makeContext(getRequest()))).status).toBe(401);
    expect(
      (await POST(makeContext(postRequest({ year: CURRENT_YEAR, playerIds: [] })))).status,
    ).toBe(401);
  });

  it('returns 403 for a session with no franchiseId', async () => {
    const cookie = sessionCookieFor('');
    expect((await GET(makeContext(getRequest(cookie)))).status).toBe(403);
    expect(
      (await POST(makeContext(postRequest({ year: CURRENT_YEAR, playerIds: [] }, cookie)))).status,
    ).toBe(403);
  });

  it('returns 503 when Redis is unconfigured', async () => {
    redisAvailable = false;
    const cookie = sessionCookieFor();
    expect((await GET(makeContext(getRequest(cookie)))).status).toBe(503);
    expect(
      (await POST(makeContext(postRequest({ year: CURRENT_YEAR, playerIds: ['1'] }, cookie)))).status,
    ).toBe(503);
  });
});

describe('/api/autocut-list — GET', () => {
  it('returns { data: null } when no list is saved', async () => {
    const res = await GET(makeContext(getRequest(sessionCookieFor())));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
  });

  it('returns the saved list for the session franchise', async () => {
    mockLiveMflCookie();
    const cookie = sessionCookieFor('0003');
    await POST(makeContext(postRequest({ year: CURRENT_YEAR, playerIds: ['101', '202'] }, cookie)));

    const res = await GET(makeContext(getRequest(cookie)));
    const body = await res.json();
    expect(body.data.year).toBe(CURRENT_YEAR);
    expect(body.data.playerIds).toEqual(['101', '202']);
  });
});

describe('/api/autocut-list — POST validation', () => {
  const cookie = sessionCookieFor();

  it('rejects a stale/wrong year with 400 (and never hits MFL)', async () => {
    const res = await POST(
      makeContext(postRequest({ year: CURRENT_YEAR - 1, playerIds: ['1'] }, cookie)),
    );
    expect(res.status).toBe(400);
    expect(mflFetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric year (string year) with 400', async () => {
    const res = await POST(
      makeContext(postRequest({ year: String(CURRENT_YEAR), playerIds: ['1'] }, cookie)),
    );
    expect(res.status).toBe(400);
  });

  it('rejects a non-array playerIds with 400', async () => {
    const res = await POST(makeContext(postRequest({ year: CURRENT_YEAR, playerIds: 'x' }, cookie)));
    expect(res.status).toBe(400);
  });

  it('rejects non-player-id entries with 400', async () => {
    for (const bad of [[123], ['abc'], ['12; DROP'], ['']]) {
      const res = await POST(makeContext(postRequest({ year: CURRENT_YEAR, playerIds: bad }, cookie)));
      expect(res.status).toBe(400);
    }
  });

  it('caps the list at 40 entries with 400', async () => {
    const playerIds = Array.from({ length: 41 }, (_, i) => String(1000 + i));
    const res = await POST(makeContext(postRequest({ year: CURRENT_YEAR, playerIds }, cookie)));
    expect(res.status).toBe(400);
  });
});

describe('/api/autocut-list — step-up auth (save-time credential guarantee)', () => {
  const cookie = sessionCookieFor('0003');

  it('returns 401 { requiresReauth: true } for a dead MFL cookie and persists NOTHING', async () => {
    mockDeadMflCookie();
    const res = await POST(
      makeContext(postRequest({ year: CURRENT_YEAR, playerIds: ['101'] }, cookie)),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).requiresReauth).toBe(true);
    expect(redisStore.size).toBe(0);
  });

  it('returns 401 { requiresReauth: true } when the MFL validation fetch throws', async () => {
    mflFetchMock.mockRejectedValue(new Error('network down'));
    const res = await POST(
      makeContext(postRequest({ year: CURRENT_YEAR, playerIds: ['101'] }, cookie)),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).requiresReauth).toBe(true);
    expect(redisStore.size).toBe(0);
  });

  it('on success persists the list AND refreshes the encrypted credential', async () => {
    mockLiveMflCookie();
    const res = await POST(
      makeContext(postRequest({ year: CURRENT_YEAR, playerIds: ['101', '202', '101'] }, cookie)),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.playerIds).toEqual(['101', '202']); // deduped, order kept
    expect(body.credentialStored).toBe(true);
    expect(Date.parse(body.credentialCapturedAt)).not.toBeNaN();

    // Credential landed in Redis, encrypted, decryptable server-side.
    expect(redisStore.has('autocut:cred:0003')).toBe(true);
    expect((await readCredential('0003'))?.cookie).toBe(TEST_COOKIE);
  });

  it('still saves the list (credentialStored: false) when AUTOCUT_CRED_KEY is unset', async () => {
    vi.stubEnv('AUTOCUT_CRED_KEY', '');
    delete process.env.AUTOCUT_CRED_KEY;
    mockLiveMflCookie();

    const res = await POST(
      makeContext(postRequest({ year: CURRENT_YEAR, playerIds: ['101'] }, cookie)),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.credentialStored).toBe(false);
    expect(body.credentialCapturedAt).toBeNull();
    expect(redisStore.has('autocut:0003')).toBe(true);
    expect(redisStore.has('autocut:cred:0003')).toBe(false);
  });
});

describe('/api/autocut-list — credential never crosses the response boundary', () => {
  it('no response (GET or POST) ever contains the MFL cookie or ciphertext', async () => {
    mockLiveMflCookie();
    const cookie = sessionCookieFor('0003');

    const postRes = await POST(
      makeContext(postRequest({ year: CURRENT_YEAR, playerIds: ['101'] }, cookie)),
    );
    const postText = await postRes.text();
    expect(postText).not.toContain(TEST_COOKIE);

    const stored = redisStore.get('autocut:cred:0003') as { data: string; tag: string; iv: string };
    expect(postText).not.toContain(stored.data);
    expect(postText).not.toContain(stored.tag);

    const getRes = await GET(makeContext(getRequest(cookie)));
    const getText = await getRes.text();
    expect(getText).not.toContain(TEST_COOKIE);
    expect(getText).not.toContain(stored.data);

    // Shape check: the POST body exposes only whitelisted keys.
    const postBody = JSON.parse(postText);
    expect(Object.keys(postBody).sort()).toEqual([
      'credentialCapturedAt',
      'credentialStored',
      'data',
      'success',
    ]);
    expect(Object.keys(postBody.data).sort()).toEqual(['playerIds', 'updatedAt', 'year']);
  });
});
