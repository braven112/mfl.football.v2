/**
 * MFL Login Utilities
 * Handles authentication with MyFantasyLeague API
 *
 * Strategy: Use the `myleagues` endpoint as the primary auth method.
 * It accepts USERNAME/PASSWORD, validates credentials, and returns
 * the user's franchise_id in each league — all in one GET request.
 * This avoids the POST→GET redirect issue with the /login endpoint.
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
 * Authenticate user against MFL API using the myleagues endpoint.
 * This is more reliable than the /login endpoint because:
 * 1. Uses GET (no POST→GET redirect issues)
 * 2. Validates credentials AND returns franchise_id in one call
 * 3. The /login endpoint only returns a cookie, not franchise_id
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

    // Use myleagues endpoint: validates credentials AND returns franchise_id
    const myLeaguesUrl = `https://api.myfantasyleague.com/${year}/myleagues?USERNAME=${encodeURIComponent(
      username
    )}&PASSWORD=${encodeURIComponent(password)}&JSON=1`;

    if (process.env.NODE_ENV !== 'production') {
      console.log('[mfl-login] Calling myleagues for auth (year:', year, ')');
    }

    const response = await fetch(myLeaguesUrl, { method: 'GET' });

    if (!response.ok) {
      return {
        success: false,
        error: `MFL API error: ${response.status} ${response.statusText}`,
      };
    }

    const contentType = response.headers.get('content-type');
    let data: any;

    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        // MFL returns HTML (the login page) when credentials are invalid
        if (text.includes('<title>') || text.includes('<!DOCTYPE')) {
          return {
            success: false,
            error: 'Invalid username or password.',
          };
        }
        console.warn('[mfl-login] Non-JSON from myleagues. Content-Type:', contentType, 'Body:', text.substring(0, 200));
        return {
          success: false,
          error: 'MFL returned an unexpected response. The service may be temporarily unavailable.',
          rawResponse: text.substring(0, 500),
        };
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('[mfl-login] myleagues response:', JSON.stringify(data, null, 2).substring(0, 1000));
    }

    // Check for explicit errors (bad credentials return an error field)
    if (data.error) {
      return {
        success: false,
        error: data.error,
      };
    }

    // Extract leagues array from response
    const leagues = (
      data?.myleagues?.league ??
      data?.leagues?.league ??
      []
    ) as any[];

    // Normalize: MFL returns a single object instead of array when there's only one league
    const leagueList = Array.isArray(leagues) ? leagues : leagues ? [leagues] : [];

    if (leagueList.length === 0) {
      return {
        success: false,
        error: 'Invalid credentials or no leagues found for this account.',
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
        success: false,
        error: `Your account is not a member of league ${leagueId}.`,
      };
    }

    if (!targetLeague) {
      return {
        success: false,
        error: 'Could not determine your league membership.',
      };
    }

    // Extract franchise_id from the target league
    const franchiseId = normalizeFranchise(
      targetLeague.franchise_id ??
      targetLeague.franchiseId ??
      targetLeague.FranchiseId ??
      targetLeague.team_id ??
      targetLeague.teamId ??
      targetLeague.team ??
      ''
    );

    const resolvedLeagueId =
      `${targetLeague.id ?? targetLeague.league_id ?? targetLeague.leagueId ?? targetLeague.league ?? leagueId ?? ''}`;

    if (process.env.NODE_ENV !== 'production') {
      console.log('[mfl-login] Resolved franchiseId:', franchiseId, 'leagueId:', resolvedLeagueId);
    }

    return {
      success: true,
      userId: username,
      username,
      franchiseId,
      leagueId: resolvedLeagueId,
      role: 'owner',
      rawResponse: data,
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
