/**
 * MFL Login Utilities
 * Handles authentication with MyFantasyLeague API
 */

/**
 * User-to-franchise override map
 * Maps usernames/user IDs to franchise IDs for cases where API doesn't return franchise info
 * Can be configured per-deployment
 */
const USER_FRANCHISE_OVERRIDES: Record<string, string> = {
  // Example: 'username': '0001'
  // Add user-to-franchise mappings here as needed
};

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
 * Authenticate user against MFL API
 * Uses the MFL login endpoint to validate credentials
 *
 * @param username - MFL username
 * @param password - MFL password
 * @param leagueId - League ID to validate against (optional)
 */
export async function authenticateWithMFL(
  username: string,
  password: string,
  leagueId?: string
): Promise<MFLLoginResponse> {
  try {
    const year = new Date().getFullYear();
    const loginUrl = `https://api.myfantasyleague.com/${year}/login`;

    // Prepare login parameters
    const params = new URLSearchParams({
      USERNAME: username,
      PASSWORD: password,
      ...(leagueId && { LEAGUE_ID: leagueId }),
      JSON: '1',
    });

    const response = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `MFL API error: ${response.status} ${response.statusText}`,
      };
    }

    const contentType = response.headers.get('content-type');
    let data: any;

    // Handle both JSON and XML responses
    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else {
      // Try to parse as JSON, fallback to text
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        // MFL might return XML or error message - just check if it's valid
        // If we got here without an error, assume login was successful
        return {
          success: true,
          userId: username,
          username: username,
          franchiseId: '',
          leagueId: leagueId || '',
          role: 'owner',
        };
      }
    }

    // Check for login errors in response
    if (data.error || (data.cookie === undefined && contentType?.includes('json'))) {
      return {
        success: false,
        error: data.error || 'Failed to authenticate with MFL',
      };
    }

    // Debug log for dev to see actual shape
    console.log('[mfl-login] raw login response', data);

    // Extract user information from MFL response
    // The response shape varies across MFL deployments, so normalize generously
    const normalizeId = (...vals: Array<string | undefined | null>) => {
      const val = vals.find((v) => v !== undefined && v !== null && `${v}`.trim() !== '');
      return val ? `${val}` : '';
    };

    const pickFrom = (
      keys: string[],
      sources: Array<Record<string, any> | null | undefined>
    ) => {
      for (const source of sources) {
        if (!source) continue;
        for (const key of keys) {
          if (source[key] !== undefined && source[key] !== null && `${source[key]}`.trim() !== '') {
            return `${source[key]}`;
          }
        }
      }
      return '';
    };

    const sourceCandidates = [data, data?.login, data?.LOGIN, data?.auth];

    // Extract user ID first (needed for franchise override lookup)
    const normalizedUserId = pickFrom(
      ['cookie', 'user_id', 'userId', 'USER_ID', 'USERID', 'user'],
      sourceCandidates
    ) || normalizeId(username);

    let normalizedFranchiseId = pickFrom(
      [
        'FRANCHISE_ID',
        'franchise_id',
        'franchiseId',
        'FranchiseId',
        'franchise',
        'Franchise',
        'team_id',
        'teamId',
        'team',
      ],
      sourceCandidates
    );
    normalizedFranchiseId = normalizeFranchise(normalizedFranchiseId);

    if (!normalizedFranchiseId) {
      const normalizeKey = (v: string | undefined): string | undefined =>
        typeof v === 'string' ? v.trim().toLowerCase() : undefined;
      const keys = [normalizeKey(username), normalizeKey(normalizedUserId)].filter(Boolean) as string[];
      for (const key of keys) {
        if (key && USER_FRANCHISE_OVERRIDES[key]) {
          normalizedFranchiseId = normalizeFranchise(USER_FRANCHISE_OVERRIDES[key]);
          break;
        }
      }
    }

    let normalizedLeagueId = pickFrom(
      ['LEAGUE_ID', 'league_id', 'leagueId', 'LeagueId', 'league'],
      [{ LEAGUE_ID: leagueId }, ...sourceCandidates]
    );

    // If franchiseId still missing, try myleagues lookup (non-blocking best-effort)
    if (!normalizedFranchiseId && username && password) {
      try {
        const myLeaguesUrl = `https://api.myfantasyleague.com/${year}/myleagues?USERNAME=${encodeURIComponent(
          username
        )}&PASSWORD=${encodeURIComponent(password)}&JSON=1`;
        const mlRes = await fetch(myLeaguesUrl, { method: 'GET' });
        if (mlRes.ok) {
          const mlData: any = await mlRes.json();
          const leagues = (mlData?.myleagues?.league ?? mlData?.leagues?.league ?? []) as any[];
          if (process.env.NODE_ENV !== 'production') {
            console.log('[mfl-login] myleagues count', Array.isArray(leagues) ? leagues.length : 0);
          }
          // Try to find matching league, otherwise fall back to first
          const targetLeague =
            leagues.find(
              (l) =>
                `${l.id ?? l.league_id ?? l.leagueId ?? ''}` === `${normalizedLeagueId}` ||
                `${l.league ?? ''}` === `${normalizedLeagueId}` ||
                `${l.name ?? ''}` === `${normalizedLeagueId}`
            ) || leagues[0];

          if (targetLeague) {
            if (!normalizedLeagueId) {
              const foundLeagueId =
                targetLeague.id ?? targetLeague.league_id ?? targetLeague.leagueId ?? targetLeague.league;
              if (foundLeagueId) normalizedLeagueId = `${foundLeagueId}`;
            }

            const leagueFranchise =
              targetLeague?.franchise_id ??
              targetLeague?.franchiseId ??
              targetLeague?.FranchiseId ??
              targetLeague?.team_id ??
              targetLeague?.teamId ??
              targetLeague?.team;
            const normalized = normalizeFranchise(leagueFranchise);
            if (normalized) {
              normalizedFranchiseId = normalized;
            }
          }
        }
      } catch (e) {
        console.warn('[mfl-login] myleagues lookup failed', e);
      }
    }

    return {
      success: true,
      userId: normalizedUserId,
      username,
      franchiseId: normalizedFranchiseId,
      leagueId: normalizedLeagueId,
      role: data.ROLE || data.role || 'owner',
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
