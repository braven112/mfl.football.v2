/**
 * Which leagues MFL Live shows — and why its default is the opposite of every
 * other board's.
 *
 * `/broadcast` and Sunday Ticket default to the HOME leagues, with Best Ball
 * and every outside league off until picked, so an owner who is in six of
 * other people's test leagues does not have them counted or fetched. That is
 * the right default for a board that lives inside one league's site.
 *
 * This board's entire promise is "all of your teams", so it has to be TRUE on
 * first load. Everything is on; the owner switches off what they do not follow
 * on a Sunday (`/live/settings`, phase 3). The cost that buys is real and is
 * paid upstream: `readCrossLeagueLive` bounds the fan-out
 * (`CROSS_LEAGUE_FAN_OUT_LIMIT`) so twelve leagues do not become twelve
 * simultaneous sockets on every poll of every device.
 *
 * The parse/toggle primitives are Sunday Ticket's and are IMPORTED, not
 * copied. Only the DEFAULT differs, and this repo's forked-sibling history is
 * about exactly this kind of "almost the same" duplication.
 */

import {
  leagueSelectionHref,
  parseLeagueSelection,
  toggleLeagueSelection,
  type BoardLeague,
} from './sunday-ticket-selection';

export { parseLeagueSelection, toggleLeagueSelection, leagueSelectionHref };
export type { BoardLeague };

/**
 * This board's OWN cookie. Not `st_leagues` and not `bc_leagues`.
 *
 * Three screens, three answers to the same question. A television set up once
 * must not silently rewrite the league set on the laptop, and neither of them
 * should rewrite the phone in your pocket — which is the one surface where
 * "all of them" is the right starting point.
 */
export const MFL_LIVE_LEAGUE_COOKIE = 'live_leagues';

/** One season. A board set up in September should still be right in January. */
export const MFL_LIVE_LEAGUE_MAX_AGE = 180 * 24 * 60 * 60;

/**
 * Every league the owner is in.
 *
 * Best Ball is NOT special-cased here even though it is draft-only with no
 * weekly matchup — it simply renders `no-matchup`, which is honest and is
 * information ("nothing to watch here today") rather than an absence the owner
 * has to go looking for. Hiding a league the owner is genuinely in would make
 * the board's own promise false.
 */
export function defaultMflLiveSelection(leagues: readonly Pick<BoardLeague, 'id'>[]): string[] {
  return leagues.map((l) => l.id);
}

/**
 * Resolve the league set for a render: URL param first, cookie second, else
 * everything.
 *
 * The param wins so a link can carry a set. `null` from either means "the
 * default" — which is also what a garbage or stale cookie yields, so a cookie
 * written by an older build can never blank the board.
 *
 * `explicit` says the owner has actually chosen: the settings page needs to
 * tell "they turned everything on" from "they have never been here", and only
 * the second may be silently widened by a league joined later.
 */
export function resolveMflLiveLeagues(
  param: string | null | undefined,
  cookie: string | null | undefined,
  available: readonly BoardLeague[],
): { enabled: string[]; explicit: boolean } {
  const ids = available.map((l) => l.id);

  const fromParam = parseLeagueSelection(param, ids);
  if (fromParam) return { enabled: fromParam, explicit: true };

  const fromCookie = parseLeagueSelection(cookie, ids);
  if (fromCookie) return { enabled: fromCookie, explicit: true };

  return { enabled: defaultMflLiveSelection(available), explicit: false };
}

// ── Remembering the choice — from the ROUTE, never a component ───────────

/** The slice of `Astro.cookies` this needs, typed structurally so the module stays runtime-free. */
export interface CookieJar {
  set(name: string, value: string, options: { maxAge: number; path: string; sameSite: 'lax' }): void;
}

/**
 * Write `?leagues=` to this board's cookie when the URL carries one.
 *
 * Call from the PAGE's frontmatter — `src/pages/live/index.astro` and
 * `src/pages/live/settings.astro` — and never from a component it imports.
 * `Astro.cookies.set()` inside an imported component runs after the response
 * headers are committed, throws `ResponseSentError` and blanks the page; the
 * Sunday Ticket board shipped exactly that on its first click. Reads are safe
 * anywhere. Only the write is route-only.
 */
export function rememberMflLiveChoice(url: URL, cookies: CookieJar): void {
  const leagues = url.searchParams.get('leagues');
  if (leagues === null) return;
  cookies.set(MFL_LIVE_LEAGUE_COOKIE, leagues.trim() || 'default', {
    maxAge: MFL_LIVE_LEAGUE_MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });
}

/**
 * The selection after toggling one league, or `null` for "the default".
 *
 * Two things differ from a straight `toggleLeagueSelection` call, both because
 * this board's default is EVERYTHING rather than a subset:
 *
 *  - **The last league on cannot be switched off.** The shared helper returns
 *    `null` for an empty result, and `null` means "use the default" — which
 *    here is every league. So turning off your last one would switch them all
 *    back ON, which is the opposite of what the tap asked for. The settings
 *    page disables that control instead; a board with no leagues is not a
 *    board, and silently doing the reverse is worse than refusing.
 *  - **Collapsing back to `null` when everything is on is correct and wanted.**
 *    The cookie then reads "default" rather than pinning today's list, so a
 *    league joined next month appears by itself — which is the promise this
 *    board makes.
 */
export function toggleMflLiveLeague(
  enabled: readonly string[],
  allIds: readonly string[],
  id: string,
): { selection: string[] | null; refused: boolean } {
  const turningOff = enabled.includes(id);
  if (turningOff && enabled.length <= 1) return { selection: enabled.slice(), refused: true };
  return { selection: toggleLeagueSelection(enabled, allIds, id, allIds), refused: false };
}
