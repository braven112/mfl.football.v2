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
 *   1. `?country=` / `?zone=` on the request — someone just chose.
 *   2. The cookie on this device.
 *   3. The signed-in owner's Redis mirror.
 *   4. A SEEDED default for owners we already know are not on the league's
 *      clock (`SEEDED_PREFERENCES`).
 *   5. The defaults — US, ET · PT — exactly what the board showed before
 *      preferences existed.
 *
 * The cookie beating the mirror is deliberate: a device is where "show me
 * Sydney time" is true, and an owner watching from a hotel in Chicago should
 * not have their laptop at home overwrite it on the next render.
 *
 * ONLY AN EXPLICIT CHOICE WRITES THE COOKIE. Levels 3-5 are defaults, and
 * pinning a default to the device would freeze it: an owner whose phone merely
 * READ their account value would keep it for a year after they changed it on
 * their laptop, which is the opposite of the "follows you to your phone" the
 * page promises. The cost is one Redis GET per render for a signed-in owner
 * who has not chosen on this device — cheap next to what the board already
 * reads, and it stops the moment they pick.
 *
 * The order is resolved ONCE, before the params are applied, because the
 * params are a DELTA on it: `?country=CA` alone must keep the clock the owner
 * already has. Reading only the cookie there meant a seeded owner clicking
 * their own already-active country chip overwrote their seed with the
 * generic default.
 *
 * WRITES ARE ROUTE-ONLY. `Astro.cookies.set()` from an imported component
 * runs after the response headers are committed and throws
 * `ResponseSentError`, blanking the page — the Sunday Ticket country chips
 * shipped exactly that bug. Call `rememberViewerPreferences` from the PAGE's
 * frontmatter; components read the resolved value as a prop.
 */

import { getLeagueById } from '../config/leagues';
import {
  COUNTRY_COOKIE,
  DEFAULT_VIEWER_PREFERENCES,
  ZONE_COOKIE,
  parseCountry,
  parseViewerPreferences,
  seededPreferencesFor,
  type ViewerClock,
  type ViewerPreferences,
} from './viewer-preferences';
import { getStoredViewerPreferences, setStoredViewerPreferences } from './viewer-preferences-store';

// Re-exported, not redeclared — the names live in the pure module so the
// client-side reader and this writer cannot drift. See viewer-preferences.ts.
export { COUNTRY_COOKIE, ZONE_COOKIE };
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

/**
 * The form field holding a country's clock. Each country's radios carry their
 * OWN name so the picker can pre-select one per group; a single shared name
 * would leave only one radio on the page checked. See PreferencesPage.astro.
 */
export function zoneParamFor(country: string): string {
  return `zone-${country}`;
}

/** True when this request carries an explicit choice. */
export function hasPreferenceParams(url: URL): boolean {
  if (url.searchParams.has('country') || url.searchParams.has('zone')) return true;
  for (const key of url.searchParams.keys()) if (key.startsWith('zone-')) return true;
  return false;
}

/** The preferences named by the URL, read against whatever is already stored. */
export function preferencesFromParams(url: URL, current: ViewerPreferences): ViewerPreferences {
  // PARSED, not raw: the field name is built from it, so `?country=ca` has to
  // become `CA` here or `zone-ca` misses the group the form actually sent and
  // the submitted clock is silently dropped.
  const country = parseCountry(url.searchParams.get('country') ?? current.country);
  // A country change with no zone named re-defaults the clock, because the
  // old id belongs to the old country (`parseZoneSelection` drops it).
  // The picker submits every country's group; only the chosen country's
  // counts. `?zone=` is the canonical single-param form for a link.
  const grouped = url.searchParams.getAll(zoneParamFor(country));
  const plain = url.searchParams.getAll('zone');
  const zone = grouped.length > 0 ? grouped : plain.length > 0 ? plain : current.zoneId;
  return parseViewerPreferences(country, zone);
}

/** What the cookies on this device say, or null when neither is set. */
export function preferencesFromCookies(cookies: Pick<CookieJar, 'get'>): ViewerPreferences | null {
  const country = cookies.get(COUNTRY_COOKIE)?.value ?? cookies.get(LEGACY_COUNTRY_COOKIE)?.value;
  const zone = cookies.get(ZONE_COOKIE)?.value;
  if (!country && !zone) return null;
  return parseViewerPreferences(country, zone);
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
 * Route-only: it writes cookies, and ONLY for an explicit choice (see the
 * module note). Safe to call on every request; the Redis read happens only
 * while the device has no cookie of its own, and the Redis write only when the
 * URL carried a choice.
 */
export async function resolveViewerPreferences(
  url: URL,
  cookies: CookieJar,
  user: PreferenceOwner | null | undefined,
): Promise<ViewerPreferenceResolution> {
  const bucket = ownerBucket(user);
  // The base the params modify. Resolving it FIRST is what stops `?country=CA`
  // alone from discarding the clock the owner already has, wherever it came
  // from — their cookie, their account, or their seed.
  const current = await readViewerPreferences(cookies, user);

  if (!hasPreferenceParams(url)) return { prefs: current, savedToAccount: false };

  const chosen = preferencesFromParams(url, current);
  writePreferenceCookies(cookies, chosen);
  const savedToAccount = bucket
    ? await setStoredViewerPreferences(bucket.slug, bucket.franchiseId, chosen)
    : false;
  return { prefs: chosen, savedToAccount };
}

/**
 * The preferences in force, with NO side effects — cookie, then the owner's
 * account mirror, then their seed, then the defaults.
 *
 * That is the whole precedence minus the URL, which is what makes it usable
 * two ways: `resolveViewerPreferences` takes it as the base its params modify,
 * and any page that only wants to RENDER the preference (a prerendered one, or
 * a GET that is not the owner's own action) can call it directly.
 */
export async function readViewerPreferences(
  cookies: Pick<CookieJar, 'get'>,
  user: PreferenceOwner | null | undefined,
): Promise<ViewerPreferences> {
  return (await readViewerClock(cookies, user)).prefs;
}

/**
 * The same read, keeping WHERE the answer came from.
 *
 * A league-event surface needs that: the bare `US/ET` fallback is a guess, and
 * printing an Eastern clock beside every waiver deadline in the league on the
 * strength of a guess is a change nobody asked for. `explicit` is true only
 * for a cookie, an account mirror, or a seed — the three answers an owner is
 * actually responsible for. See `ViewerClock` and `eventZonesFor`.
 */
export async function readViewerClock(
  cookies: Pick<CookieJar, 'get'>,
  user: PreferenceOwner | null | undefined,
): Promise<ViewerClock> {
  const fromCookies = preferencesFromCookies(cookies);
  if (fromCookies) return { prefs: fromCookies, explicit: true };
  const bucket = ownerBucket(user);
  if (bucket) {
    const stored = await getStoredViewerPreferences(bucket.slug, bucket.franchiseId);
    if (stored) return { prefs: stored, explicit: true };
    // A seed is something we were TOLD about this owner, not a fallback we
    // picked for them — so it speaks with the same authority as their own
    // choice, right up until they make one.
    const seeded = seededPreferencesFor(bucket.slug, bucket.franchiseId);
    if (seeded) return { prefs: seeded, explicit: true };
  }
  return { prefs: DEFAULT_VIEWER_PREFERENCES, explicit: false };
}

/** Write both cookies. ROUTE-ONLY — see the module note. */
export function writePreferenceCookies(cookies: CookieJar, prefs: ViewerPreferences): void {
  cookies.set(COUNTRY_COOKIE, prefs.country, COOKIE_OPTS);
  cookies.set(ZONE_COOKIE, prefs.zoneId, COOKIE_OPTS);
}
