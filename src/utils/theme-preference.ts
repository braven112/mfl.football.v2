/**
 * Theme Preference Cookie Utilities
 * Handles persistent theme preferences (light/dark/auto) across the site
 */

import type { AstroCookies } from 'astro';

/**
 * Theme preference type
 */
export type ThemePreference = 'light' | 'dark' | 'auto';

/**
 * Cookie name for theme preference
 */
export const THEME_COOKIE_NAME = 'theme_pref';

/**
 * Cookie configuration
 */
const COOKIE_CONFIG = {
  maxAge: 365 * 24 * 60 * 60, // 1 year in seconds
  path: '/',
  sameSite: 'lax' as const,
  secure: import.meta.env.PROD, // HTTPS only in production
  httpOnly: false, // Accessible to client JS
};

/**
 * Type guard to validate theme preference value
 * @param value - Unknown value to validate
 * @returns True if value is a valid ThemePreference
 */
export function isValidThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'auto';
}

/**
 * Get theme preference from server-side cookies
 * @param cookies - Astro cookies object
 * @returns Theme preference ('light', 'dark', or 'auto'), defaults to 'auto' if cookie absent or invalid
 */
export function getThemePreference(cookies: AstroCookies): ThemePreference {
  try {
    const cookieValue = cookies.get(THEME_COOKIE_NAME);
    if (!cookieValue?.value) return 'auto';

    const preference = cookieValue.value;

    // Validate the preference value
    if (isValidThemePreference(preference)) {
      return preference;
    }

    // Invalid value in cookie, return default
    return 'auto';
  } catch (error) {
    // Parse error or other issue, return default
    return 'auto';
  }
}

/**
 * Set theme preference in server-side cookies
 * @param cookies - Astro cookies object
 * @param pref - Theme preference to set
 */
export function setThemePreference(cookies: AstroCookies, pref: ThemePreference): void {
  cookies.set(THEME_COOKIE_NAME, pref, {
    maxAge: COOKIE_CONFIG.maxAge,
    path: COOKIE_CONFIG.path,
    sameSite: COOKIE_CONFIG.sameSite,
    secure: COOKIE_CONFIG.secure,
    httpOnly: COOKIE_CONFIG.httpOnly,
  });
}

/**
 * Get theme preference from client-side document.cookie
 * @returns Theme preference ('light', 'dark', or 'auto'), defaults to 'auto' if document unavailable or cookie absent
 */
export function getClientThemePreference(): ThemePreference {
  // Guard against document being undefined (e.g., in SSR context)
  if (typeof document === 'undefined') {
    return 'auto';
  }

  try {
    const cookieString = document.cookie;
    if (!cookieString) return 'auto';

    // Parse cookies to find theme_pref
    const cookies = cookieString.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === THEME_COOKIE_NAME) {
        const decoded = decodeURIComponent(value);
        if (isValidThemePreference(decoded)) {
          return decoded;
        }
      }
    }

    return 'auto';
  } catch (error) {
    // Parse error or other issue, return default
    return 'auto';
  }
}

/**
 * Set theme preference in client-side document.cookie
 * @param pref - Theme preference to set
 */
export function setClientThemePreference(pref: ThemePreference): void {
  if (typeof document === 'undefined') {
    return;
  }

  let cookieString = `${THEME_COOKIE_NAME}=${pref}; max-age=${COOKIE_CONFIG.maxAge}; path=${COOKIE_CONFIG.path}; SameSite=Lax`;

  // Add Secure flag if using HTTPS
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    cookieString += '; Secure';
  }

  document.cookie = cookieString;
}

/**
 * Resolve theme preference to actual theme value
 * 'auto' is resolved based on system preference, 'light' and 'dark' are returned as-is
 * @param pref - Theme preference
 * @param systemPrefersDark - Whether system prefers dark mode
 * @returns Resolved theme ('light' or 'dark')
 */
export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): 'light' | 'dark' {
  if (pref === 'auto') {
    return systemPrefersDark ? 'dark' : 'light';
  }
  return pref;
}
