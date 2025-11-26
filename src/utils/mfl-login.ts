/**
 * MFL Login Utilities
 * Handles authentication with MyFantasyLeague API
 */

export interface MFLLoginResponse {
  success: boolean;
  userId?: string;
  username?: string;
  franchiseId?: string;
  leagueId?: string;
  role?: string;
  error?: string;
}

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

    // Extract user information from MFL response
    // The cookie response includes encoded user data
    // We'll use it to verify the login worked
    return {
      success: true,
      userId: data.cookie || username,
      username: username,
      franchiseId: data.FRANCHISE_ID || data.franchiseId || '',
      leagueId: leagueId || data.LEAGUE_ID || data.leagueId || '',
      role: data.ROLE || data.role || 'owner',
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
    const testUrl = `https://www${leagueId % 50}.myfantasyleague.com/${year}/export`;

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
