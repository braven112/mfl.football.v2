/**
 * Navigation Utilities
 *
 * Provides visibility checks, smart routing, URL building, and cookie handling
 * for the unified navigation drawer component.
 *
 * Usage:
 * ```typescript
 * import {
 *   isLinkVisible,
 *   isSectionVisible,
 *   getEquivalentRoute,
 *   buildUrlFromTemplate,
 *   getLinkHref,
 * } from '../utils/nav-utils';
 * ```
 */

import type { NavLink, NavSection, LeagueSlug } from '../types/nav';
import { NAV_COOKIES } from '../types/nav';
import { navConfig, getRouteEquivalence } from '../config/nav-config';

// ============================================================================
// URL Template Building
// ============================================================================

/**
 * Parameters for building URLs from templates
 */
export interface UrlTemplateParams {
  host: string;
  year: string | number;
  leagueId: string;
  franchiseId?: string;
}

/**
 * Build a URL from a template string
 *
 * Supported placeholders:
 * - {host} - MFL host (e.g., "www49.myfantasyleague.com")
 * - {year} - League year (e.g., "2025")
 * - {leagueId} - MFL league ID (e.g., "13522")
 * - {franchiseId} - User's franchise ID (e.g., "0001")
 *
 * @param template - URL template with placeholders
 * @param params - Values to substitute into template
 * @returns Fully resolved URL
 *
 * @example
 * buildUrlFromTemplate(
 *   'https://{host}/{year}/lineup?L={leagueId}',
 *   { host: 'www49.myfantasyleague.com', year: '2025', leagueId: '13522' }
 * );
 * // Returns: 'https://www49.myfantasyleague.com/2025/lineup?L=13522'
 */
export function buildUrlFromTemplate(
  template: string,
  params: UrlTemplateParams
): string {
  let url = template;

  // Replace all supported placeholders
  url = url.replace(/\{host\}/g, params.host);
  url = url.replace(/\{year\}/g, String(params.year));
  url = url.replace(/\{leagueId\}/g, params.leagueId);

  if (params.franchiseId) {
    url = url.replace(/\{franchiseId\}/g, params.franchiseId);
  }

  return url;
}

// ============================================================================
// Link URL Resolution
// ============================================================================

/**
 * League path prefixes for URL construction
 */
const LEAGUE_PREFIXES: Record<LeagueSlug, string> = {
  theleague: '/theleague',
  afl: '/afl-fantasy',
};

/**
 * Get the full href for a navigation link
 *
 * Handles three types of links:
 * 1. Static external URLs (link.url)
 * 2. Template URLs (link.urlTemplate) - resolved with params
 * 3. Internal paths (link.path) - prefixed with league path
 *
 * @param link - Navigation link configuration
 * @param league - Current league context
 * @param params - URL template parameters (for external MFL links)
 * @returns Fully resolved href
 */
export function getLinkHref(
  link: NavLink,
  league: LeagueSlug,
  params: UrlTemplateParams
): string {
  // Static external URL takes precedence
  if (link.url) {
    return link.url;
  }

  // URL template needs parameter substitution
  if (link.urlTemplate) {
    return buildUrlFromTemplate(link.urlTemplate, params);
  }

  // Internal path gets league prefix
  if (link.path) {
    const prefix = LEAGUE_PREFIXES[league];
    return `${prefix}${link.path}`;
  }

  // Fallback
  return '#';
}

/**
 * Get the display label for a link based on league
 *
 * @param link - Navigation link
 * @param league - Current league
 * @returns Appropriate label for the league
 */
export function getLinkLabel(link: NavLink, league: LeagueSlug): string {
  if (league === 'afl' && link.labelAFL) {
    return link.labelAFL;
  }
  return link.label;
}

/**
 * Get the icon ID for a link based on league
 *
 * @param link - Navigation link
 * @param league - Current league
 * @returns Appropriate icon ID for the league
 */
export function getLinkIcon(link: NavLink, league: LeagueSlug): string {
  if (league === 'afl' && link.iconAFL) {
    return link.iconAFL;
  }
  return link.icon;
}

// ============================================================================
// Visibility Logic
// ============================================================================

/**
 * Check if a navigation link should be visible
 *
 * Visibility rules:
 * - 'public' or undefined: Always visible
 * - 'owner': Visible only when franchiseId is set (user is authenticated)
 * - 'admin': Visible only when franchiseId is in adminFranchiseIds
 *
 * @param link - Navigation link to check
 * @param franchiseId - User's franchise ID (null if not authenticated)
 * @param adminFranchiseIds - List of admin franchise IDs
 * @returns true if link should be visible
 */
export function isLinkVisible(
  link: NavLink,
  franchiseId: string | null,
  adminFranchiseIds: string[] = navConfig.adminFranchiseIds
): boolean {
  // No visibility restriction means public
  if (!link.visibility || link.visibility === 'public') {
    return true;
  }

  // Owner visibility - must have a franchise ID
  if (link.visibility === 'owner') {
    return franchiseId !== null && franchiseId !== '';
  }

  // Admin visibility - must be in admin list
  if (link.visibility === 'admin') {
    return franchiseId !== null && adminFranchiseIds.includes(franchiseId);
  }

  return false;
}

/**
 * Check if a navigation section should be visible
 *
 * A section is visible if:
 * 1. It matches the current league (or has no league restriction)
 * 2. It passes visibility checks (admin/owner)
 * 3. It has at least one visible link
 *
 * @param section - Navigation section to check
 * @param league - Current league context
 * @param franchiseId - User's franchise ID (null if not authenticated)
 * @param adminFranchiseIds - List of admin franchise IDs
 * @returns true if section should be visible
 */
export function isSectionVisible(
  section: NavSection,
  league: LeagueSlug,
  franchiseId: string | null,
  adminFranchiseIds: string[] = navConfig.adminFranchiseIds
): boolean {
  // Check league restriction
  if (section.leagueOnly && section.leagueOnly !== league) {
    return false;
  }

  // Check section-level visibility
  if (section.visibility === 'admin') {
    if (!franchiseId || !adminFranchiseIds.includes(franchiseId)) {
      return false;
    }
  } else if (section.visibility === 'owner') {
    if (!franchiseId) {
      return false;
    }
  }

  // Check if at least one link is visible
  const hasVisibleLinks = section.links.some(link => {
    // Check link's league restriction
    if (link.leagueOnly && link.leagueOnly !== league) {
      return false;
    }
    return isLinkVisible(link, franchiseId, adminFranchiseIds);
  });

  return hasVisibleLinks;
}

/**
 * Get visible links for a section
 *
 * Filters out links that don't match league or visibility requirements.
 *
 * @param section - Navigation section
 * @param league - Current league context
 * @param franchiseId - User's franchise ID (null if not authenticated)
 * @param adminFranchiseIds - List of admin franchise IDs
 * @returns Array of visible links
 */
export function getVisibleLinks(
  section: NavSection,
  league: LeagueSlug,
  franchiseId: string | null,
  adminFranchiseIds: string[] = navConfig.adminFranchiseIds
): NavLink[] {
  return section.links.filter(link => {
    // Check link's league restriction
    if (link.leagueOnly && link.leagueOnly !== league) {
      return false;
    }
    return isLinkVisible(link, franchiseId, adminFranchiseIds);
  });
}

/**
 * Get all visible sections with their visible links
 *
 * @param league - Current league context
 * @param franchiseId - User's franchise ID (null if not authenticated)
 * @param adminFranchiseIds - List of admin franchise IDs
 * @returns Array of visible sections with filtered links
 */
export function getVisibleSections(
  league: LeagueSlug,
  franchiseId: string | null,
  adminFranchiseIds: string[] = navConfig.adminFranchiseIds
): NavSection[] {
  return navConfig.sections
    .filter(section => isSectionVisible(section, league, franchiseId, adminFranchiseIds))
    .map(section => ({
      ...section,
      links: getVisibleLinks(section, league, franchiseId, adminFranchiseIds),
    }));
}

// ============================================================================
// Smart Routing (League Switching)
// ============================================================================

/**
 * Get the equivalent route when switching leagues
 *
 * Uses the routeEquivalence map from nav-config.json to determine
 * if the current page exists in the target league.
 *
 * @param currentPath - Current page path (e.g., '/theleague/rosters')
 * @param targetLeague - League to switch to
 * @returns Equivalent path in target league, or league home if no equivalent
 *
 * @example
 * getEquivalentRoute('/theleague/rosters', 'afl');
 * // Returns: '/afl-fantasy/rosters'
 *
 * getEquivalentRoute('/theleague/some-page', 'afl');
 * // Returns: '/afl-fantasy' (fallback to home)
 */
export function getEquivalentRoute(
  currentPath: string,
  targetLeague: LeagueSlug
): string {
  const targetPrefix = LEAGUE_PREFIXES[targetLeague];
  const routeMap = getRouteEquivalence();

  // Strip the current league prefix to get the page path
  let pagePath = currentPath;

  // Remove league prefix if present
  for (const prefix of Object.values(LEAGUE_PREFIXES)) {
    if (pagePath.startsWith(prefix)) {
      pagePath = pagePath.slice(prefix.length);
      break;
    }
  }

  // Handle root path
  if (!pagePath || pagePath === '/') {
    return targetPrefix;
  }

  // Split path and query string
  const [pathname, queryString] = pagePath.split('?');
  const fullPath = queryString ? `${pathname}?${queryString}` : pathname;

  // Check if this exact path (with query) exists in equivalence map
  if (routeMap[fullPath]) {
    return `${targetPrefix}${routeMap[fullPath]}`;
  }

  // Check if the base path (without query) exists
  if (routeMap[pathname]) {
    const basePath = routeMap[pathname];
    return queryString ? `${targetPrefix}${basePath}?${queryString}` : `${targetPrefix}${basePath}`;
  }

  // No equivalent found, return target league home
  return targetPrefix;
}

/**
 * Check if a link is currently active
 *
 * @param linkHref - The href of the link
 * @param currentPath - Current page path
 * @param external - Whether the link is external
 * @returns true if the link should be marked as active
 */
export function isLinkActive(
  linkHref: string,
  currentPath: string,
  external?: boolean
): boolean {
  // External links are never "active" in the traditional sense
  if (external) {
    return false;
  }

  // Normalize paths for comparison
  const normalizedLink = linkHref.split('?')[0].replace(/\/$/, '') || '/';
  const normalizedCurrent = currentPath.split('?')[0].replace(/\/$/, '') || '/';

  return normalizedLink === normalizedCurrent;
}

// ============================================================================
// Cookie Utilities
// ============================================================================

/**
 * Get a cookie value by name (client-side)
 *
 * @param name - Cookie name
 * @returns Cookie value or null if not found
 */
export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [cookieName, cookieValue] = cookie.trim().split('=');
    if (cookieName === name) {
      return decodeURIComponent(cookieValue);
    }
  }
  return null;
}

/**
 * Set a cookie (client-side)
 *
 * @param name - Cookie name
 * @param value - Cookie value
 * @param days - Number of days until expiration (default: 365)
 */
export function setCookie(name: string, value: string, days: number = 365): void {
  if (typeof document === 'undefined') {
    return;
  }

  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);

  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
}

/**
 * Delete a cookie (client-side)
 *
 * @param name - Cookie name to delete
 */
export function deleteCookie(name: string): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
}

/**
 * Get the nav collapsed preference from cookie
 *
 * @returns true if nav should be collapsed, false otherwise
 */
export function getNavCollapsedPreference(): boolean {
  const value = getCookie(NAV_COOKIES.NAV_COLLAPSED);
  return value === 'true';
}

/**
 * Set the nav collapsed preference cookie
 *
 * @param collapsed - Whether nav should be collapsed
 */
export function setNavCollapsedPreference(collapsed: boolean): void {
  setCookie(NAV_COOKIES.NAV_COLLAPSED, String(collapsed));
}

/**
 * Get the myteam cookie value (franchise ID)
 *
 * @returns Franchise ID or null if not set
 */
export function getMyTeamCookie(): string | null {
  return getCookie(NAV_COOKIES.MY_TEAM);
}

/**
 * Set the myteam cookie with franchise ID and league
 *
 * @param franchiseId - User's franchise ID
 * @param league - League the team belongs to
 */
export function setMyTeamCookie(franchiseId: string, league: LeagueSlug): void {
  setCookie(NAV_COOKIES.MY_TEAM, franchiseId);
  setCookie(NAV_COOKIES.MY_TEAM_LEAGUE, league);
}

/**
 * Clear the myteam cookies
 */
export function clearMyTeamCookie(): void {
  deleteCookie(NAV_COOKIES.MY_TEAM);
  deleteCookie(NAV_COOKIES.MY_TEAM_LEAGUE);
}

/**
 * Get the myteam league cookie value
 *
 * @returns League slug or null if not set
 */
export function getMyTeamLeagueCookie(): LeagueSlug | null {
  const value = getCookie(NAV_COOKIES.MY_TEAM_LEAGUE);
  if (value === 'theleague' || value === 'afl') {
    return value;
  }
  return null;
}

/**
 * Parse myteam parameter from URL
 *
 * Checks for ?myteam=XXXX in the URL and returns the value if present.
 * This is used to capture the franchise ID when redirecting back from MFL.
 *
 * @param url - URL object to parse
 * @returns Franchise ID or null if not present
 *
 * @example
 * const url = new URL('https://mfl.football/theleague/rosters?myteam=0003');
 * parseMyTeamFromUrl(url); // Returns: '0003'
 */
export function parseMyTeamFromUrl(url: URL): string | null {
  const myteam = url.searchParams.get('myteam');
  if (!myteam) {
    return null;
  }

  // Normalize to 4-digit format
  const normalized = myteam.padStart(4, '0');

  // Validate it looks like a franchise ID (4 digits)
  if (!/^\d{4}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

/**
 * Get the last viewed league from cookie
 *
 * @returns League slug or null if not set
 */
export function getLastViewedLeague(): LeagueSlug | null {
  const value = getCookie(NAV_COOKIES.NAV_LEAGUE);
  if (value === 'theleague' || value === 'afl') {
    return value;
  }
  return null;
}

/**
 * Set the last viewed league cookie
 *
 * @param league - League that was last viewed
 */
export function setLastViewedLeague(league: LeagueSlug): void {
  setCookie(NAV_COOKIES.NAV_LEAGUE, league);
}
