/**
 * `dispatchWorkflow` is the single door all three Vercel-cron bridges go
 * through, so its refusals are the contract — not an implementation detail.
 *
 * Every other guard over this code reads SOURCE TEXT:
 * `tests/vercel-cron-targets.test.ts` proves each route names `CRON_SECRET`
 * and bails on a falsy one, and `tests/staging-outbound-guard.test.ts` proves
 * this file calls the deployment guard at all. Neither one ever calls the
 * function, so both would stay green if the guard were called and its answer
 * ignored, or if a refusal returned 200. That is the gap this file closes, and
 * it matters more than it would for an ordinary helper because two of the four
 * branches are the security ones:
 *
 *  - **no `GH_PAT`** must say so rather than fall through to a 401 from GitHub
 *    that reads like a cron misconfiguration;
 *  - **a non-production deployment** must refuse outright. Staging and every
 *    PR preview carry production's `GH_PAT`, so a bridge that dispatched from
 *    a preview would start a workflow that commits to `main` and posts to the
 *    real GroupMe.
 *
 * The order matters too, and is asserted: a deployment that may not dispatch
 * must not reach the network even when it is fully credentialed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { dispatchWorkflow } from '../src/utils/workflow-dispatch';

/** Run `fn` with VERCEL_ENV / GH_PAT set, restoring both afterwards. */
async function withEnv<T>(
  env: { vercelEnv?: string | undefined; ghPat?: string | undefined },
  fn: () => Promise<T>,
): Promise<T> {
  const prevVercel = process.env.VERCEL_ENV;
  const prevPat = process.env.GH_PAT;
  const set = (key: 'VERCEL_ENV' | 'GH_PAT', value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  set('VERCEL_ENV', env.vercelEnv);
  set('GH_PAT', env.ghPat);
  try {
    return await fn();
  } finally {
    set('VERCEL_ENV', prevVercel);
    set('GH_PAT', prevPat);
  }
}

/** A production deployment holding a token — the only state that dispatches. */
const LIVE = { vercelEnv: 'production', ghPat: 'ghp_test' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('dispatchWorkflow — refusals', () => {
  it('500s with no GH_PAT, and never calls GitHub', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = await withEnv({ vercelEnv: 'production', ghPat: undefined }, () =>
      dispatchWorkflow('roster-sync.yml'),
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: 'GH_PAT not configured' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('503s on a preview deployment EVEN WITH a valid token, and never calls GitHub', async () => {
    // The important half: previews carry production's credentials, so "has a
    // token" must not be mistaken for "may dispatch".
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = await withEnv({ vercelEnv: 'preview', ghPat: 'ghp_test' }, () =>
      dispatchWorkflow('schefter-scan.yml'),
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/disabled on this deployment/i);
    // Names the workflow it refused, so a log line says which bridge went quiet.
    expect(body.detail).toContain('schefter-scan.yml');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a staging deployment too', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = await withEnv({ vercelEnv: 'development', ghPat: 'ghp_test' }, () =>
      dispatchWorkflow('groupme-sync.yml'),
    );

    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('dispatchWorkflow — the GitHub call', () => {
  it('POSTs the right workflow, ref and headers, and reports success', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);

    const res = await withEnv(LIVE, () => dispatchWorkflow('groupme-sync.yml'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      triggered: 'groupme-sync.yml',
    });

    const [url, init] = fetchSpy.mock.calls[0];
    // The workflow FILE is part of the URL — a bridge pointed at the wrong one
    // is a 404 on a schedule nobody reads.
    expect(url).toContain('/actions/workflows/groupme-sync.yml/dispatches');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer ghp_test');
    // Typed, because the body is JSON — see the comment at the call site.
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ ref: 'main' });
  });

  it('sends inputs only when given them, and honours a custom ref', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);

    await withEnv(LIVE, () =>
      dispatchWorkflow('roster-sync.yml', { ref: 'staging', inputs: { dry_run: 'true' } }),
    );

    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({
      ref: 'staging',
      inputs: { dry_run: 'true' },
    });
  });

  it('502s on a GitHub error, passing the status through', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('Bad credentials', { status: 401 }));
    vi.stubGlobal('fetch', fetchSpy);

    const res = await withEnv(LIVE, () => dispatchWorkflow('roster-sync.yml'));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({
      error: 'GitHub API error',
      status: 401,
    });
  });

  it('502s on a THROWN fetch rather than letting it surface as a 500', async () => {
    // An abort, DNS failure or TLS error is the same class of outcome as a 5xx
    // from GitHub. Unhandled, it would reach the route as a 500 with no hint of
    // which hop failed.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('terminated')));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await withEnv(LIVE, () => dispatchWorkflow('schefter-scan.yml'));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ error: 'GitHub dispatch failed', workflow: 'schefter-scan.yml' });
    // The cause is logged, never returned — CodeQL flagged the returned form as
    // information exposure through a stack trace, and the body is not where
    // anyone reads it anyway.
    expect(JSON.stringify(body)).not.toContain('terminated');
    expect(console.error).toHaveBeenCalled();
  });

  it('never caches a dispatch response', async () => {
    // These are state-changing POSTs behind a cron; a cached 200 would read as
    // "dispatched" for a tick that never was.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const res = await withEnv(LIVE, () => dispatchWorkflow('roster-sync.yml'));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
