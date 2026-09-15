/**
 * Where the MFL app's sign-in sends you afterwards.
 *
 * Split out of the page because it is the security-relevant half — an
 * unvalidated `?redirect=` is an open redirect, and a login page is the one
 * place an attacker most wants one. Pure and dependency-free so it can be
 * exercised directly; `tests/mfl-login-redirect.test.ts` is the guard.
 *
 * THE DEFAULT IS THE BOARD, NOT A LEAGUE HOMEPAGE. TheLeague's login page
 * validates its `?redirect=` with `startsWith('/theleague')` and falls back to
 * `/theleague`, which is correct for that league's own site and exactly wrong
 * here: an owner signing in to the MFL app was dropped on TheLeague's
 * homepage, having asked for neither.
 *
 * WHY ANY SAME-ORIGIN PATH IS ALLOWED, rather than a `/live` prefix check.
 * `/live` is one FEATURE of this app, not its root — the app is the shared
 * host itself. A prefix check would have to be widened for every feature
 * added next to it, and the first person to forget would ship this same bug
 * again. Same-origin is the real boundary; what lies behind each of those
 * paths is still gated by its own auth check.
 */

/** Where an owner lands when nothing else is asked for. */
export const MFL_LOGIN_DEFAULT_REDIRECT = '/live';

/** The sign-in page itself — never a destination, or you bounce on arrival. */
const LOGIN_PATH = '/login';

export function resolveMflLoginRedirect(
  requested: string | null | undefined,
  fallback: string = MFL_LOGIN_DEFAULT_REDIRECT,
): string {
  if (typeof requested !== 'string') return fallback;

  const value = requested.trim();
  if (!value) return fallback;

  // Control characters and backslashes first. A `\` is a path separator to
  // some URL parsers and not to others, and `/\evil.com` is treated as
  // protocol-relative by browsers while passing a naive `startsWith('/')` —
  // so it is rejected outright rather than normalized.
  if (/[\x00-\x1f\x7f\\]/.test(value)) return fallback;

  // Same-origin absolute paths only. This rejects, in order: every scheme
  // (`https://evil.com`, and `javascript:` / `data:` which carry no `//`),
  // protocol-relative `//evil.com`, and bare relative paths, which resolve
  // against whatever the current directory happens to be.
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;

  // The query survives (a `?week=3` deep link should still work); the
  // fragment is dropped, since it never reaches the server anyway.
  const [path, query = ''] = splitQuery(value);

  // Bouncing back to the login page is a loop, not a destination. Checked on
  // the PATH so `/login?redirect=/login` cannot smuggle it past.
  if (path === LOGIN_PATH || path.startsWith(`${LOGIN_PATH}/`)) return fallback;

  return query ? `${path}?${query}` : path;
}

/** Split off the query, dropping any fragment — a fragment never reaches us anyway. */
function splitQuery(value: string): [string, string] {
  const withoutHash = value.split('#')[0] ?? '';
  const at = withoutHash.indexOf('?');
  if (at === -1) return [withoutHash, ''];
  return [withoutHash.slice(0, at), withoutHash.slice(at + 1)];
}

/**
 * Build a link to the MFL app's sign-in, carrying where to come back to.
 *
 * THE BUILDER HALF of this module. The validator above existed without one, so
 * the app's own sign-in links assembled their URLs by hand
 * (`/login?redirect=${encodeURIComponent(...)}` in MflAppLayout, and a
 * hardcoded `/login?redirect=/live/settings` on the settings page) — the exact
 * shape that split the LEAGUE login pages three ways before
 * `src/utils/login-redirect.ts` unified them.
 * `tests/login-redirect-guard.test.ts` now forbids it on both sides.
 *
 * This is deliberately NOT `loginUrlFor` from login-redirect.ts. That builder
 * is league-SCOPED: it validates the return path against one league's prefix
 * and emits the apex-host shape. The MFL app belongs to no league and accepts
 * any same-origin path (see the note at the top of this file), so the two
 * answer different questions and a single builder would have to be told which
 * one it was being asked.
 *
 * `next` is the emitted param, matching every league gate on the site. The
 * page still READS `redirect` too, so links already in the wild keep working.
 */
export function mflLoginUrl(returnTo?: string | null): string {
  const safe = resolveMflLoginRedirect(returnTo, '');
  if (!safe) return LOGIN_PATH;
  return `${LOGIN_PATH}?next=${encodeURIComponent(safe)}`;
}
