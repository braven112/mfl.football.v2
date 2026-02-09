/**
 * TheLeague Franchise Links
 * Updates franchise-specific links with myteam query parameter
 * Used to set team preference cookie when user clicks links from MFL
 */

const DEBUG = false; // Set to true to enable console logging

/**
 * Update franchise-specific links with query parameters for TheLeague
 * @param {Document|Element} scope - The DOM scope to search within
 */
export function updateFranchiseLinks(scope = document) {
  if (DEBUG) {
    console.log('[franchiseLinks] updateFranchiseLinks called');
    console.log('[franchiseLinks] window.franchise_id:', window.franchise_id);
  }

  if (!scope || !window.franchise_id) {
    if (DEBUG) {
      console.log('[franchiseLinks] Returning early - scope or franchise_id missing');
    }
    return;
  }

  // Update GM Central link
  const gmCentralLink = scope.querySelector('#gmCentral');
  if (DEBUG) {
    console.log('[franchiseLinks] gmCentral link found:', !!gmCentralLink);
  }

  if (gmCentralLink) {
    const newHref = `https://mflfootballv2.vercel.app/theleague/rosters?myteam=${window.franchise_id}`;
    if (DEBUG) {
      console.log('[franchiseLinks] Updating href to:', newHref);
    }
    gmCentralLink.href = newHref;
  }

  // Update any other franchise-specific links
  updateTheLeagueLinks(scope, window.franchise_id);
}

/**
 * Update all TheLeague franchise links in the given scope
 * @param {Document|Element} scope - The DOM scope to search within
 * @param {string} franchiseId - The franchise ID to use
 */
function updateTheLeagueLinks(scope, franchiseId) {
  // Define links that should include the myteam parameter
  const linksToUpdate = [
    { selector: 'a[href*="/theleague/rosters"]', page: 'rosters' },
    { selector: 'a[href*="/theleague/standings"]', page: 'standings' },
    { selector: 'a[href*="/theleague/playoffs"]', page: 'playoffs' },
    { selector: 'a[href*="/theleague/draft-predictor"]', page: 'draft-predictor' },
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
          console.log(`[franchiseLinks] Updated ${page} link:`, link.href);
        }
      }
    });
  });
}

/**
 * Get current franchise ID from cookie
 * @returns {string|null} - The franchise ID or null if not found
 */
export function getFranchiseIdFromCookie() {
  try {
    const cookieValue = document.cookie
      .split('; ')
      .find(row => row.startsWith('theleague_team_pref='))
      ?.split('=')[1];
    
    if (!cookieValue) return null;
    
    const preference = JSON.parse(decodeURIComponent(cookieValue));
    return preference?.franchiseId || null;
  } catch (error) {
    if (DEBUG) {
      console.error('[franchiseLinks] Error reading cookie:', error);
    }
    return null;
  }
}

/**
 * Set franchise ID cookie (client-side)
 * Note: This is a fallback. Server-side cookie setting is preferred.
 * @param {string} franchiseId - The franchise ID to store
 */
export function setFranchiseIdCookie(franchiseId) {
  const preference = {
    franchiseId: franchiseId,
    lastUpdated: new Date().toISOString(),
  };
  
  const maxAge = 365 * 24 * 60 * 60; // 1 year in seconds
  const cookieString = `theleague_team_pref=${encodeURIComponent(JSON.stringify(preference))}; max-age=${maxAge}; path=/; samesite=lax`;
  
  document.cookie = cookieString;
  
  if (DEBUG) {
    console.log('[franchiseLinks] Cookie set:', cookieString);
  }
}
