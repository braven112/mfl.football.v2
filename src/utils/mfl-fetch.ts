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
  /** URL-encoded body for POST requests */
  body?: string;
}

/**
 * Fetch from MFL with manual redirect handling to preserve Cookie headers.
 *
 * Follows up to 3 redirects, re-attaching the Cookie header on each hop.
 * Returns the final Response object.
 */
export async function mflFetch(opts: MflFetchOptions): Promise<Response> {
  const { mflUserCookie } = opts;
  let url = opts.url;
  let method = opts.method;
  let body: string | undefined = opts.body;

  const cookieHeader = `MFL_USER_ID=${mflUserCookie}`;
  const maxRedirects = 3;

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
    });

    // Not a redirect — return the final response
    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    // Handle redirect
    const location = response.headers.get('location');
    if (!location) {
      return response; // No Location header — return as-is
    }

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

  // Exhausted redirect limit — make one final attempt
  throw new Error(`MFL API exceeded ${maxRedirects} redirects from ${opts.url}`);
}
