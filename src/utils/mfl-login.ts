/**
 * MFL Login Utilities
 * Handles authentication with MyFantasyLeague API
 *
 * Strategy (two-step):
 * 1. Call /login with XML=1 to get the MFL_USER_ID cookie
 *    (MFL's login endpoint does NOT support JSON=1 — it returns empty body)
 * 2. Call /myleagues with the cookie to resolve franchise_id
 */

export interface MFLLoginResponse {
  success: boolean;
  userId?: string;
  username?: string;
  franchiseId?: string;
  leagueId?: string;
  role?: string;
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
  // Check for error response
  const errorMatch = xml.match(/<error[^>]*>(.*?)<\/error>/s);
  if (errorMatch) {
    return { error: errorMatch[1].trim() };
  }

  // Extract cookie from status element attributes
  // Format: <status MFL_USER_ID="cookievalue" .../>
  const cookieMatch = xml.match(/MFL_USER_ID="([^"]+)"/);
  if (cookieMatch) {
    return { cookie: cookieMatch[1] };
  }

  return { error: 'Unexpected response from MFL login.' };
}

/**
 * Parse MFL myleagues XML response into a JSON-like structure.
 * Extracts league entries with id and franchise_id.
 *
 * Format: <leagues><league id="13522" name="TheLeague" franchise_id="0003" .../></leagues>
 */
function parseMFLMyLeaguesXML(xml: string): any | null {
  // Check if it's actually HTML (invalid credentials return the full page)
  if (xml.includes('<!DOCTYPE') && !xml.includes('<leagues')) {
    return null;
  }

  const leagues: any[] = [];
  const leagueRegex = /<league\s+([^>]+)\/?>/g;
  let match;

  while ((match = leagueRegex.exec(xml)) !== null) {
    const attrStr = match[1];
    const entry: Record<string, string> = {};

    // Parse attributes: key="value"
    const attrRegex = /(\w+)="([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
      entry[attrMatch[1]] = attrMatch[2];
    }

    if (Object.keys(entry).length > 0) {
      leagues.push(entry);
    }
  }

  if (leagues.length === 0) return null;

  return { myleagues: { league: leagues } };
}

/**
 * Authenticate user against MFL API.
 *
 * Step 1: POST /login with XML=1 to get the MFL_USER_ID cookie.
 * Step 2: GET /myleagues with the cookie to resolve franchise_id.
 *
 * @param username - MFL username
 * @param password - MFL password
 * @param leagueId - League ID to match against (e.g. "13522")
 */
export async function authenticateWithMFL(
  username: string,
  password: string,
  leagueId?: string
): Promise<MFLLoginResponse> {
  try {
    const year = new Date().getFullYear();

    // ── Step 1: Login to get MFL_USER_ID cookie ─────────────────────
    // MFL recommends POST for security. We try POST first, then fall
    // back to GET if POST returns empty (some MFL hosts redirect POST→GET).
    const loginUrl = `https://api.myfantasyleague.com/${year}/login`;
    const loginParams = new URLSearchParams({
      USERNAME: username,
      PASSWORD: password,
      XML: '1',
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log('[mfl-login] Step 1: calling /login (year:', year, ')');
    }

    // Try POST first (MFL-recommended method)
    let loginResponse = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: loginParams.toString(),
    });

    let loginText = await loginResponse.text();

    // If POST returned empty body (redirect converted POST→GET), fall back to GET
    if (!loginText.trim()) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[mfl-login] POST returned empty, falling back to GET');
      }
      loginResponse = await fetch(`${loginUrl}?${loginParams.toString()}`, {
        method: 'GET',
      });
      loginText = await loginResponse.text();
    }

    if (!loginResponse.ok && !loginText.trim()) {
      return {
        success: false,
        error: `MFL API error: ${loginResponse.status} ${loginResponse.statusText}`,
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

    if (process.env.NODE_ENV !== 'production') {
      console.log('[mfl-login] Got MFL cookie (length:', mflCookie.length, ')');
    }

    // ── Step 2: Call myleagues to get franchise_id ────────────────
    // Pass credentials directly (Cookie header gets dropped by some runtimes).
    // Try JSON=1 first, fall back to XML=1 if we get HTML back.
    const mlBaseUrl = `https://api.myfantasyleague.com/${year}/myleagues`;
    const mlCredsParams = `USERNAME=${encodeURIComponent(username)}&PASSWORD=${encodeURIComponent(password)}`;

    if (process.env.NODE_ENV !== 'production') {
      console.log('[mfl-login] Step 2: calling /myleagues with credentials');
    }

    let mlResponse = await fetch(`${mlBaseUrl}?${mlCredsParams}&JSON=1`, {
      method: 'GET',
    });

    let mlText = await mlResponse.text();
    let mlData: any;

    // Try parsing JSON response
    try {
      mlData = JSON.parse(mlText);
    } catch {
      // JSON=1 returned HTML — try XML=1 and parse that instead
      if (process.env.NODE_ENV !== 'production') {
        console.log('[mfl-login] JSON=1 returned non-JSON, trying XML=1');
      }

      mlResponse = await fetch(`${mlBaseUrl}?${mlCredsParams}&XML=1`, {
        method: 'GET',
      });
      mlText = await mlResponse.text();

      // Parse XML response for league data
      mlData = parseMFLMyLeaguesXML(mlText);

      if (!mlData) {
        return {
          success: true,
          userId: mflCookie,
          username,
          franchiseId: '',
          leagueId: leagueId || '',
          role: 'owner',
          error: `myleagues returned unparseable response. URL: ${mlResponse.url}`,
          rawResponse: mlText.substring(0, 300),
        };
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('[mfl-login] myleagues response:', JSON.stringify(mlData, null, 2).substring(0, 1000));
    }

    // Extract leagues array
    const leagues = (
      mlData?.myleagues?.league ??
      mlData?.leagues?.league ??
      []
    ) as any[];

    // MFL returns a single object instead of array when there's only one league
    const leagueList = Array.isArray(leagues) ? leagues : leagues ? [leagues] : [];

    if (leagueList.length === 0) {
      return {
        success: true,
        userId: mflCookie,
        username,
        franchiseId: '',
        leagueId: leagueId || '',
        role: 'owner',
        error: 'myleagues returned JSON but no leagues in array',
        rawResponse: JSON.stringify(mlData).substring(0, 500),
      };
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('[mfl-login] Found', leagueList.length, 'leagues');
    }

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

    if (process.env.NODE_ENV !== 'production') {
      console.log('[mfl-login] Resolved franchiseId:', franchiseId, 'leagueId:', resolvedLeagueId);
    }

    return {
      success: true,
      userId: mflCookie,
      username,
      franchiseId,
      leagueId: resolvedLeagueId,
      role: 'owner',
      rawResponse: mlData,
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
    });

    // If we get a response without auth error, session is valid
    return response.ok || response.status !== 401;
  } catch {
    return false;
  }
}
