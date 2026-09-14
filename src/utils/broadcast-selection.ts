/**
 * Which leagues the broadcast board watches — the TV's own choice.
 *
 * The SELECTION LOGIC is Sunday Ticket's and is imported, not copied: the two
 * boards ask the identical question ("which of my leagues do I care about
 * here"), give the identical answer by default (the full-management leagues
 * on, Best Ball and every outside league off until picked), and this repo's
 * forked-sibling history says what happens when a rule like that grows a
 * second implementation.
 *
 * The COOKIE is deliberately its own. Sunday Ticket writes `st_leagues`; this
 * writes `bc_leagues`, and they never read each other. A board you set up once
 * on a television — a machine you will not open a browser on again for a week
 * — must not silently rewrite the league set on the Sunday Ticket page you
 * read on your laptop every Sunday morning, and vice versa. They are the same
 * question asked of two different screens, and each screen keeps its own
 * answer.
 */

import {
  defaultLeagueSelection,
  isHomeLeague,
  parseLeagueSelection,
  toggleLeagueSelection,
  type BoardLeague,
} from './sunday-ticket-selection';

export {
  defaultLeagueSelection,
  isHomeLeague,
  parseLeagueSelection,
  toggleLeagueSelection,
  type BoardLeague,
};

/**
 * The broadcast board's own cookie. See the module note: NOT `st_leagues`.
 * Unscoped by league on purpose — the board is cross-league, which is the
 * opposite of what `rankings-scope.ts` keeps apart.
 */
export const BROADCAST_LEAGUE_COOKIE = 'bc_leagues';

/** One season. A television set up in September should still be right in January. */
export const BROADCAST_LEAGUE_MAX_AGE = 180 * 24 * 60 * 60;

/** The broadcast board's sound preference — opt-in, remembered per device. */
export const BROADCAST_SOUND_COOKIE = 'bc_sound';

/**
 * Resolve the league set for a render, URL param first and cookie second.
 *
 * The param wins so a link can carry a set, and `null` from either means "the
 * default" — which is also what a garbage or stale cookie yields, so a cookie
 * written by an older build can never blank the board.
 */
export function resolveBroadcastLeagues(
  param: string | null | undefined,
  cookie: string | null | undefined,
  available: readonly BoardLeague[],
): { enabled: string[]; explicit: boolean } {
  const ids = available.map((l) => l.id);
  const fromParam = parseLeagueSelection(param, ids);
  if (fromParam) return { enabled: fromParam, explicit: true };

  const fromCookie = parseLeagueSelection(cookie, ids);
  if (fromCookie) return { enabled: fromCookie, explicit: true };

  return { enabled: defaultLeagueSelection(available), explicit: false };
}

/**
 * Is the sound on for this render?
 *
 * Silent unless asked, in both directions: an absent cookie and an absent
 * param are both silence. The owner is watching the actual games with their
 * own commentary on the other television, and a second screen that makes
 * noise unbidden is a second screen he turns off.
 */
export function resolveBroadcastSound(
  param: string | null | undefined,
  cookie: string | null | undefined,
): boolean {
  const truthy = (v: string | null | undefined) => v === '1' || v === 'on' || v === 'true';
  const falsy = (v: string | null | undefined) => v === '0' || v === 'off' || v === 'false';
  if (truthy(param)) return true;
  if (falsy(param)) return false;
  return truthy(cookie);
}

/** The board href for a league selection, preserving an explicit `?week=`. */
export function broadcastHref(
  pathname: string,
  selection: string[] | null,
  week: number | null,
): string {
  const params = new URLSearchParams();
  if (week !== null) params.set('week', String(week));
  params.set('leagues', selection ? selection.join(',') : 'default');
  return `${pathname}?${params.toString()}`;
}
