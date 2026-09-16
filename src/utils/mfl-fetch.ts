/**
 * MFL Fetch Utility
 *
 * Node.js undici strips Cookie headers on cross-origin 302 redirects.
 * MFL's api.myfantasyleague.com always redirects to www49.myfantasyleague.com,
 * so the MFL_USER_ID cookie is silently dropped and every authenticated
 * write/read fails with "API requires a logged in user".
 *
 * This utility handles the redirect manually: it catches the 302, extracts
 * the Location URL, and re-sends the request with the Cookie header intact.
 */

import { assertOutboundAllowed, OutboundBlockedError } from './deploy-environment';

/**
 * MFL endpoints that mutate the league, whatever HTTP method reaches them.
 *
 * `/import` is the documented write API. The others are MFL's own web pages,
 * which we drive by replaying their links and forms — and **they mutate on a
 * plain GET**:
 *
 *   - `add_drop?…&DELETE=<round>_<add>_<drop>` cancels a filed waiver claim.
 *     `src/pages/api/waiver-claims.ts` issues exactly that as a GET, copying
 *     how MFL's own page links it.
 *   - `csetup?C=WAIVORD` is the Custom Waiver Order form
 *     (`src/utils/afl-waiver-order.ts`), the only way to write waiver priority.
 *
 * A method-only test misses every one of these. That is not hypothetical: the
 * first version of this guard checked POST-or-`/import`, and a staging deploy
 * could still have deleted a real owner's waiver claim.
 */
const MFL_MUTATING_PATHS = ['/import', '/add_drop', '/csetup'];

/**
 * Is this call a WRITE rather than an export read?
 *
 * Over-matching costs a blocked read on staging; under-matching costs a real,
 * irreversible mutation in the real league. So the bar is deliberately low:
 * any POST, or any URL touching a mutating endpoint above.
 *
 * Reads stay reads — `/export` is where every read lives, and nothing here
 * matches it.
 */
export function isMflWrite(method: string, url: string): boolean {
  if (method.toUpperCase() === 'POST') return true;
  return MFL_MUTATING_PATHS.some((path) => url.includes(path));
}

/**
 * The one message an owner sees when a deployment refuses to send.
 *
 * Written for an owner, not a developer: it says what did NOT happen, why the
 * site is not broken, and where the same click will work.
 */
export const MFL_WRITE_BLOCKED_MESSAGE =
  'Nothing was sent to MFL — staging and preview builds never write to the real league. '
  + 'Everything up to the send worked; try it on the live site.';

export interface MflFailureDescription {
  /** What to show the owner. */
  message: string;
  /** True when THIS deployment refused on purpose — not an MFL outage. */
  blocked: boolean;
}

/**
 * Turn a thrown `mflFetch` failure into the message a caller reports.
 *
 * Every write util used to wrap the throw in "Could not reach MFL: …", which
 * is true for a network error and a lie for the deploy guard: staging refuses
 * on purpose. `OutboundBlockedError` has its own class precisely so the two
 * can be told apart (see deploy-environment.ts) — and collapsing them is not
 * cosmetic. Before this existed (Sep 2026): a blocked Watch-player click on
 * staging surfaced as a 502 and sent someone hunting a bug in the roster code
 * for an hour, a blocked lineup submit read "Internal server error", and the
 * contract writer retried the refusal three times with backoff — because from
 * inside a catch block a refusal looks exactly like a flaky network.
 *
 * Every `catch` around an MFL write goes through here —
 * `tests/staging-outbound-guard.test.ts` fails on one that does not.
 */
export function describeMflFailure(err: unknown): MflFailureDescription {
  if (err instanceof OutboundBlockedError) {
    return { message: MFL_WRITE_BLOCKED_MESSAGE, blocked: true };
  }
  const detail = err instanceof Error ? err.message : String(err);
  return { message: `Could not reach MFL: ${detail}`, blocked: false };
}

interface MflFetchOptions {
  /** Full URL to the MFL endpoint (api.myfantasyleague.com or www49) */
  url: string;
  /** HTTP method — GET for exports, POST for imports */
  method: 'GET' | 'POST';
  /** The raw MFL_USER_ID cookie value */
  mflUserCookie: string;
  /**
   * The raw MFL_IS_COMMISH cookie value. Optional, and NOT required for writes
   * — MFL accepts an import with MFL_USER_ID alone on the www## host
   * (scripts/probe-write-auth.mjs, 2026-09-05). Forwarded when present.
   */
  mflCommishCookie?: string;
  /** URL-encoded body for POST requests */
  body?: string;
  /** If true, collect Set-Cookie headers from all redirect hops */
  collectSetCookies?: boolean;
  /** Timeout per redirect hop in ms (default: 10000) */
  timeoutMs?: number;
}

export interface MflFetchResult {
  response: Response;
  /** Set-Cookie header values collected across all redirect hops (only when collectSetCookies is true) */
  setCookies: string[];
}

/**
 * Fetch from MFL with manual redirect handling to preserve Cookie headers.
 *
 * Follows up to 3 redirects, re-attaching the Cookie header on each hop.
 * Returns the final Response object.
 */
export async function mflFetch(opts: MflFetchOptions): Promise<Response>;
export async function mflFetch(opts: MflFetchOptions & { collectSetCookies: true }): Promise<MflFetchResult>;
export async function mflFetch(opts: MflFetchOptions): Promise<Response | MflFetchResult> {
  const { mflUserCookie, mflCommishCookie, collectSetCookies, timeoutMs = 10_000 } = opts;
  let url = opts.url;
  let method = opts.method;
  let body: string | undefined = opts.body;

  // Every authenticated MFL write in the app funnels through here — five of
  // the six writer utils call mflFetch, each building its own `import?TYPE=`
  // URL — which makes this the one place a staging or preview deployment can
  // be stopped from mutating the real league. Deliberately NOT at the route
  // layer: there are a dozen routes and the one that forgot would fail open.
  //
  // Throws rather than returning a synthetic Response on purpose. MFL reports
  // its own errors as HTTP 200 (docs/claude/rules/lineups.md), so callers here
  // are already in the habit of reading a body to decide whether a write
  // worked — a fake 403 Response would be read as "MFL said no" instead of
  // "we never asked".
  if (isMflWrite(method, url)) {
    assertOutboundAllowed('MFL write');
  }

  // Build cookie header with both MFL_USER_ID and MFL_IS_COMMISH (if available)
  const cookieParts = [`MFL_USER_ID=${mflUserCookie}`];
  if (mflCommishCookie) {
    cookieParts.push(`MFL_IS_COMMISH=${mflCommishCookie}`);
  }
  const cookieHeader = cookieParts.join('; ');

  const maxRedirects = 3;
  const allSetCookies: string[] = [];

  for (let i = 0; i <= maxRedirects; i++) {
    const headers: Record<string, string> = {
      Cookie: cookieHeader,
    };
    if (method === 'POST' && body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? body : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });

    // Collect Set-Cookie headers from every hop
    if (collectSetCookies) {
      const hopCookies = response.headers.getSetCookie?.() ?? [];
      allSetCookies.push(...hopCookies);
    }

    // Not a redirect — return the final response
    if (response.status < 300 || response.status >= 400) {
      if (i > 0) console.log(`[mflFetch] Final response after ${i} redirect(s): ${response.status}`);
      if (collectSetCookies) {
        return { response, setCookies: allSetCookies };
      }
      return response;
    }

    // Handle redirect
    const location = response.headers.get('location');
    if (!location) {
      console.warn(`[mflFetch] ${response.status} redirect but no Location header`);
      if (collectSetCookies) {
        return { response, setCookies: allSetCookies };
      }
      return response;
    }

    console.log(`[mflFetch] ${response.status} redirect: ${url} → ${location}`);

    // Resolve relative Location URLs
    url = location.startsWith('http') ? location : new URL(location, url).href;

    // 302/303 converts POST→GET and drops the body (per HTTP spec)
    if (response.status === 302 || response.status === 303) {
      if (method === 'POST' && body) {
        // Preserve params by appending them to the redirect URL
        const separator = url.includes('?') ? '&' : '?';
        url = `${url}${separator}${body}`;
      }
      method = 'GET';
      body = undefined;
    }
    // 307/308 preserve method and body — just update the URL
  }

  // Exhausted redirect limit
  throw new Error(`MFL API exceeded ${maxRedirects} redirects from ${opts.url}`);
}
