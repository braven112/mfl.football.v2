/**
 * The preferences API, and the enforcement point inside sendPushToFranchise.
 *
 * The sender test is the important half: preferences honoured in the settings
 * page but not in the sender would be worse than none at all — an owner turns
 * something off, watches it keep arriving, and stops trusting the page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionToken } from '../src/utils/session';
import { LEAGUES } from '../src/config/leagues';

const store = new Map<string, unknown>();
const hashes = new Map<string, Map<string, string>>();
let redisAvailable = true;

vi.mock('../src/utils/redis-client', () => ({
  getRedis: async () =>
    redisAvailable
      ? {
          get: async (k: string) => store.get(k) ?? null,
          set: async (k: string, v: unknown) => {
            store.set(k, v);
            return 'OK';
          },
          hgetall: async (k: string) => {
            const h = hashes.get(k);
            return h ? Object.fromEntries(h) : null;
          },
          hset: async (k: string, fv: Record<string, unknown>) => {
            const h = hashes.get(k) ?? new Map();
            for (const [f, v] of Object.entries(fv)) h.set(f, JSON.stringify(v));
            hashes.set(k, h);
            return 1;
          },
          hdel: async () => 1,
          incr: async () => 1,
          expire: async () => 1,
        }
      : null,
}));

// Push is "configured" so the sender runs its filter rather than bailing.
const sendNotification = vi.fn(async () => undefined);
vi.mock('web-push', () => ({
  default: { sendNotification: (...a: unknown[]) => sendNotification(...(a as [])) },
}));

import { GET, POST } from '../src/pages/api/push/preferences';
import { preferencesKey } from '../src/utils/push-preferences';
import { subscriptionsKey } from '../src/utils/push-subscriptions';
import { sendPushToFranchise } from '../src/utils/push-sender';

const THELEAGUE = LEAGUES.theleague;

function cookie(franchiseId = '0003', leagueId = THELEAGUE.id) {
  return `session_token=${createSessionToken({
    userId: 'u',
    username: 'Owner',
    franchiseId,
    leagueId,
    role: 'owner',
  })}`;
}

const ctx = (request: Request) => ({ request, url: new URL(request.url) }) as any;
const req = (init: RequestInit = {}, c: string | null = cookie()) =>
  new Request('http://test.invalid/api/push/preferences', {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}) },
  });

beforeEach(() => {
  store.clear();
  hashes.clear();
  redisAvailable = true;
  sendNotification.mockClear();
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});

describe('GET /api/push/preferences', () => {
  it('returns groups, categories and the effective values', async () => {
    const body = await (await GET(ctx(req()))).json();
    expect(body.groups.length).toBeGreaterThan(0);
    expect(body.categories.length).toBeGreaterThan(0);
    expect(body.preferences['trade-offer']).toBe(true);
    expect(body.preferences['article']).toBe(false);
  });

  it('never offers the hidden system category', async () => {
    const body = await (await GET(ctx(req()))).json();
    expect(body.categories.some((c: { id: string }) => c.id === 'system-test')).toBe(false);
  });

  it('requires a session', async () => {
    expect((await GET(ctx(req({}, null)))).status).toBe(401);
  });
});

describe('POST /api/push/preferences', () => {
  it('saves explicit choices and returns the new effective map', async () => {
    const res = await POST(
      ctx(req({ method: 'POST', body: JSON.stringify({ preferences: { article: true } }) })),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preferences['article']).toBe(true);
    expect(JSON.parse(store.get(preferencesKey(THELEAGUE.id, '0003')) as string)).toEqual({
      article: true,
    });
  });

  it('drops categories this league does not offer', async () => {
    // Otherwise an owner could store a preference for a feature-gated category
    // that would silently apply if the feature were ever switched on.
    await POST(
      ctx(
        req({
          method: 'POST',
          body: JSON.stringify({ preferences: { bogus: true, 'system-test': false } }),
        }),
      ),
    );
    expect(JSON.parse(store.get(preferencesKey(THELEAGUE.id, '0003')) as string)).toEqual({});
  });

  it('scopes to the session franchise, not anything in the body', async () => {
    await POST(
      ctx(
        req({
          method: 'POST',
          body: JSON.stringify({ franchiseId: '0011', preferences: { column: true } }),
        }),
      ),
    );
    expect(store.has(preferencesKey(THELEAGUE.id, '0003'))).toBe(true);
    expect(store.has(preferencesKey(THELEAGUE.id, '0011'))).toBe(false);
  });

  it('reports a storage outage instead of claiming success', async () => {
    redisAvailable = false;
    const res = await POST(
      ctx(req({ method: 'POST', body: JSON.stringify({ preferences: { column: true } }) })),
    );
    expect(res.status).toBe(503);
  });

  it('requires a session', async () => {
    expect(
      (await POST(ctx(req({ method: 'POST', body: '{}' }, null)))).status,
    ).toBe(401);
  });
});

describe('sendPushToFranchise honours preferences', () => {
  function configurePush() {
    process.env.VAPID_PUBLIC_KEY = 'pub';
    process.env.VAPID_PRIVATE_KEY = 'priv';
    hashes.set(
      subscriptionsKey(THELEAGUE.id, '0003'),
      new Map([['h1', JSON.stringify({ endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } })]]),
    );
  }

  it('sends a category that is on', async () => {
    configurePush();
    const result = await sendPushToFranchise(THELEAGUE.id, '0003', { title: 't', body: 'b' }, 'trade-offer');
    expect(result.total).toBe(1);
  });

  it('does NOT send a category the owner turned off', async () => {
    configurePush();
    store.set(preferencesKey(THELEAGUE.id, '0003'), JSON.stringify({ 'trade-offer': false }));
    const result = await sendPushToFranchise(THELEAGUE.id, '0003', { title: 't', body: 'b' }, 'trade-offer');
    expect(result.total).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('does not send a default-off category the owner never enabled', async () => {
    configurePush();
    const result = await sendPushToFranchise(THELEAGUE.id, '0003', { title: 't', body: 'b' }, 'article');
    expect(result.total).toBe(0);
  });

  it('REFUSES an unknown category rather than sending anyway', async () => {
    configurePush();
    const result = await sendPushToFranchise(THELEAGUE.id, '0003', { title: 't', body: 'b' }, 'typo');
    expect(result.total).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('refuses a league it cannot resolve', async () => {
    configurePush();
    const result = await sendPushToFranchise('not-a-league', '0003', { title: 't', body: 'b' }, 'trade-offer');
    expect(result.total).toBe(0);
  });
});
