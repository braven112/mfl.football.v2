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

interface MflFetchOptions {
  /** Full URL to the MFL endpoint (api.myfantasyleague.com or www49) */
  url: string;
  /** HTTP method — GET for exports, POST for imports */
  method: 'GET' | 'POST';
  /** The raw MFL_USER_ID cookie value */
  mflUserCookie: string;
  /** The raw MFL_IS_COMMISH cookie value (commissioners only, needed for write operations) */
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
