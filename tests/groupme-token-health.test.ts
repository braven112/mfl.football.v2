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

function mockFetch(impl: (url: string) => Promise<Response> | Response) {
  const spy = vi.fn((input: RequestInfo | URL) => Promise.resolve(impl(String(input))));
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
    const spy = mockFetch((url) => {
      expect(url).toContain('/v3/users/me?token=good-token');
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
    mockFetch((url) => {
      expect(url).toContain('token=fallback-token');
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
    const spy = mockFetch((url) => (url.includes('token=revoked') ? unauthorized() : okUser()));

    expect((await checkServiceTokenHealth()).state).toBe('rejected');

    process.env.GROUPME_SERVICE_TOKEN = 'rotated';
    expect((await checkServiceTokenHealth()).state).toBe('valid');
    expect(spy).toHaveBeenCalledTimes(2);
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
