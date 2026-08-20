/**
 * Rankings scope — which bucket of rankings a league reads and writes.
 *
 * Both halves of the rankings system (Import Rankings → composite "My Rank",
 * and the Custom Rankings drag-and-drop board) are per-owner data, and an
 * owner's board is NOT the same board in every league: the AFL is a keeper
 * league with its own player pool and scoring, so its ranking of a player is
 * a different opinion than TheLeague's dynasty-contract ranking of the same
 * player. The scope is what keeps those from overwriting each other.
 *
 * Two rules this module exists to enforce:
 *
 * - **TheLeague's keys stay byte-identical.** Its scope produces the exact
 *   pre-existing key strings (`rankings.imports`, `ri:{franchiseId}`, …), so
 *   no owner loses a board they already built. Same shape as
 *   `scripts/lib/schefter-keys.mjs#schefterKey`.
 * - **Franchise ids collide across leagues.** AFL 0001 and TheLeague 0001 are
 *   different teams, so a bare `ri:0001` KV key is genuinely ambiguous once a
 *   second league writes to it. The scope is the disambiguator.
 *
 * Best-ball is deliberately NOT its own scope — see BEST_BALL note below.
 */

import { getLeagueBySlug, getLeagueById } from '../config/leagues';

/** The buckets rankings can live in. Add one per league that needs its own. */
export type RankingsScope = 'theleague' | 'afl';

export const DEFAULT_RANKINGS_SCOPE: RankingsScope = 'theleague';

/**
 * navSlug → scope.
 *
 * BEST_BALL: `bb1` maps to `theleague` on purpose, preserving the behavior the
 * best-ball wrapper page documents — rankings imported on either page feed the
 * other's draft queue and "My Rank" auto-pick source. Best-ball leagues have no
 * ranking surface of their own to keep separate; they only consume the imports.
 * Giving them their own bucket would silently empty an existing draft queue.
 */
const SCOPE_BY_NAV_SLUG: Record<string, RankingsScope> = {
  theleague: 'theleague',
  bb1: 'theleague',
  afl: 'afl',
};

/** Resolve a league's nav slug to its rankings scope. Unknown → TheLeague. */
export function rankingsScopeForNavSlug(
  navSlug: string | null | undefined,
): RankingsScope {
  if (!navSlug) return DEFAULT_RANKINGS_SCOPE;
  return SCOPE_BY_NAV_SLUG[navSlug] ?? DEFAULT_RANKINGS_SCOPE;
}

/** Resolve a registry league slug (e.g. 'afl-fantasy') to its scope. */
export function rankingsScopeForLeagueSlug(
  slug: string | null | undefined,
): RankingsScope {
  if (!slug) return DEFAULT_RANKINGS_SCOPE;
  return rankingsScopeForNavSlug(getLeagueBySlug(slug)?.navSlug);
}

/**
 * Resolve an MFL league id (what a session JWT carries) to its scope.
 *
 * Fails CLOSED to TheLeague only for an id we can't attribute at all; a known
 * league always gets its own bucket. Callers that need to REJECT an
 * unattributable session should check `getLeagueById` themselves — this
 * function answers "which bucket", not "is this allowed".
 */
export function rankingsScopeForLeagueId(
  leagueId: string | null | undefined,
): RankingsScope {
  if (!leagueId) return DEFAULT_RANKINGS_SCOPE;
  return rankingsScopeForNavSlug(getLeagueById(leagueId)?.navSlug);
}

/**
 * The scope for the page currently rendered in the browser.
 *
 * Reads `html[data-league]`, which the layout stamps with the league's nav
 * slug on every page (the same attribute the team-accent token blocks are
 * scoped by). Deliberately re-read on each call rather than captured at module
 * load: with the ClientRouter in play a single JS module instance survives a
 * navigation from one league to another, so a captured value would write the
 * previous league's bucket.
 */
export function activeRankingsScope(): RankingsScope {
  if (typeof document === 'undefined') return DEFAULT_RANKINGS_SCOPE;
  return rankingsScopeForNavSlug(document.documentElement.dataset.league);
}

/**
 * localStorage key for a scope. TheLeague returns `base` unchanged so existing
 * browsers keep reading the board they already have.
 */
export function scopedLocalKey(base: string, scope: RankingsScope): string {
  return scope === DEFAULT_RANKINGS_SCOPE ? base : `${base}.${scope}`;
}

/**
 * Redis key for a franchise's data in a scope. TheLeague returns the legacy
 * `${prefix}:${franchiseId}` unchanged.
 */
export function scopedKvKey(
  prefix: string,
  scope: RankingsScope,
  franchiseId: string,
): string {
  return scope === DEFAULT_RANKINGS_SCOPE
    ? `${prefix}:${franchiseId}`
    : `${prefix}:${scope}:${franchiseId}`;
}
