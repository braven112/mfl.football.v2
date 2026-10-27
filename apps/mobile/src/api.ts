/**
 * How the app talks to the MFL Live server.
 *
 * The app never talks to MFL directly: the server signs in to MFL, reads each
 * league with the owner's own MFL cookie and assembles the board. In store
 * mode (`source=mfl`) that board is MFL data only, which is what Google Play
 * and the App Store allow (docs/plans/mfl-live-store-app.md, Legal).
 */

import Constants from 'expo-constants';
import type { MflLiveAppBoard, MflLiveAppLoginResponse } from '@mfl/shared-types/mfl-live-app';

const API_ORIGIN: string =
  (Constants.expoConfig?.extra?.apiOrigin as string | undefined) ?? 'https://mfl.football';

/** Sent with sign-in so the server returns the session token in the body. */
const APP_CLIENT = 'mfl-live-app';

/** A request the server refused because the session is gone or never existed. */
export class SignedOutError extends Error {}

/** Site-relative icon paths (a league's own crest) need the server's origin. */
export function absoluteUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${API_ORIGIN}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

export async function signIn(username: string, password: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username, password, scope: 'mfl-live', client: APP_CLIENT }),
    });
  } catch {
    throw new Error('Could not reach MFL Football. Check your connection and try again.');
  }

  // MFL and our own routes can both answer an error as a 200, so the body's
  // `success` flag decides, never `res.ok` alone.
  let body: MflLiveAppLoginResponse | null = null;
  try {
    body = (await res.json()) as MflLiveAppLoginResponse;
  } catch {
    body = null;
  }
  if (!body?.success || !body.token) {
    throw new Error(body?.message || 'Sign-in failed. Check your MFL username and password.');
  }
  return body.token;
}

/** Clears the server's session cookie too, which the phone's HTTP stack may have kept. */
export async function signOutOnServer(): Promise<void> {
  try {
    await fetch(`${API_ORIGIN}/api/auth/logout`, { method: 'POST' });
  } catch {
    // Signing out locally is what matters; the token is already gone.
  }
}

/** A request that reached the server but did not succeed. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * The one way a screen calls the server: the session token as `Bearer`, which
 * only `getMflLiveUser` accepts (tests/mfl-live-app-auth.test.ts). A 401 is
 * `SignedOutError`, so every screen signs out the same way; any other failure
 * is `ApiError` with the status, and the caller decides whether to keep what
 * is already on screen.
 */
async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    throw new ApiError('Could not reach MFL Football. Check your connection.', 0);
  }
  if (res.status === 401) throw new SignedOutError('Your session has ended. Sign in again.');
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message = (body as { message?: string; error?: string } | null)?.message
      ?? (body as { error?: string } | null)?.error;
    throw new ApiError(message || 'MFL Football could not load this just now.', res.status);
  }
  return body as T;
}

/** GET a JSON endpoint on the MFL Live server, e.g. `apiGet(token, '/api/live-board?source=mfl')`. */
export function apiGet<T>(token: string, path: string): Promise<T> {
  return request<T>(token, path);
}

/** POST JSON to an endpoint on the MFL Live server. */
export function apiPost<T>(token: string, path: string, body: unknown): Promise<T> {
  return request<T>(token, path, { method: 'POST', body: JSON.stringify(body) });
}

/** DELETE with a JSON body on the MFL Football server. */
export function apiDelete<T>(token: string, path: string, body: unknown): Promise<T> {
  return request<T>(token, path, { method: 'DELETE', body: JSON.stringify(body) });
}

export async function fetchBoard(token: string): Promise<MflLiveAppBoard> {
  const body = await apiGet<MflLiveAppBoard>(token, '/api/live-board?source=mfl');
  // `ok: false` is a failed assembly, not an empty week: the caller keeps the
  // last good board rather than blanking the screen.
  if (!body.ok) throw new Error('MFL Football could not load your leagues just now.');
  return body;
}
