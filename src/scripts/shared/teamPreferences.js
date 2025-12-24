/**
 * Shared Team Preference Utilities (Client-Side)
 * Common functions for handling team preferences in the browser
 * Works alongside server-side team-preferences.ts utilities
 */

const DEBUG = false; // Set to true to enable console logging

/**
 * Parse a cookie value safely
 * @param {string} cookieValue - The raw cookie value
 * @returns {Object|null} - Parsed object or null if invalid
 */
function parseCookieValue(cookieValue) {
  try {
    return JSON.parse(decodeURIComponent(cookieValue));
  } catch (error) {
    if (DEBUG) {
      console.error('[teamPreferences] Error parsing cookie:', error);
    }
    return null;
  }
}

/**
 * Get a specific cookie by name
 * @param {string} cookieName - The name of the cookie to retrieve
 * @returns {string|null} - The cookie value or null if not found
 */
export function getCookie(cookieName) {
  const cookie = document.cookie
    .split('; ')
    .find(row => row.startsWith(`${cookieName}=`));
  
  return cookie ? cookie.split('=')[1] : null;
}

/**
 * Set a cookie with standard options
 * @param {string} name - Cookie name
 * @param {Object} value - Cookie value (will be JSON stringified)
 * @param {number} maxAge - Max age in seconds (default: 1 year)
 */
export function setCookie(name, value, maxAge = 365 * 24 * 60 * 60) {
  const cookieString = `${name}=${encodeURIComponent(JSON.stringify(value))}; max-age=${maxAge}; path=/; samesite=lax`;
  document.cookie = cookieString;
  
  if (DEBUG) {
    console.log(`[teamPreferences] Cookie set: ${name}`, value);
  }
}

/**
 * Delete a cookie
 * @param {string} name - Cookie name to delete
 */
export function deleteCookie(name) {
  document.cookie = `${name}=; max-age=0; path=/`;
  
  if (DEBUG) {
    console.log(`[teamPreferences] Cookie deleted: ${name}`);
  }
}

/**
 * Get TheLeague preference from cookie (client-side)
 * @returns {Object|null} - Preference object with franchiseId and lastUpdated
 */
export function getTheLeaguePreference() {
  const cookieValue = getCookie('theleague_team_pref');
  if (!cookieValue) return null;
  
  const preference = parseCookieValue(cookieValue);
  
  // Validate structure
  if (!preference?.franchiseId || !preference?.lastUpdated) {
    return null;
  }
  
  return {
    franchiseId: preference.franchiseId,
    lastUpdated: preference.lastUpdated,
  };
}

/**
 * Get AFL preference from cookie (client-side)
 * @returns {Object|null} - Preference object with franchiseId, conferenceId, competitionId, lastUpdated
 */
export function getAFLPreference() {
  const cookieValue = getCookie('afl_team_pref');
  if (!cookieValue) return null;
  
  const preference = parseCookieValue(cookieValue);
  
  // Validate structure
  if (!preference?.franchiseId || !preference?.conferenceId || !preference?.competitionId || !preference?.lastUpdated) {
    return null;
  }
  
  return {
    franchiseId: preference.franchiseId,
    conferenceId: preference.conferenceId,
    competitionId: preference.competitionId,
    lastUpdated: preference.lastUpdated,
  };
}

/**
 * Update all links on the page to include team preference parameters
 * @param {string} league - "theleague" or "afl"
 * @param {string} franchiseId - The franchise ID to use
 * @param {Document|Element} scope - The DOM scope to search within
 */
export function updateAllLinksWithPreference(league, franchiseId, scope = document) {
  const prefix = league === 'theleague' ? '/theleague/' : '/afl-fantasy/';
  const links = scope.querySelectorAll(`a[href*="${prefix}"]`);
  
  links.forEach((link) => {
    try {
      const url = new URL(link.href);
      
      // Only add myteam if not already present and not external
      if (url.origin === window.location.origin && 
          !url.searchParams.has('myteam') && 
          !url.searchParams.has('franchise')) {
        url.searchParams.set('myteam', franchiseId);
        link.href = url.toString();
        
        if (DEBUG) {
          console.log(`[teamPreferences] Updated link: ${link.href}`);
        }
      }
    } catch (error) {
      // Ignore invalid URLs
      if (DEBUG) {
        console.warn('[teamPreferences] Invalid URL:', link.href);
      }
    }
  });
}

/**
 * Get URL parameter value
 * @param {string} paramName - The parameter name to look for
 * @returns {string|null} - The parameter value or null
 */
export function getUrlParameter(paramName) {
  const params = new URLSearchParams(window.location.search);
  return params.get(paramName);
}

/**
 * Check if current page should show a specific team based on URL params and cookies
 * @param {string} league - "theleague" or "afl"
 * @returns {string|null} - The franchise ID to display or null
 */
export function getDisplayTeam(league) {
  // Priority order: myteam param → franchise param → cookie
  const myTeamParam = getUrlParameter('myteam');
  const franchiseParam = getUrlParameter('franchise');
  
  if (myTeamParam) return myTeamParam;
  if (franchiseParam) return franchiseParam;
  
  // Get from cookie
  if (league === 'theleague') {
    const pref = getTheLeaguePreference();
    return pref?.franchiseId || null;
  } else {
    const pref = getAFLPreference();
    return pref?.franchiseId || null;
  }
}

/**
 * Initialize team preferences on page load
 * - Reads URL parameters
 * - Updates cookies if myteam parameter is present
 * - Updates links with team preferences
 * @param {string} league - "theleague" or "afl"
 */
export function initializeTeamPreferences(league) {
  const myTeamParam = getUrlParameter('myteam');
  
  if (myTeamParam) {
    // Note: Cookie setting should ideally be done server-side
    // This is a client-side fallback
    if (DEBUG) {
      console.log(`[teamPreferences] myteam parameter detected: ${myTeamParam}`);
      console.log('[teamPreferences] Cookie should be set server-side');
    }
  }
  
  // Get the team to display
  const displayTeam = getDisplayTeam(league);
  
  if (displayTeam && DEBUG) {
    console.log(`[teamPreferences] Display team for ${league}:`, displayTeam);
  }
  
  return displayTeam;
}

/**
 * Normalize franchise ID to 4-digit format
 * @param {string} franchiseId - The franchise ID to normalize
 * @returns {string} - Normalized franchise ID
 */
export function normalizeFranchiseId(franchiseId) {
  if (!franchiseId) return '0001';
  const trimmed = franchiseId.trim();
  if (!trimmed) return '0001';

  // Pad to 4 digits if it's a number
  const padded = /^\d+$/.test(trimmed) ? trimmed.padStart(4, '0') : trimmed;

  // Convert commissioner (0000) to first team (0001)
  return padded === '0000' ? '0001' : padded;
}
