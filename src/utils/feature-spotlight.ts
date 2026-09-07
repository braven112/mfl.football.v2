/**
 * Feature spotlights — the "this is new, click it" pulse.
 *
 * A new control that hides behind a chevron is invisible to everyone who
 * already knows the page. The spotlight is the one-week nudge: the control
 * pulses gently until either the owner opens it or the week runs out.
 *
 * Two independent stop conditions, and both matter:
 *
 * 1. **The week expires.** Server-side, from the date in `FEATURE_SPOTLIGHTS`.
 *    This is the guarantee — nothing has to be cleaned up later, and a feature
 *    cannot pulse forever because someone forgot to remove a flag.
 * 2. **The owner opens it.** Client-side, one localStorage key per spotlight.
 *    A pulse that keeps going after you have used the thing is just noise.
 *
 * Adding a spotlight to a new feature is two lines: an entry below, and the
 * `spotlight-pulse` class from `src/styles/feature-spotlight.css` on the
 * control (plus `data-spotlight="<id>"` so the shared dismiss script finds it).
 *
 * The window is deliberately fuzzy — anchored at noon UTC rather than a league
 * clock — because "roughly a week" is the whole precision this needs. Do not
 * copy this date math for anything with a deadline in it; that belongs to
 * `league-year.ts` and the viewer's clock.
 */

/** How long a spotlight pulses, in days, unless its entry says otherwise. */
export const SPOTLIGHT_DAYS = 7;

/**
 * Every feature currently wearing a spotlight, keyed by id, valued by the day
 * it shipped. An entry stops mattering on its own a week later — leave it, or
 * delete it, the render is the same.
 */
export const FEATURE_SPOTLIGHTS: Readonly<Record<string, string>> = {
  /** The nav drawer's account menu, under the team name. Shipped Sep 7 2026. */
  'nav-account-menu': '2026-09-07',
};

/** localStorage key a dismissed spotlight writes. Shared with the client script. */
export function spotlightStorageKey(id: string): string {
  return `spotlight.${id}.seen`;
}

/**
 * The instant a spotlight stops, in epoch ms, or null when the id is unknown
 * or its date is unparseable — an unknown spotlight never pulses rather than
 * pulsing forever.
 */
export function spotlightExpiry(id: string, days: number = SPOTLIGHT_DAYS): number | null {
  const since = FEATURE_SPOTLIGHTS[id];
  if (!since) return null;
  const start = Date.parse(`${since}T12:00:00Z`);
  if (Number.isNaN(start)) return null;
  return start + days * 24 * 60 * 60 * 1000;
}

/** Is this spotlight still inside its week? */
export function isSpotlightActive(id: string, now: Date = new Date()): boolean {
  const expiry = spotlightExpiry(id);
  return expiry !== null && now.getTime() < expiry;
}

/**
 * `?testDate=YYYY-MM-DD` (or `YYYY-MM-DDTHH:MM`) support, so the pulse and its
 * expiry can be seen without touching the system clock — the same convention
 * every date-dependent surface here uses. Kept local rather than imported from
 * `hero-resolver.ts`: the nav renders on every page and that module is large.
 */
export function spotlightNow(url?: URL | null): Date {
  const raw = url?.searchParams.get('testDate');
  if (!raw) return new Date();
  const withTime = raw.includes('T') ? new Date(raw) : new Date(`${raw}T12:00:00`);
  return Number.isNaN(withTime.getTime()) ? new Date() : withTime;
}
