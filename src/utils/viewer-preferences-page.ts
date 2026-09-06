/**
 * Viewer preferences — the route-side glue: cookies, the Redis mirror, and
 * the order they win in.
 *
 * Kept OUT of `viewer-preferences.ts` because the board components import
 * that one and Chromatic's dependency guard treats everything a story can
 * reach as a rendering file; this half touches the registry, Redis and the
 * session, none of which a story should pull in.
 *
 * Precedence, most explicit first:
 *   1. `?country=` / `?zones=` on the request — someone just chose.
 *   2. The cookie on this device.
 *   3. The signed-in owner's Redis mirror (then written to the cookie, so the
 *      read happens once per device rather than once per render).
 *   4. The defaults — US, ET · PT — exactly what the board showed before
 *      preferences existed.
 *
 * The cookie beating the mirror is deliberate: a device is where "show me
 * Sydney time" is true, and an owner watching from a hotel in Chicago should
 * not have their laptop at home overwrite it on the next render.
 *
 * WRITES ARE ROUTE-ONLY. `Astro.cookies.set()` from an imported component
 * runs after the response headers are committed and throws
 * `ResponseSentError`, blanking the page — the Sunday Ticket country chips
 * shipped exactly that bug. Call `rememberViewerPreferences` from the PAGE's
 * frontmatter; components read the resolved value as a prop.
 */

import { getLeagueById } from '../config/leagues';
import {
  DEFAULT_VIEWER_PREFERENCES,
  parseViewerPreferences,
  type ViewerPreferences,
} from './viewer-preferences';
import { getStoredViewerPreferences, setStoredViewerPreferences } from './viewer-preferences-store';

export const COUNTRY_COOKIE = 'pref_country';
export const ZONES_COOKIE = 'pref_zones';
/**
 * The Sunday Ticket board's original country cookie. Read-only here: an owner
 * who picked Canada last week keeps Canada without touching anything, and the
 * next write lands on the new name.
 */
export const LEGACY_COUNTRY_COOKIE = 'st_country';
export const PREFERENCE_MAX_AGE = 365 * 24 * 60 * 60; // one year

/** The slice of `Astro.cookies` this needs; typed structurally so the module stays free of the astro runtime. */
export interface CookieJar {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: { maxAge: number; path: string; sameSite: 'lax' }): void;
}

/** The slice of the session this needs — enough to find the owner's Redis bucket. */
export interface PreferenceOwner {
  leagueId?: string | null;
  franchiseId?: string | null;
}

const COOKIE_OPTS = { maxAge: PREFERENCE_MAX_AGE, path: '/', sameSite: 'lax' as const };

/** The owner's mirror bucket, or null when the session cannot name one. */
function ownerBucket(user: PreferenceOwner | null | undefined): { slug: string; franchiseId: string } | null {
  if (!user?.leagueId || !user.franchiseId) return null;
  const slug = getLeagueById(user.leagueId)?.slug;
  return slug ? { slug, franchiseId: user.franchiseId } : null;
}

/** True when this request carries an explicit choice. */
export function hasPreferenceParams(url: URL): boolean {
  return url.searchParams.has('country') || url.searchParams.has('zones');
}

/** The preferences named by the URL, read against whatever is already stored. */
export function preferencesFromParams(url: URL, current: ViewerPreferences): ViewerPreferences {
  const country = url.searchParams.get('country') ?? current.country;
  // A country change with no zones named re-defaults the clocks, because the
  // old ids belong to the old country (`parseZoneSelection` drops them).
  const zones = url.searchParams.has('zones')
    ? url.searchParams.getAll('zones').flatMap((v) => v.split(','))
    : current.zoneIds;
  return parseViewerPreferences(country, zones);
}

/** What the cookies on this device say, or null when neither is set. */
export function preferencesFromCookies(cookies: Pick<CookieJar, 'get'>): ViewerPreferences | null {
  const country = cookies.get(COUNTRY_COOKIE)?.value ?? cookies.get(LEGACY_COUNTRY_COOKIE)?.value;
  const zones = cookies.get(ZONES_COOKIE)?.value;
  if (!country && !zones) return null;
  return parseViewerPreferences(country, zones);
}

/** What a route gets back: the preferences in force, and whether the account mirror took the write. */
export interface ViewerPreferenceResolution {
  prefs: ViewerPreferences;
  /** True only when THIS request carried a choice and it reached the owner's mirror. */
  savedToAccount: boolean;
}

/**
 * Resolve the viewer's preferences and persist any explicit choice — the one
 * call a route makes.
 *
 * Route-only: it writes cookies. Safe to call on every request; the Redis
 * read happens only when the device has no cookie, and the Redis write only
 * when the URL carried a choice.
 */
export async function resolveViewerPreferences(
  url: URL,
  cookies: CookieJar,
  user: PreferenceOwner | null | undefined,
): Promise<ViewerPreferenceResolution> {
  const fromCookies = preferencesFromCookies(cookies);
  const bucket = ownerBucket(user);

  if (hasPreferenceParams(url)) {
    const chosen = preferencesFromParams(url, fromCookies ?? DEFAULT_VIEWER_PREFERENCES);
    writePreferenceCookies(cookies, chosen);
    const savedToAccount = bucket
      ? await setStoredViewerPreferences(bucket.slug, bucket.franchiseId, chosen)
      : false;
    return { prefs: chosen, savedToAccount };
  }

  if (fromCookies) return { prefs: fromCookies, savedToAccount: false };

  if (bucket) {
    const stored = await getStoredViewerPreferences(bucket.slug, bucket.franchiseId);
    if (stored) {
      // Mirror it onto the device so the next render is a cookie read.
      writePreferenceCookies(cookies, stored);
      return { prefs: stored, savedToAccount: false };
    }
  }

  return { prefs: DEFAULT_VIEWER_PREFERENCES, savedToAccount: false };
}

/**
 * Read-only resolution for a route that must not write (a GET that is not the
 * owner's own action, a prerendered page). Same precedence, no side effects.
 */
export async function readViewerPreferences(
  cookies: Pick<CookieJar, 'get'>,
  user: PreferenceOwner | null | undefined,
): Promise<ViewerPreferences> {
  const fromCookies = preferencesFromCookies(cookies);
  if (fromCookies) return fromCookies;
  const bucket = ownerBucket(user);
  if (bucket) {
    const stored = await getStoredViewerPreferences(bucket.slug, bucket.franchiseId);
    if (stored) return stored;
  }
  return DEFAULT_VIEWER_PREFERENCES;
}

/** Write both cookies. ROUTE-ONLY — see the module note. */
export function writePreferenceCookies(cookies: CookieJar, prefs: ViewerPreferences): void {
  cookies.set(COUNTRY_COOKIE, prefs.country, COOKIE_OPTS);
  cookies.set(ZONES_COOKIE, prefs.zoneIds.join(','), COOKIE_OPTS);
}
