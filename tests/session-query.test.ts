/**
 * Session-query behavior tests.
 *
 * `/api/auth/me` answers 200 in BOTH directions — `{authenticated:false}` is
 * its considered answer that nobody is signed in. So the fact this file exists
 * to pin is that a FAILED request is not a logged-out user. Every call site
 * this store replaced got that wrong in the same way (TradeBuilder's
 * `.catch(() => {}) // Silent — user just isn't logged in` was the clearest
 * statement of it), and the symptom is an owner being downgraded to a
 * spectator, or bounced to /login by the PWA gate, because one request dropped.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ensureSession,
  invalidateSession,
  peekSession,
  sessionQuery,
  setSession,
  SESSION_STALE_MS,
  type SessionSnapshot,
} from '../src/utils/queries/session';

const AUTHED: SessionSnapshot = {
  authenticated: true,
  user: {
    userId: 'u1',
    username: 'Pacific Pigskins',
    franchiseId: '0001',
    leagueId: '13522',
    role: 'owner',
  },
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('sessionQuery', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // The store is a module singleton shared by every consumer on a page —
    // which is the point — so each test starts by clearing it.
    invalidateSession();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reports a signed-in owner', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(AUTHED)));
    const session = await ensureSession();
    expect(session.authenticated).toBe(true);
    expect(session.user?.franchiseId).toBe('0001');
  });

  it('reports a CONFIRMED signed-out visitor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ authenticated: false })));
    const session = await ensureSession();
    expect(session.authenticated).toBe(false);
    expect(session.user).toBeNull();
    // A confirmed answer, not a failure.
    expect(sessionQuery.getState(undefined).status).toBe('ok');
  });

  it('a failed request REJECTS instead of reporting a logged-out user', async () => {
    // The whole reason this module exists. A 500 must not resolve to
    // `authenticated: false`, or every caller signs the owner out.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    await expect(ensureSession()).rejects.toThrow('auth/me 500');
    expect(peekSession()).toBeNull();
  });

  it('a network failure REJECTS rather than resolving', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(ensureSession()).rejects.toThrow();
  });

  it('an unrecognized body REJECTS rather than being read as signed-out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ nonsense: true })));
    await expect(ensureSession()).rejects.toThrow(/unrecognized/);
  });

  it('KEEPS a signed-in session when a later refresh fails', async () => {
    // The owner is still signed in; we just could not confirm it this time.
    // Clearing here is what logs someone out on a flaky connection.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(AUTHED))
      .mockResolvedValue(jsonResponse({}, 503));
    vi.stubGlobal('fetch', fetchMock);

    await ensureSession();
    await vi.advanceTimersByTimeAsync(SESSION_STALE_MS + 1);
    const session = await ensureSession();

    expect(session.authenticated).toBe(true);
    expect(session.user?.franchiseId).toBe('0001');
    // ...and the failure is still visible to anything that wants to say so.
    expect(sessionQuery.getState(undefined).status).toBe('error');
  });

  it('collapses a burst of consumers into ONE request', async () => {
    // The page this replaced made up to four: two islands and two scripts.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(AUTHED));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([ensureSession(), ensureSession(), ensureSession(), ensureSession()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-checks the cookie only once the snapshot is stale', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(AUTHED));
    vi.stubGlobal('fetch', fetchMock);

    await ensureSession();
    await vi.advanceTimersByTimeAsync(SESSION_STALE_MS - 1000);
    await ensureSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    await ensureSession();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('publishes a login result without a follow-up request', async () => {
    // The login response IS the new session, and is more current than
    // anything a re-read could return.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ authenticated: false }));
    vi.stubGlobal('fetch', fetchMock);

    setSession({ authenticated: true, user: AUTHED.user });

    expect(await ensureSession()).toMatchObject({ authenticated: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('invalidating forces the next read to re-check the cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(AUTHED));
    vi.stubGlobal('fetch', fetchMock);

    await ensureSession();
    invalidateSession();
    await ensureSession();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
