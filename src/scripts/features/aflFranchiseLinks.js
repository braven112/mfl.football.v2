/**
 * AFL Fantasy Franchise Links
 * Updates franchise-specific links with myteam query parameter
 * Used to set team preference cookie when user clicks links from MFL
 */

const DEBUG = false; // Set to true to enable console logging

/**
 * Update franchise-specific links with query parameters for AFL Fantasy
 * @param {Document|Element} scope - The DOM scope to search within
 */
export function updateAFLFranchiseLinks(scope = document) {
  if (DEBUG) {
    console.log('[aflFranchiseLinks] updateAFLFranchiseLinks called');
    console.log('[aflFranchiseLinks] window.franchise_id:', window.franchise_id);
  }

  if (!scope || !window.franchise_id) {
    if (DEBUG) {
      console.log('[aflFranchiseLinks] Returning early - scope or franchise_id missing');
    }
    return;
  }

  // Update GM Central or main AFL link if it exists
  const gmCentralLink = scope.querySelector('#gmCentral');
  if (DEBUG) {
    console.log('[aflFranchiseLinks] gmCentral link found:', !!gmCentralLink);
  }

  if (gmCentralLink) {
    const newHref = `https://mflfootballv2.vercel.app/afl-fantasy/standings?myteam=${window.franchise_id}`;
    if (DEBUG) {
      console.log('[aflFranchiseLinks] Updating href to:', newHref);
    }
    gmCentralLink.href = newHref;
  }

  // Update any other franchise-specific links
  updateAFLLinks(scope, window.franchise_id);
}

/**
 * Update all AFL Fantasy franchise links in the given scope
 * @param {Document|Element} scope - The DOM scope to search within
 * @param {string} franchiseId - The franchise ID to use
 */
function updateAFLLinks(scope, franchiseId) {
  // Define links that should include the myteam parameter
  const linksToUpdate = [
    { selector: 'a[href*="/afl-fantasy/standings"]', page: 'standings' },
    { selector: 'a[href*="/afl-fantasy/schedule"]', page: 'schedule' },
    { selector: 'a[href*="/afl-fantasy/playoffs"]', page: 'playoffs' },
    { selector: 'a[href*="/afl-fantasy/draft-predictor"]', page: 'draft-predictor' },
  ];

  linksToUpdate.forEach(({ selector, page }) => {
    const links = scope.querySelectorAll(selector);
    links.forEach((link) => {
      const url = new URL(link.href);
      
      // Only add myteam if it's not already there
      if (!url.searchParams.has('myteam') && !url.searchParams.has('franchise')) {
        url.searchParams.set('myteam', franchiseId);
        link.href = url.toString();
        
        if (DEBUG) {
          console.log(`[aflFranchiseLinks] Updated ${page} link:`, link.href);
        }
      }
    });
  });
}

/**
 * Get current AFL franchise ID from cookie
 * @returns {string|null} - The franchise ID or null if not found
 */
export function getAFLFranchiseIdFromCookie() {
  try {
    const cookieValue = document.cookie
      .split('; ')
      .find(row => row.startsWith('afl_team_pref='))
      ?.split('=')[1];
    
    if (!cookieValue) return null;
    
    const preference = JSON.parse(decodeURIComponent(cookieValue));
    return preference?.franchiseId || null;
  } catch (error) {
    if (DEBUG) {
      console.error('[aflFranchiseLinks] Error reading cookie:', error);
    }
    return null;
  }
}

/**
 * Get AFL team data from cookie (includes conference and competition)
 * @returns {Object|null} - The preference object or null if not found
 */
export function getAFLPreferenceFromCookie() {
  try {
    const cookieValue = document.cookie
      .split('; ')
      .find(row => row.startsWith('afl_team_pref='))
      ?.split('=')[1];
    
    if (!cookieValue) return null;
    
    const preference = JSON.parse(decodeURIComponent(cookieValue));
    
    // Validate structure
    if (!preference?.franchiseId || !preference?.conferenceId || !preference?.competitionId) {
      return null;
    }
    
    return {
      franchiseId: preference.franchiseId,
      conferenceId: preference.conferenceId, // "A" or "B"
      competitionId: preference.competitionId, // "Premier League" or "D-League"
      lastUpdated: preference.lastUpdated,
    };
  } catch (error) {
    if (DEBUG) {
      console.error('[aflFranchiseLinks] Error reading cookie:', error);
    }
    return null;
  }
}

/**
 * Set AFL franchise ID cookie (client-side)
 * Note: This is a fallback. Server-side cookie setting is preferred.
 * Requires conference and competition IDs - these should come from team data lookup
 * @param {string} franchiseId - The franchise ID to store
 * @param {string} conferenceId - The conference ID ("A" or "B")
 * @param {string} competitionId - The competition/tier ("Premier League" or "D-League")
 */
export function setAFLFranchiseIdCookie(franchiseId, conferenceId, competitionId) {
  const preference = {
    franchiseId: franchiseId,
    conferenceId: conferenceId,
    competitionId: competitionId,
    lastUpdated: new Date().toISOString(),
  };
  
  const maxAge = 365 * 24 * 60 * 60; // 1 year in seconds
  const cookieString = `afl_team_pref=${encodeURIComponent(JSON.stringify(preference))}; max-age=${maxAge}; path=/; samesite=lax`;
  
  document.cookie = cookieString;
  
  if (DEBUG) {
    console.log('[aflFranchiseLinks] Cookie set:', cookieString);
  }
}

/**
 * Get conference display name from code
 * @param {string} code - Conference code ("A" or "B")
 * @returns {string} - Display name ("American League" or "National League")
 */
export function getConferenceName(code) {
  return code === 'A' ? 'American League' : 'National League';
}

/**
 * Get conference short code from code
 * @param {string} code - Conference code ("A" or "B")
 * @returns {string} - Short code ("AL" or "NL")
 */
export function getConferenceShortCode(code) {
  return code === 'A' ? 'AL' : 'NL';
}
