/**
 * GroupMe service-token health probe.
 *
 * The bug this pins: `!!process.env.GROUPME_SERVICE_TOKEN` reported the token
 * as healthy for as long as it was a non-empty string. When the Vercel copy
 * was revoked (Sept 2026) the admin dashboard stayed green while every GroupMe
 * read came back 401. "Set" and "accepted" are different questions, and the
 * health probe must answer the second one.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkServiceTokenHealth,
  resetServiceTokenHealthCache,
} from '../src/utils/groupme-client';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const ORIGINAL_SERVICE = process.env.GROUPME_SERVICE_TOKEN;
const ORIGINAL_ACCESS = process.env.GROUPME_ACCESS_TOKEN;

/** The probe authenticates by header, so tests read the token from there. */
const sentToken = (init?: RequestInit): string =>
  String((init?.headers as Record<string, string> | undefined)?.['X-Access-Token'] ?? '');

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(impl(String(input), init)),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

const okUser = (name = 'Schefter Bot') =>
  new Response(JSON.stringify({ response: { id: '123', name, image_url: null }, meta: { code: 200 } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const unauthorized = () =>
  new Response(JSON.stringify({ meta: { code: 401, errors: ['unauthorized'] } }), { status: 401 });

beforeEach(() => {
  resetServiceTokenHealthCache();
  delete process.env.GROUPME_SERVICE_TOKEN;
  delete process.env.GROUPME_ACCESS_TOKEN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetServiceTokenHealthCache();
  if (ORIGINAL_SERVICE === undefined) delete process.env.GROUPME_SERVICE_TOKEN;
  else process.env.GROUPME_SERVICE_TOKEN = ORIGINAL_SERVICE;
  if (ORIGINAL_ACCESS === undefined) delete process.env.GROUPME_ACCESS_TOKEN;
  else process.env.GROUPME_ACCESS_TOKEN = ORIGINAL_ACCESS;
});

describe('checkServiceTokenHealth', () => {
  it('reports not-set without calling GroupMe when no token is configured', async () => {
    const spy = mockFetch(() => okUser());

    const health = await checkServiceTokenHealth();

    expect(health.state).toBe('not-set');
    expect(health.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports rejected — not valid — for a revoked token that is still a truthy string', async () => {
    process.env.GROUPME_SERVICE_TOKEN = 'revoked-but-truthy';
    mockFetch(() => unauthorized());

    const health = await checkServiceTokenHealth();

    expect(health.state).toBe('rejected');
    expect(health.ok).toBe(false);
    expect(health.httpStatus).toBe(401);
    // The old presence check would have said "configured" here.
    expect(!!process.env.GROUPME_SERVICE_TOKEN).toBe(true);
  });

  it('reports valid when GroupMe accepts the token', async () => {
    process.env.GROUPME_SERVICE_TOKEN = 'good-token';
    const spy = mockFetch((url, init) => {
      // The credential travels in a header, never in the URL — see the leak
      // note below.
      expect(url).toBe('https://api.groupme.com/v3/users/me');
      expect(sentToken(init)).toBe('good-token');
      return okUser('Brandon');
    });

    const health = await checkServiceTokenHealth();

    expect(health.state).toBe('valid');
    expect(health.ok).toBe(true);
    expect(health.userName).toBe('Brandon');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('never reports valid on a network failure, and never claims the token is bad either', async () => {
    process.env.GROUPME_SERVICE_TOKEN = 'good-token';
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ETIMEDOUT'))));

    const health = await checkServiceTokenHealth();

    expect(health.state).toBe('unreachable');
    expect(health.ok).toBe(false);
    expect(health.detail).toContain('ETIMEDOUT');
  });

  it('treats a 403 as a rejected credential', async () => {
    process.env.GROUPME_SERVICE_TOKEN = 'good-token';
    mockFetch(() => new Response('forbidden', { status: 403 }));

    expect((await checkServiceTokenHealth()).state).toBe('rejected');
  });

  it('falls back to GROUPME_ACCESS_TOKEN, matching the client', async () => {
    process.env.GROUPME_ACCESS_TOKEN = 'fallback-token';
    mockFetch((_url, init) => {
      expect(sentToken(init)).toBe('fallback-token');
      return okUser();
    });

    expect((await checkServiceTokenHealth()).state).toBe('valid');
  });

  it('caches so a polling dashboard does not hammer GroupMe', async () => {
    process.env.GROUPME_SERVICE_TOKEN = 'good-token';
    const spy = mockFetch(() => okUser());

    await checkServiceTokenHealth();
    await checkServiceTokenHealth();
    await Promise.all([checkServiceTokenHealth(), checkServiceTokenHealth()]);

    expect(spy).toHaveBeenCalledOnce();
  });

  it('re-probes immediately when the token is rotated, rather than serving a stale verdict', async () => {
    process.env.GROUPME_SERVICE_TOKEN = 'revoked';
    const spy = mockFetch((_url, init) => (sentToken(init) === 'revoked' ? unauthorized() : okUser()));

    expect((await checkServiceTokenHealth()).state).toBe('rejected');

    process.env.GROUPME_SERVICE_TOKEN = 'rotated';
    expect((await checkServiceTokenHealth()).state).toBe('valid');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('never leaks the token into detail, even when the error message quotes the URL', async () => {
    process.env.GROUPME_SERVICE_TOKEN = 'super-secret-token';
    // Node really does this: `fetch('ht!tp://…?token=SECRET')` rejects with
    // "Failed to parse URL from ht!tp://…?token=SECRET". `detail` is returned
    // as JSON and rendered on the admin dashboard, so it must not carry it.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.reject(
          new Error('Failed to parse URL from https://api.groupme.com/v3/users/me?token=super-secret-token'),
        ),
      ),
    );

    const health = await checkServiceTokenHealth();

    expect(health.state).toBe('unreachable');
    expect(health.detail).not.toContain('super-secret-token');
    expect(health.detail).toContain('[redacted]');
    expect(JSON.stringify(health)).not.toContain('super-secret-token');
  });

  it('a slow probe does not overwrite a fresher verdict that landed first', async () => {
    process.env.GROUPME_SERVICE_TOKEN = 'good-token';

    // First probe hangs; the forced re-check answers immediately. The stale
    // one then resolves LAST and must not clobber the newer cached result.
    let releaseSlow: (r: Response) => void = () => {};
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        call += 1;
        if (call === 1) return new Promise<Response>((res) => { releaseSlow = res; });
        return Promise.resolve(okUser('Fresh'));
      }),
    );

    const slow = checkServiceTokenHealth();
    const fresh = await checkServiceTokenHealth({ force: true });
    expect(fresh.userName).toBe('Fresh');

    releaseSlow(unauthorized());
    // The stale caller still gets the answer to the probe it asked for…
    expect((await slow).state).toBe('rejected');
    // …but the shared cache keeps the newer verdict.
    expect((await checkServiceTokenHealth()).userName).toBe('Fresh');
  });

  it('honors force, bypassing the cache for an explicit re-check', async () => {
    process.env.GROUPME_SERVICE_TOKEN = 'good-token';
    const spy = mockFetch(() => okUser());

    await checkServiceTokenHealth();
    await checkServiceTokenHealth({ force: true });

    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('the surfaces that report GroupMe health', () => {
  it('the admin dashboard renders the probed state, not env presence', () => {
    const src = read('../src/components/schefter/AdminDashboard.astro');

    // The presence flag must not be back in the generic SET/missing list —
    // that list is what rendered a revoked token as green "SET".
    expect(src).not.toMatch(/\['groupmeTokenConfigured',/);

    for (const state of ['valid', 'rejected', 'not-set', 'unreachable']) {
      expect(src).toContain(`'${state}':`);
    }
    // The revoked row has to tell the reader where to go fix it.
    expect(src).toContain('https://dev.groupme.com/');
  });

  it('the stats endpoint ships the probe result alongside the presence flag', () => {
    const src = read('../src/pages/api/admin/schefter-stats.ts');
    expect(src).toContain('checkServiceTokenHealth');
    expect(src).toContain('groupmeToken');
  });

  it('the sync route no longer guards on presence alone', () => {
    const src = read('../src/pages/api/groupme/sync.ts');
    expect(src).toContain('checkServiceTokenHealth');
    // Comments stripped first — the file explains the old guard in prose, and
    // the point of this assertion is that no CODE reads presence as health.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/process\.env\.GROUPME_SERVICE_TOKEN/);
    // "not configured" must stay a distinct outcome from "rejected".
    expect(src).toContain("'not-set'");
    expect(src).toContain("'rejected'");
  });
});

describe('operator-facing messages name the variable actually in play', () => {
  const ORIG_S = process.env.GROUPME_SERVICE_TOKEN;
  const ORIG_A = process.env.GROUPME_ACCESS_TOKEN;
  afterEach(() => {
    vi.unstubAllGlobals();
    resetServiceTokenHealthCache();
    if (ORIG_S === undefined) delete process.env.GROUPME_SERVICE_TOKEN;
    else process.env.GROUPME_SERVICE_TOKEN = ORIG_S;
    if (ORIG_A === undefined) delete process.env.GROUPME_ACCESS_TOKEN;
    else process.env.GROUPME_ACCESS_TOKEN = ORIG_A;
  });

  it('reports GROUPME_SERVICE_TOKEN as the source when it supplied the token', async () => {
    delete process.env.GROUPME_ACCESS_TOKEN;
    process.env.GROUPME_SERVICE_TOKEN = 'primary';
    mockFetch(() => okUser());
    expect((await checkServiceTokenHealth()).source).toBe('GROUPME_SERVICE_TOKEN');
  });

  it('reports the ACCESS fallback as the source when it is what is actually in use', async () => {
    delete process.env.GROUPME_SERVICE_TOKEN;
    process.env.GROUPME_ACCESS_TOKEN = 'fallback';
    mockFetch(() => unauthorized());

    const health = await checkServiceTokenHealth();

    // A revoked-token row that told the admin to rotate GROUPME_SERVICE_TOKEN
    // here would send them to a variable that is not set at all.
    expect(health.state).toBe('rejected');
    expect(health.source).toBe('GROUPME_ACCESS_TOKEN');
  });

  it('names both variables when neither is set', async () => {
    delete process.env.GROUPME_SERVICE_TOKEN;
    delete process.env.GROUPME_ACCESS_TOKEN;

    const health = await checkServiceTokenHealth();

    expect(health.state).toBe('not-set');
    expect(health.detail).toContain('GROUPME_SERVICE_TOKEN');
    expect(health.detail).toContain('GROUPME_ACCESS_TOKEN');
    expect(health.source).toBeUndefined();
  });

  it('the stats presence flag counts the ACCESS fallback too', () => {
    const src = read('../src/pages/api/admin/schefter-stats.ts');
    const flag = src.match(/groupmeTokenConfigured:.*/)?.[0] ?? '';
    expect(flag).toContain('GROUPME_ACCESS_TOKEN');
  });

  it('the dashboard label and the sync hint use the reported source, not a literal', () => {
    const dash = read('../src/components/schefter/AdminDashboard.astro');
    expect(dash).toContain('gmToken?.source');
    const sync = read('../src/pages/api/groupme/sync.ts');
    expect(sync).toContain('tokenHealth.source');
  });
});
