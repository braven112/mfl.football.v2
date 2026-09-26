/**
 * Custom-site demo leads (docs/plans/custom-site-demo.md, phase 3): the
 * questionnaire on the demo, the signed relay to production, and the link
 * actions production sends back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const zsets = new Map<string, Map<string, number>>();
const fakeRedis = {
  get: async (k: string) => store.get(k) ?? null,
  set: async (k: string, v: string) => (store.set(k, v), 'OK'),
  del: async (k: string) => (store.delete(k) ? 1 : 0),
  zadd: async (k: string, { score, member }: { score: number; member: string }) => {
    const z = zsets.get(k) ?? new Map();
    z.set(member, score);
    zsets.set(k, z);
    return 1;
  },
  zrevrangebyscore: async (k: string) =>
    [...(zsets.get(k) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m),
};
vi.mock('../src/utils/redis-client', () => ({ getRedis: async () => fakeRedis }));
const pushes: unknown[][] = [];
vi.mock('../src/utils/push-sender', () => ({
  sendPushToFranchise: async (...args: unknown[]) => (pushes.push(args), { sent: 1, failed: 0, pruned: 0, total: 1 }),
}));
vi.mock('../src/utils/rate-limit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));

const core = await import('../src/utils/demo-leads-core.mjs');

const GOOD = {
  name: 'Pat Prospect',
  email: 'pat@example.com',
  leagueName: 'Acme Dynasty',
  platform: 'mfl',
  format: 'dynasty',
  draftType: 'auction',
  teams: '14',
  salaryCap: true,
  contracts: true,
  conferences: false,
  wishlist: 'Contract tools and a draft room.',
};

const ENV = ['DEMO_PROFILE', 'DEMO_LEAD_RELAY_SECRET', 'DEMO_LEAD_RELAY_URL'] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
beforeEach(() => {
  store.clear();
  zsets.clear();
  pushes.length = 0;
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe('questionnaire', () => {
  it('accepts a complete answer and coerces its types', () => {
    const r = core.validateQuestionnaire(GOOD);
    expect((r as { lead: object }).lead).toMatchObject({ teams: 14, salaryCap: true, conferences: false, platform: 'mfl' });
  });

  it('reports each problem by field, and never throws on junk', () => {
    const r = core.validateQuestionnaire({ ...GOOD, email: 'nope', teams: '2', format: 'chaos', name: '' });
    expect('errors' in r && Object.keys(r.errors).sort()).toEqual(['email', 'format', 'name', 'teams']);
    expect('errors' in core.validateQuestionnaire(null)).toBe(true);
    expect('errors' in core.validateQuestionnaire('x')).toBe(true);
  });

  it('spots the honeypot', () => {
    expect(core.isBotSubmission({ ...GOOD, [core.HONEYPOT_FIELD]: 'http://spam' })).toBe(true);
    expect(core.isBotSubmission(GOOD)).toBe(false);
  });

  it('matches a league to the demo that fits, falling back to one that exists', () => {
    const lead = (over: object) => ({ ...(core.validateQuestionnaire(GOOD) as any).lead, ...over });
    expect(core.matchDemo(lead({}))).toEqual({ wanted: 'dynasty', path: 'dynasty' });
    expect(core.matchDemo(lead({ teams: 60 }))).toEqual({ wanted: 'bigleague', path: 'dynasty' });
    expect(core.matchDemo(lead({ format: 'bestball' }))).toEqual({ wanted: 'redraft', path: 'dynasty' });
    expect(core.matchDemo(lead({ format: 'keeper', salaryCap: false, contracts: false }))).toMatchObject({ wanted: 'keeper' });
    expect(core.matchDemo(lead({ teams: 60 }), ['dynasty', 'bigleague'])).toEqual({ wanted: 'bigleague', path: 'bigleague' });
  });
});

describe('signed relay', () => {
  it('verifies only a fresh signature over the exact body with the same secret', () => {
    const body = '{"a":1}';
    const sig = core.signRelayBody(body, 's3cret', 1000);
    expect(core.verifyRelaySignature(body, sig, 's3cret', 1000)).toBe(true);
    expect(core.verifyRelaySignature('{"a":2}', sig, 's3cret', 1000)).toBe(false);
    expect(core.verifyRelaySignature(body, sig, 'other', 1000)).toBe(false);
    expect(core.verifyRelaySignature(body, sig, 's3cret', 1000 + core.SIGNATURE_MAX_SKEW_SECONDS + 1)).toBe(false);
    expect(core.verifyRelaySignature(body, null, 's3cret', 1000)).toBe(false);
    expect(core.verifyRelaySignature(body, sig, '', 1000)).toBe(false);
  });
});

describe('demo: POST /api/demo/lead', () => {
  it('issues a link on the spot and relays the lead, signed', async () => {
    process.env.DEMO_PROFILE = 'dynasty';
    process.env.DEMO_LEAD_RELAY_SECRET = 'relay-secret';
    process.env.DEMO_LEAD_RELAY_URL = 'https://prod.example/api/demo-leads';
    const relayed: { url: string; body: string; sig: string | null }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      relayed.push({ url, body: String(init.body), sig: new Headers(init.headers).get(core.SIGNATURE_HEADER) });
      return new Response('{}', { status: 200 });
    });
    const { POST } = await import('../src/pages/api/demo/lead');
    const res = await POST({
      request: new Request('https://demo.mfl.football/api/demo/lead', { method: 'POST', body: JSON.stringify(GOOD) }),
    } as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.link).toMatch(/^https:\/\/demo\.mfl\.football\/dynasty\/demo-start\?t=[\w-]{16,}$/);
    expect(relayed).toHaveLength(1);
    expect(core.verifyRelaySignature(relayed[0].body, relayed[0].sig, 'relay-secret')).toBe(true);
    expect(JSON.parse(relayed[0].body)).toMatchObject({ email: 'pat@example.com', wanted: 'dynasty', path: 'dynasty' });
  });

  it('keeps the lead and still issues the link when the relay fails', async () => {
    process.env.DEMO_PROFILE = 'dynasty';
    process.env.DEMO_LEAD_RELAY_SECRET = 'relay-secret';
    vi.stubGlobal('fetch', async () => {
      throw new Error('network down');
    });
    const { POST } = await import('../src/pages/api/demo/lead');
    const res = await POST({
      request: new Request('https://demo.mfl.football/api/demo/lead', { method: 'POST', body: JSON.stringify(GOOD) }),
    } as never);
    expect((await res.json()).link).toContain('/dynasty/demo-start?t=');
    expect([...store.keys()].some((k) => k.startsWith('demo-leads:lead_'))).toBe(true);
  });

  it('does not exist off the demo', async () => {
    delete process.env.DEMO_PROFILE;
    const { POST } = await import('../src/pages/api/demo/lead');
    const res = await POST({ request: new Request('https://x/api/demo/lead', { method: 'POST', body: '{}' }) } as never);
    expect(res.status).toBe(404);
  });
});

describe('production: POST /api/demo-leads', () => {
  const lead = {
    id: 'lead_x_1',
    token: 'tok-aaaaaaaaaaaaaaaa',
    email: 'pat@example.com',
    name: 'Pat',
    leagueName: 'Acme',
    teams: 14,
    format: 'dynasty',
    createdAt: 100,
    expiresAt: 200,
  };

  it('stores a signed lead and pushes the owner', async () => {
    delete process.env.DEMO_PROFILE;
    process.env.DEMO_LEAD_RELAY_SECRET = 'relay-secret';
    const { POST } = await import('../src/pages/api/demo-leads/index');
    const body = JSON.stringify(lead);
    const res = await POST({
      request: new Request('https://prod/api/demo-leads', {
        method: 'POST',
        body,
        headers: { [core.SIGNATURE_HEADER]: core.signRelayBody(body, 'relay-secret') },
      }),
    } as never);
    expect(res.status).toBe(200);
    expect(JSON.parse(store.get('demo-leads:lead_x_1')!)).toMatchObject({ email: 'pat@example.com', source: 'questionnaire' });
    expect(pushes).toHaveLength(1);
    expect(pushes[0][1]).toBe('0001');
    expect(pushes[0][3]).toBe('ops-demo-lead');
    expect((pushes[0][2] as { url: string }).url).toBe('/admin/demo-leads');
  });

  it('refuses an unsigned or forged lead, and is absent on the demo', async () => {
    delete process.env.DEMO_PROFILE;
    process.env.DEMO_LEAD_RELAY_SECRET = 'relay-secret';
    const { POST } = await import('../src/pages/api/demo-leads/index');
    const body = JSON.stringify(lead);
    const forged = await POST({
      request: new Request('https://prod/api/demo-leads', {
        method: 'POST',
        body,
        headers: { [core.SIGNATURE_HEADER]: core.signRelayBody(body, 'guessed') },
      }),
    } as never);
    expect(forged.status).toBe(401);
    expect(store.size).toBe(0);
    process.env.DEMO_PROFILE = 'dynasty';
    const onDemo = await POST({ request: new Request('https://x/api/demo-leads', { method: 'POST', body }) } as never);
    expect(onDemo.status).toBe(404);
  });
});

describe('demo: POST /api/demo/links', () => {
  it('creates, extends and revokes links only for a signed caller', async () => {
    process.env.DEMO_PROFILE = 'dynasty';
    process.env.DEMO_LEAD_RELAY_SECRET = 'relay-secret';
    const { POST } = await import('../src/pages/api/demo/links');
    const call = (cmd: object, secret = 'relay-secret') => {
      const body = JSON.stringify(cmd);
      return POST({
        request: new Request('https://demo.mfl.football/api/demo/links', {
          method: 'POST',
          body,
          headers: { [core.SIGNATURE_HEADER]: core.signRelayBody(body, secret) },
        }),
      } as never);
    };
    expect((await call({ action: 'create', label: 'x' }, 'wrong')).status).toBe(401);
    const created = await (await call({ action: 'create', label: 'Pat — Acme', days: 7 })).json();
    expect(created.link).toContain('/dynasty/demo-start?t=');
    const extended = await (await call({ action: 'extend', token: created.token, days: 7 })).json();
    expect(extended.expiresAt).toBeGreaterThan(created.expiresAt);
    expect((await call({ action: 'revoke', token: created.token })).status).toBe(200);
    expect(store.has(`demo:tokens:${created.token}`)).toBe(false);
  });
});
