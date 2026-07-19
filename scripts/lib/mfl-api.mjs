/**
 * Shared MFL API helpers for node scripts.
 *
 * `mflFetch` + `loginToMFL` were byte-for-byte identical (module comments
 * aside) between scripts/apply-pending-contracts.mjs and
 * scripts/sync-draft-pick-contracts.mjs — lifted here once, imported by
 * both.
 *
 * `fetchExport` consolidates three near-identical "build an MFL export URL
 * and fetch it" helpers (scripts/compute-afl-awards.mjs,
 * scripts/compute-afl-tier-movement.mjs,
 * scripts/backfill-afl-championship-history.mjs) that differed in whether
 * they retried on 429, whether they slept before every attempt or not at
 * all, and their User-Agent string. Each caller passes options that
 * reproduce its own original behavior exactly — this does not change what
 * any of them do, it just gives them one implementation to share.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Manual-redirect fetch that re-attaches the Cookie header on every hop.
 * Required because Node's undici strips Cookie on cross-origin 302s, and
 * MFL's api.* host always redirects to www49.* for authenticated calls.
 */
export async function mflFetch({ url, method = 'GET', cookies, body, timeoutMs = 10_000 }) {
  let currentUrl = url;
  let currentMethod = method;
  let currentBody = body;
  const cookieHeader = Object.entries(cookies)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  for (let hop = 0; hop <= 3; hop++) {
    const headers = { Cookie: cookieHeader };
    if (currentMethod === 'POST' && currentBody) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const res = await fetch(currentUrl, {
      method: currentMethod,
      headers,
      body: currentMethod === 'POST' ? currentBody : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get('location');
    if (!location) return res;
    currentUrl = location.startsWith('http')
      ? location
      : new URL(location, currentUrl).href;
    if (res.status === 302 || res.status === 303) {
      if (currentMethod === 'POST' && currentBody) {
        const sep = currentUrl.includes('?') ? '&' : '?';
        currentUrl = `${currentUrl}${sep}${currentBody}`;
      }
      currentMethod = 'GET';
      currentBody = undefined;
    }
  }
  throw new Error(`mflFetch exceeded redirect limit for ${url}`);
}

/**
 * Log into MFL with username/password and return MFL_USER_ID + (optional)
 * MFL_IS_COMMISH cookies.
 */
export async function loginToMFL(username, password) {
  const year = new Date().getFullYear();
  const loginUrl = `https://api.myfantasyleague.com/${year}/login`;
  const params = new URLSearchParams({ USERNAME: username, PASSWORD: password, XML: '1' });

  const allSetCookies = [];
  let url = loginUrl;
  let method = 'POST';
  let body = params.toString();
  let finalText = '';

  for (let hop = 0; hop <= 3; hop++) {
    const headers = method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {};
    const res = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? body : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
    const hopCookies = res.headers.getSetCookie?.() ?? [];
    allSetCookies.push(...hopCookies);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        finalText = await res.text();
        break;
      }
      url = location.startsWith('http') ? location : new URL(location, url).href;
      if (res.status === 302 || res.status === 303) {
        if (method === 'POST' && body) {
          const sep = url.includes('?') ? '&' : '?';
          url = `${url}${sep}${body}`;
        }
        method = 'GET';
        body = undefined;
      }
      continue;
    }
    finalText = await res.text();
    break;
  }

  // Fall back to GET-with-params if POST returned empty
  if (!finalText.trim()) {
    const fallbackUrl = `${loginUrl}?${params.toString()}`;
    const res = await fetch(fallbackUrl, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
    finalText = await res.text();
    const hopCookies = res.headers.getSetCookie?.() ?? [];
    allSetCookies.push(...hopCookies);
  }

  const errorMatch = finalText.match(/<error[^>]*>(.*?)<\/error>/s);
  if (errorMatch) throw new Error(`MFL login failed: ${errorMatch[1].trim()}`);

  const cookieMatch = finalText.match(/MFL_USER_ID="([^"]+)"/);
  if (!cookieMatch) throw new Error(`MFL login: no MFL_USER_ID in response: ${finalText.slice(0, 200)}`);

  let commishCookie;
  for (const cookieStr of allSetCookies) {
    const m = cookieStr.match(/MFL_IS_COMMISH=([^;]+)/);
    if (m) {
      commishCookie = m[1];
      break;
    }
  }

  return { mflUserId: cookieMatch[1], mflIsCommish: commishCookie };
}

/**
 * Fetch an MFL export endpoint as JSON, with optional 429-backoff retry.
 *
 * @param {{ host: string, leagueId: string|number, year: string|number, type: string, extra?: string }} target
 * @param {{ userAgent?: string, retries?: number, sleepMs?: number, onFetch?: (url: string) => void, onRetry?: (url: string, attempt: number) => void }} [options]
 *   - retries: number of additional attempts allowed after a 429 (default 0 — no retry).
 *   - sleepMs: base delay slept before each attempt, multiplied by (attempt + 1)
 *     so retries back off (default 0 — no delay). Pass a fixed value with
 *     retries: 0 to reproduce a flat "politeness" sleep before a single attempt.
 *   - onFetch: called with the resolved URL immediately before each request
 *     (used by callers that log the URL being fetched).
 *   - onRetry: called with the resolved URL and the attempt index when a 429
 *     is retried (used by callers that log a retry warning).
 *   - formatError: builds the thrown Error's message from (url, status).
 *     Defaults to `${url} → ${status}`; pass a custom formatter to match a
 *     caller's original wording.
 */
/**
 * Derive the bare host prefix fetchExport expects (e.g. 'www44') from a
 * registry `mflHost` (e.g. 'www44.myfantasyleague.com'). Lives here, next to
 * fetchExport, because it exists purely to bridge the registry's full-host
 * format to fetchExport's prefix + '.myfantasyleague.com' URL assembly —
 * change both together if that contract ever changes.
 *
 * @param {string} mflHost Full registry hostname.
 */
export function mflHostPrefix(mflHost) {
  return mflHost.split('.')[0];
}

/**
 * Extract the league list from an `export?TYPE=myleagues` JSON body.
 *
 * MFL is inconsistent about the wrapper key: some hosts/years return
 * `{"myleagues":{"league":[...]}}` and others `{"leagues":{"league":[...]}}`
 * (docs/claude/insights/domains/mfl-api.md, myleagues entries). A single
 * league also comes back as a bare object rather than a one-element array.
 * Accept every shape and always return an array — empty means a dead cookie.
 *
 * Mirrors the app-side dual-path in src/pages/api/autocut-list.ts.
 *
 * @param {unknown} body parsed JSON (or null)
 * @returns {unknown[]}
 */
export function extractMyLeagues(body) {
  const leagues = body?.myleagues?.league ?? body?.leagues?.league ?? [];
  if (Array.isArray(leagues)) return leagues;
  return leagues ? [leagues] : [];
}

export async function fetchExport({ host, leagueId, year, type, extra = '' }, options = {}) {
  const {
    userAgent,
    retries = 0,
    sleepMs = 0,
    onFetch,
    onRetry,
    formatError = (url, status) => `${url} → ${status}`,
  } = options;
  const url = `https://${host}.myfantasyleague.com/${year}/export?TYPE=${type}&L=${leagueId}&JSON=1${extra}`;
  const headers = userAgent ? { 'User-Agent': userAgent } : undefined;

  for (let attempt = 0; ; attempt++) {
    if (sleepMs) await sleep(sleepMs * (attempt + 1));
    onFetch?.(url);
    const res = await fetch(url, { headers });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < retries) {
      onRetry?.(url, attempt);
      continue;
    }
    throw new Error(formatError(url, res.status));
  }
}
