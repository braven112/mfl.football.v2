/**
 * Sunday Ticket — league selection and the board's league shape.
 *
 * PURE and dependency-free on purpose: the board components import from
 * here, and Chromatic's dependency guard (tests/chromatic-path-filter.test.ts)
 * treats everything a story can reach as a rendering file. Keeping the
 * page's fs / ESPN / registry graph in `sunday-ticket-page.ts` means a
 * change there does not wake every board snapshot.
 *
 * League selection is a URL param remembered in a cookie, not client state:
 * the page is server-rendered with no island, so the chips are links that
 * carry `?leagues=` and the server writes the choice to `st_leagues` for next
 * time. The cookie is UNSCOPED on purpose — the board is cross-league, which
 * is the opposite of what `rankings-scope.ts` keeps apart.
 */

import type { LeagueDefinition } from '../config/leagues';

/** One league on the board — the owner's franchise in it, and how we read it. */
export interface BoardLeague {
  id: string;
  name: string;
  franchiseId: string;
  franchiseName: string;
  /** Registry entry when this site runs the league; null for an outside league. */
  registered: LeagueDefinition | null;
  /** MFL host for an outside league's exports; null → the api host. */
  host: string | null;
  /** True for the league the session belongs to. */
  isSession: boolean;
}

export const LEAGUE_SELECTION_COOKIE = 'st_leagues';
export const LEAGUE_SELECTION_MAX_AGE = 180 * 24 * 60 * 60; // one season

/** One league on the board — the owner's franchise in it, and how we read it. */
export interface BoardLeague {
  id: string;
  name: string;
  franchiseId: string;
  franchiseName: string;
  /** Registry entry when this site runs the league; null for an outside league. */
  registered: LeagueDefinition | null;
  /** MFL host for an outside league's exports; null → the api host. */
  host: string | null;
  /** True for the league the session belongs to. */
  isSession: boolean;
}

// ── League selection (URL param ↔ cookie) ────────────────────────────────

/**
 * The board's default set: every league this site runs (TheLeague, the AFL,
 * Best Ball) that the owner is in. Outside leagues start OFF — an owner with a
 * few test leagues, or in six other people's leagues, should not have all of
 * them counted (and fetched) until they say so.
 */
export function defaultLeagueSelection(leagues: readonly Pick<BoardLeague, 'id' | 'registered'>[]): string[] {
  return leagues.filter((l) => l.registered).map((l) => l.id);
}

/**
 * Parse a `?leagues=` value (or the cookie) against the leagues actually on
 * the board. `null` means "the default set" — also the answer to an empty or
 * garbage value, so a stale cookie can never blank the board. Returns ids in
 * the order given, deduplicated, unknown ids dropped. The literal `default`
 * (and the older `all`) both mean null.
 */
export function parseLeagueSelection(raw: string | null | undefined, available: readonly string[]): string[] | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'all' || trimmed === 'default') return null;
  const allowed = new Set(available);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of trimmed.split(',')) {
    const id = part.trim();
    if (!id || !allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.length > 0 ? ids : null;
}

/**
 * The set after toggling `id`, normalized to board order. Collapses to `null`
 * (the default) when it equals the default set, so the URL and cookie stay
 * clean; turning off the last league falls back to the default rather than
 * an empty board.
 */
export function toggleLeagueSelection(
  enabled: readonly string[],
  all: readonly string[],
  id: string,
  defaults: readonly string[] = all,
): string[] | null {
  const next = enabled.includes(id) ? enabled.filter((x) => x !== id) : [...enabled, id];
  if (next.length === 0) return null;
  const ordered = all.filter((x) => next.includes(x));
  const isDefault = ordered.length === defaults.length && ordered.every((x) => defaults.includes(x));
  return isDefault ? null : ordered;
}

/** Build the page href for a selection, preserving `?week=` when it was set. */
export function leagueSelectionHref(pathname: string, selection: string[] | null, week: number | null): string {
  const params = new URLSearchParams();
  if (week !== null) params.set('week', String(week));
  params.set('leagues', selection ? selection.join(',') : 'default');
  return `${pathname}?${params.toString()}`;
}

// ── Country (broadcast view) ─────────────────────────────────────────────

export const COUNTRY_COOKIE = 'st_country';

/** The page href for a country choice, preserving an explicit `?week=`. */
export function countryHref(pathname: string, country: string, week: number | null): string {
  const params = new URLSearchParams();
  if (week !== null) params.set('week', String(week));
  params.set('country', country);
  return `${pathname}?${params.toString()}`;
}

// ── Remembering the choices — from the ROUTE, never the component ────────

/** The subset of `Astro.cookies` this needs; typed structurally so the module stays free of the astro runtime. */
export interface CookieJar {
  set(name: string, value: string, options: { maxAge: number; path: string; sameSite: 'lax' }): void;
}

/**
 * Write `?leagues=` and `?country=` to their cookies when present.
 *
 * Call this from the PAGE's frontmatter (`src/pages/<league>/sunday-ticket.astro`),
 * not from SundayTicketPage.astro: `Astro.cookies.set()` inside an imported
 * component runs after the response headers are committed and throws
 * `ResponseSentError`, blanking the page — the same trap as `Astro.redirect()`
 * from a component. Reads are fine anywhere; only the write is route-only.
 * The values are stored raw; the component re-parses them against the board.
 */
export function rememberSundayTicketChoices(url: URL, cookies: CookieJar): void {
  const opts = { maxAge: LEAGUE_SELECTION_MAX_AGE, path: '/', sameSite: 'lax' as const };
  const leagues = url.searchParams.get('leagues');
  if (leagues !== null) cookies.set(LEAGUE_SELECTION_COOKIE, leagues.trim() || 'default', opts);
  const country = url.searchParams.get('country');
  if (country !== null) cookies.set(COUNTRY_COOKIE, country.trim().toUpperCase(), opts);
}
