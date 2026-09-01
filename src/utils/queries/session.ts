/**
 * The session query — one shared read of `/api/auth/me` per page.
 *
 * Before this module, "who is logged in?" was answered by four independent
 * implementations: two React islands (AuthContext, TradeBuilder), one bundled
 * script (scripts/trade-alert.ts) and two inline scripts (TheLeagueLayout's
 * PWA gate, rosters.astro). A page rendering the trade builder inside the
 * layout made the same request twice and could act on two different answers.
 *
 * They also all shared one bug, most visibly as TradeBuilder's
 * `.catch(() => {}) // Silent — user just isn't logged in`:
 *
 *   **A failed request is not a logged-out user.** `/api/auth/me` answers 200
 *   in BOTH directions — `{authenticated:false}` is its considered answer that
 *   nobody is signed in. So a 500, an offline tab, or a parse failure is a
 *   different fact than `authenticated:false`, and collapsing them logs a
 *   signed-in owner out of the UI (or bounces them to /login from the PWA
 *   gate) because their phone lost signal for one request. The loader below
 *   throws on anything that is not a well-formed 200, which parks the store in
 *   `status:'error'` WITH the last good session still in `data` — callers get
 *   "we don't know right now", not "you're logged out".
 *
 * `staleTime` is 30s: long enough that a burst of islands mounting on one page
 * load shares a single request, short enough that a soft navigation minutes
 * later re-checks a session that may have expired.
 */

import { createQueryStore } from '../query-store';

export interface SessionUser {
  userId: string;
  username: string;
  franchiseId: string;
  leagueId: string;
  role: 'owner' | 'commissioner' | 'admin';
}

export interface SessionSnapshot {
  authenticated: boolean;
  user: SessionUser | null;
}

export const SESSION_QUERY_KEY = 'session';

/** 30s — see the module note. */
export const SESSION_STALE_MS = 30_000;

export const sessionQuery = createQueryStore<void, SessionSnapshot>(
  () => SESSION_QUERY_KEY,
  async () => {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    // The route answers 200 for both outcomes, so any non-200 is a transport
    // or server failure — never evidence about the user. Throw, so the store
    // records an error and keeps whatever session it already had.
    if (!res.ok) throw new Error(`auth/me ${res.status}`);
    const data: unknown = await res.json();
    if (typeof data !== 'object' || data === null || !('authenticated' in data)) {
      throw new Error('auth/me returned an unrecognized body');
    }
    const body = data as { authenticated?: unknown; user?: SessionUser };
    return {
      authenticated: body.authenticated === true,
      user: body.authenticated === true ? body.user ?? null : null,
    };
  },
  { staleTime: SESSION_STALE_MS },
);

/**
 * Read the session imperatively — for inline/bundled scripts and event
 * handlers. Resolves the cached snapshot when fresh, otherwise fetches.
 * REJECTS when the session genuinely could not be read; callers must decide
 * what that means for them rather than defaulting to "logged out".
 */
export function ensureSession(): Promise<SessionSnapshot> {
  return sessionQuery.ensure(undefined);
}

/** Current snapshot without triggering a load. */
export function peekSession(): SessionSnapshot | null {
  return sessionQuery.getState(undefined).data;
}

/**
 * Publish a known session directly — after a login or logout response, which
 * is more authoritative and more current than anything a refetch could return.
 */
export function setSession(next: SessionSnapshot): void {
  sessionQuery.setData(undefined, next);
}

/** Drop the cached session so the next read re-checks the cookie. */
export function invalidateSession(): void {
  sessionQuery.invalidate();
}
