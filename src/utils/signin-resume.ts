/**
 * Signing in mid-action, and picking the action back up afterwards.
 *
 * THE PROBLEM. Auth is a signed cookie with an expiry. An owner who left a tab
 * open overnight clicks "set lineup" or "claim", the request 401s, and every
 * call site invented its own dead end: "Please sign in to whisper back.",
 * "Please sign in to tip Schefter.", a silent `return null`, a toast. None of
 * them offered a way to actually sign in, and none remembered what the owner
 * had been doing — so the fix was always "reload, find the thing again, redo
 * the work you already did".
 *
 * THE MECHANISM ALREADY EXISTED, for exactly one case. A signed-out visitor
 * picking Bid/Claim on a free agent parks the player, signs in through
 * SignInModal, the page reloads, and `resumePendingClaim` reopens the form on
 * that player. That is `src/utils/claim-resume.ts`, and it is now written on
 * top of the two functions here rather than owning its own sessionStorage
 * dance — one implementation, per the same objection that keeps
 * `buildAttributor` single (CLAUDE.md, the owner-boundary note).
 *
 * WHY THE RELOAD IS NOT OPTIONAL. Whether an owner may claim, submit a lineup
 * or see the Claim column at all is decided in SSR frontmatter. Dismissing a
 * dialog does not put those controls in the DOM; only a fresh render does. So
 * "resume" means "park something small, reload, read it back", never "keep a
 * closure alive across the sign-in".
 *
 * WHY THIS MODULE IMPORTS ALMOST NOTHING. `player-actions.ts` imports
 * `watch-list-client.ts`, and `watch-list-client.ts` needs the 401 handler —
 * so the handler living in `player-actions` would be a cycle. The sign-in
 * opener therefore lives HERE and `player-actions` re-exports it under its
 * established name (`requestSignIn`), leaving every existing call site alone.
 */

import { DEFAULT_LEAGUE, getLeagueBySlug } from '../config/leagues';
import { loginUrlFor } from './login-redirect';

/**
 * Park a small payload across the sign-in reload.
 *
 * sessionStorage, not the URL: `safeReturnPath` sanitises the redirect to a
 * same-origin path and would strip a query param, and a URL that outlived the
 * reload would re-fire on every back-navigation.
 *
 * Every read and write is wrapped: in a private window, or with site data
 * blocked, the accessor itself throws. Sign-in must still work there — the
 * owner just does not get the resume.
 */
export function parkForSignIn(key: string, payload: unknown): void {
  try {
    if (payload == null) return sessionStorage.removeItem(key);
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch {
    /* Resume is a convenience; never let it break the sign-in itself. */
  }
}

/**
 * Read-and-CLEAR, in one step. Deliberately not a plain getter: a payload left
 * behind pops a modal on some unrelated later render, which is worse than
 * losing the resume.
 */
export function takeParkedForSignIn<T = unknown>(key: string): T | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(key);
    if (raw) sessionStorage.removeItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Drop a parked payload without consuming it as a resume. */
export function clearParkedForSignIn(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Nothing to do. */
  }
}

/**
 * Put the sign-in dialog on screen, or fall back to the league's login page.
 *
 * SignInModal is mounted only where a page chose to; a surface that lives on
 * every page (the player details modal) cannot assume it. When the dialog is
 * absent the league's login route takes a `?next=` back to this page, which is
 * the same landing the modal delivers.
 */
export function openSignIn(): void {
  const dialog = document.getElementById('signin-modal') as HTMLDialogElement | null;
  if (dialog && typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
    (dialog.querySelector('[autocomplete="username"]') as HTMLInputElement | null)?.focus();
    return;
  }
  // On a league's own apex host the middleware hides the league prefix, so the
  // first path segment is the PAGE ("standings"), not the league. Only a
  // segment that is a registry slug is a prefix; its ABSENCE is what tells us
  // we are on an apex host and must emit clean paths back.
  const [, first] = window.location.pathname.split('/');
  const pathLeague = first ? getLeagueBySlug(first) : null;
  const back = `${window.location.pathname}${window.location.search}`;

  // Through the shared builder rather than assembled here: it validates the
  // return path against the league and emits the prefix shape this host
  // serves. A hand-built `${prefix}/login?next=` skipped both, and is exactly
  // what tests/login-redirect-guard.test.ts now forbids.
  window.location.href = loginUrlFor({
    league: pathLeague ?? DEFAULT_LEAGUE,
    returnTo: back,
    hideLeaguePrefix: pathLeague === null,
  });
}

export interface AuthExpiryOptions {
  /**
   * Park this under `key` before opening sign-in, so the action can be picked
   * up after the reload. Omit when there is nothing to resume — the owner
   * still gets a way back in, which is the point.
   */
  resume?: { key: string; payload: unknown };
}

/**
 * Did this response mean "your session is gone"? If so, offer a way back in.
 *
 * Returns true when it handled a 401, so a caller reads as:
 *
 *     const res = await fetch(...);
 *     if (handleAuthExpiry(res, { resume: { key: K, payload: p } })) return;
 *
 * 401 ONLY, never 403. They are different answers and this repo now keeps them
 * apart everywhere (see the Roger 403 page): 401 means "sign in and try
 * again", 403 means "signing in will not help". Treating a 403 as an expiry
 * puts a login form in front of somebody who is already correctly signed in.
 *
 * The STATUS is the signal, not the message body. Some 55 API routes answer
 * `Authentication required…` in at least four different JSON shapes
 * (`{error}`, `{message}`, `{success,message}`, a typed `errorResponse`), and
 * matching on any of that prose would be a fifth thing to keep in sync.
 */
export function handleAuthExpiry(res: { status: number }, opts: AuthExpiryOptions = {}): boolean {
  if (res.status !== 401) return false;
  if (opts.resume) parkForSignIn(opts.resume.key, opts.resume.payload);
  openSignIn();
  return true;
}
