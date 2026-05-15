/**
 * MFL Login Utilities
 * Handles authentication with MyFantasyLeague API
 *
 * Strategy (two-step):
 * 1. Call /login with XML=1 to get the MFL_USER_ID cookie
 *    (MFL's login endpoint does NOT support JSON=1 — it returns empty body)
 * 2. Call export?TYPE=myleagues with the cookie to resolve franchise_id
 *    (The standalone /myleagues endpoint returns HTML from server-side fetch)
 */

import { mflFetch } from './mfl-fetch';

export interface MFLLoginResponse {
  success: boolean;
  userId?: string;
  username?: string;
  franchiseId?: string;
  leagueId?: string;
  role?: string;
  commishCookie?: string;
  rawResponse?: any;
  error?: string;
}

const normalizeFranchise = (value: string | null | undefined) => {
  if (!value) return '';
  const trimmed = `${value}`.trim();
  if (!trimmed) return '';
  return /^\d+$/.test(trimmed) ? trimmed.padStart(4, '0') : trimmed;
};

/**
 * Parse MFL login XML response to extract cookie or error.
 * Valid: <status MFL_USER_ID="base64cookie"/>
 * Invalid: <error>Invalid Password</error>
 */
function parseMFLLoginXML(xml: string): { cookie?: string; error?: string } {
  const errorMatch = xml.match(/<error[^>]*>(.*?)<\/error>/s);
  if (errorMatch) {
    return { error: errorMatch[1].trim() };
  }

  const cookieMatch = xml.match(/MFL_USER_ID="([^"]+)"/);
  if (cookieMatch) {
    return { cookie: cookieMatch[1] };
  }

  return { error: 'Unexpected response from MFL login.' };
}

/**
 * Authenticate user against MFL API.
 *
 * Step 1: Login with XML=1 to get the MFL_USER_ID cookie.
 * Step 2: Call export?TYPE=myleagues with the cookie to resolve franchise_id.
 *
 * @param username - MFL username
 * @param password - MFL password
 * @param leagueId - League ID to match against (e.g. "13522")
 * @param year - Override the season year used when calling MFL. Defaults to
 *   the current calendar year. AFL passes the last completed season here
 *   because the 2026 AFL league hasn't been created on MFL yet, so calling
 *   `2026/myleagues` returns nothing for league 19621.
 */
export async function authenticateWithMFL(
  username: string,
  password: string,
  leagueId?: string,
  year?: number,
): Promise<MFLLoginResponse> {
  try {
    const seasonYear = year ?? new Date().getFullYear();

    // ── Step 1: Login to get MFL_USER_ID cookie ─────────────────────
    // Try POST first (MFL-recommended), fall back to GET if POST returns
    // empty body (MFL redirects POST→GET on some hosts, losing the body).
    const loginUrl = `https://api.myfantasyleague.com/${seasonYear}/login`;
    const loginParams = new URLSearchParams({
      USERNAME: username,
      PASSWORD: password,
      XML: '1',
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log('[mfl-login] Step 1: calling /login (year:', seasonYear, ')');
    }

    // Use manual redirect handling to capture Set-Cookie headers from ALL hops.
    // Native fetch with redirect:'follow' silently drops Set-Cookie on cross-origin
    // 302 redirects, so MFL_IS_COMMISH (set on an intermediate hop) is lost.
    let loginResponse: Response;
    let loginText: string;
    const allSetCookies: string[] = [];

    {
      let url = loginUrl;
      let method: 'POST' | 'GET' = 'POST';
      let body: string | undefined = loginParams.toString();
      const maxHops = 3;

      for (let hop = 0; hop <= maxHops; hop++) {
        const headers: Record<string, string> = {};
        if (method === 'POST' && body) {
          headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }

        const res = await fetch(url, {
          method,
          headers,
          body: method === 'POST' ? body : undefined,
          redirect: 'manual',
          signal: AbortSignal.timeout(8000),
        });

        // Collect Set-Cookie from every hop
        const hopCookies = res.headers.getSetCookie?.() ?? [];
        allSetCookies.push(...hopCookies);

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) break;
          console.log(`[mfl-login] ${res.status} redirect: ${url} → ${location}`);
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

        loginResponse = res;
        break;
      }
      loginResponse ??= await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    }

    loginText = await loginResponse!.text();

    // POST returned empty body → fall back to GET with params in URL
    if (!loginText.trim()) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[mfl-login] POST returned empty, falling back to GET');
      }
      // Also use manual redirect for the GET fallback
      let url = `${loginUrl}?${loginParams.toString()}`;
      const maxHops = 3;
      for (let hop = 0; hop <= maxHops; hop++) {
        const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000) });
        const hopCookies = res.headers.getSetCookie?.() ?? [];
        allSetCookies.push(...hopCookies);
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) break;
          url = location.startsWith('http') ? location : new URL(location, url).href;
          continue;
        }
        loginResponse = res;
        break;
      }
      loginText = await loginResponse!.text();
    }

    if (!loginResponse!.ok && !loginText.trim()) {
      return {
        success: false,
        error: `MFL API error: ${loginResponse!.status} ${loginResponse!.statusText}`,
      };
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('[mfl-login] login response:', loginText.substring(0, 300));
    }

    const parsed = parseMFLLoginXML(loginText);

    if (parsed.error) {
      return {
        success: false,
        error: parsed.error === 'Invalid Password'
          ? 'Invalid username or password.'
          : parsed.error,
      };
    }

    if (!parsed.cookie) {
      return {
        success: false,
        error: 'MFL login succeeded but no cookie was returned.',
      };
    }

    const mflCookie = parsed.cookie;

    // Capture MFL_IS_COMMISH cookie from Set-Cookie headers collected across ALL redirect hops.
    // MFL sets this alongside MFL_USER_ID for commissioner accounts.
    // Without it, write operations (trades, etc.) fail with "API requires a logged in user".
    let commishCookie: string | undefined;
    console.log('[mfl-login] collected', allSetCookies.length, 'Set-Cookie headers across all hops');
    for (const cookieStr of allSetCookies) {
      const match = cookieStr.match(/MFL_IS_COMMISH=([^;]+)/);
      if (match) {
        commishCookie = match[1];
        console.log('[mfl-login] found MFL_IS_COMMISH cookie');
        break;
      }
    }

    console.log('[mfl-login] Got MFL cookie (length:', mflCookie.length, ') commish:', !!commishCookie);

    // ── Step 2: Call export?TYPE=myleagues to get franchise_id ────
    // Use the export endpoint (not standalone /myleagues which returns HTML).
    // Authenticate with the MFL_USER_ID cookie from Step 1.
    // Returns {"leagues":{}} when unauth'd, or {"leagues":{"league":[...]}}
    // with franchise_id when authenticated.
    const mlUrl = `https://api.myfantasyleague.com/${seasonYear}/export?TYPE=myleagues&JSON=1`;

    console.log('[mfl-login] Step 2: calling export?TYPE=myleagues with cookie');

    const mlResponse = await mflFetch({
      url: mlUrl,
      method: 'GET',
      mflUserCookie: mflCookie,
    });
    const mlText = await mlResponse.text();
    console.log('[mfl-login] myleagues response status:', mlResponse.status, 'body length:', mlText.length);
    let mlData: any;

    try {
      mlData = JSON.parse(mlText);
    } catch {
      console.error('[mfl-login] Failed to parse myleagues response:', mlText.substring(0, 500));
      return {
        success: true,
        userId: mflCookie,
        username,
        franchiseId: '',
        leagueId: leagueId || '',
        role: 'owner',
        error: 'Could not parse league data from MFL.',
      };
    }

    console.log('[mfl-login] myleagues response:', JSON.stringify(mlData, null, 2).substring(0, 1000));

    // Extract leagues array
    const leagues = (
      mlData?.myleagues?.league ??
      mlData?.leagues?.league ??
      []
    ) as any[];

    // MFL returns a single object instead of array when there's only one league
    const leagueList = Array.isArray(leagues) ? leagues : leagues ? [leagues] : [];

    if (leagueList.length === 0) {
      console.warn('[mfl-login] No leagues found — myleagues returned empty. Cookie may not have survived redirect.');
      return {
        success: true,
        userId: mflCookie,
        username,
        franchiseId: '',
        leagueId: leagueId || '',
        role: 'owner',
        error: 'No leagues found for this account.',
      };
    }

    console.log('[mfl-login] Found', leagueList.length, 'leagues');

    // Find the target league (match by ID, or fall back to first league)
    const targetLeague = leagueId
      ? leagueList.find(
          (l) =>
            `${l.id ?? l.league_id ?? l.leagueId ?? ''}` === `${leagueId}` ||
            `${l.league ?? ''}` === `${leagueId}`
        ) || null
      : leagueList[0];

    if (!targetLeague && leagueId) {
      return {
        success: true,
        userId: mflCookie,
        username,
        franchiseId: '',
        leagueId: leagueId,
        role: 'owner',
        error: `Your account is not a member of league ${leagueId}.`,
      };
    }

    // Extract franchise_id from the target league
    const franchiseId = normalizeFranchise(
      targetLeague?.franchise_id ??
      targetLeague?.franchiseId ??
      targetLeague?.FranchiseId ??
      targetLeague?.team_id ??
      targetLeague?.teamId ??
      targetLeague?.team ??
      ''
    );

    const resolvedLeagueId =
      `${targetLeague?.id ?? targetLeague?.league_id ?? targetLeague?.leagueId ?? targetLeague?.league ?? leagueId ?? ''}`;

    console.log('[mfl-login] Resolved franchiseId:', franchiseId, 'leagueId:', resolvedLeagueId);

    return {
      success: true,
      userId: mflCookie,
      username,
      franchiseId,
      leagueId: resolvedLeagueId,
      role: commishCookie ? 'commissioner' : 'owner',
      commishCookie,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `Login failed: ${errorMessage}`,
    };
  }
}

/**
 * Validate MFL session using league export endpoint
 * Makes a test API call to verify the cookie is still valid
 */
export async function validateMFLSession(
  mflCookie: string,
  leagueId: string
): Promise<boolean> {
  try {
    const year = new Date().getFullYear();
    const testUrl = `https://www${Number(leagueId) % 50}.myfantasyleague.com/${year}/export`;

    const response = await fetch(testUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `MFL_USER_ID=${mflCookie}`,
      },
      body: new URLSearchParams({
        TYPE: 'league',
        L: leagueId,
        JSON: '1',
      }).toString(),
      signal: AbortSignal.timeout(8000),
    });

    return response.ok || response.status !== 401;
  } catch {
    return false;
  }
}
