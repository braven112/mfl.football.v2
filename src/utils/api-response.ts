/**
 * Shared API response helpers
 *
 * Extracted from ~29 API routes that each redefined their own
 * `JSON_HEADERS` constant (some with `Cache-Control: no-store`, some
 * without) and one of three near-identical inline 401 shapes:
 *   - `{ success: false, message: '...' }`
 *   - `{ error: '...' }`
 *   - a raw string body
 *
 * `json()` centralizes the `new Response(JSON.stringify(body), { status,
 * headers })` boilerplate. `unauthorized()` centralizes the 401 shape while
 * still accepting a custom body/headers so routes with more than one
 * distinct 401 reason (e.g. "no session" vs "no MFL session cookie") can
 * keep their existing message text. `requireAuth()` is for the common case
 * of a single generic auth gate at the top of a route.
 *
 * Preserve each route's existing cache-control behavior when migrating —
 * pick JSON_HEADERS or JSON_HEADERS_NO_STORE to match what was there
 * before, don't change it.
 */

import { getAuthUser, type AuthUser } from './auth';

export const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
};

export const JSON_HEADERS_NO_STORE: Record<string, string> = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

/** Build a JSON Response, defaulting to 200 + Content-Type-only headers. */
export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = JSON_HEADERS,
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Build a 401 Response. Defaults to `{ error: 'Authentication required' }`
 * with plain JSON_HEADERS, but accepts a custom body/headers so routes with
 * a distinct message per failure reason don't lose that distinction.
 */
export function unauthorized(
  body: unknown = { error: 'Authentication required' },
  headers: Record<string, string> = JSON_HEADERS,
): Response {
  return json(body, 401, headers);
}

/**
 * Resolve the authenticated user from the request's session cookie, or
 * return a ready-to-return 401 Response. Usage:
 *
 *   const user = await requireAuth(request);
 *   if (user instanceof Response) return user;
 *
 * NAMING NOTE: src/utils/auth.ts also exports a `requireAuth` — a
 * synchronous type-guard `(user: AuthUser | null) => user is AuthUser`.
 * They are different helpers: this one takes the Request and produces the
 * 401 for you; auth.ts's narrows an already-fetched user. Double-check
 * which module an auto-import picked.
 */
export async function requireAuth(request: Request): Promise<AuthUser | Response> {
  const user = getAuthUser(request);
  if (!user) return unauthorized();
  return user;
}
