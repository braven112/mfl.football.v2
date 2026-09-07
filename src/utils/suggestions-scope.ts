/**
 * Suggestion Box scope — which board a league reads and writes.
 *
 * The Board shipped as a TheLeague-only feature, so every Redis key it uses is
 * bare (`sb:ideas`, `sb:comments:{ideaId}`, `sb:last-seen`). That was
 * unambiguous while exactly one league could write. It stops being unambiguous
 * the moment the AFL gets the page: **both leagues have a franchise 0001**, so
 * `sb:last-seen` would have merged two different people's read state, and one
 * shared `sb:ideas` hash would have published TheLeague's rule-change debates
 * on the AFL's board and vice versa.
 *
 * Same problem, same shape of answer as `rankings-scope.ts` — deliberately, so
 * there is one idiom in the repo for "this per-owner store is per-league now":
 *
 * - **TheLeague's keys stay byte-identical.** Its scope returns the exact
 *   pre-existing strings, so no idea, comment, reaction or last-seen marker
 *   written before this change is orphaned. A migration would have been the
 *   only alternative and there is no reason to run one.
 * - **Every other league gets an infixed key** (`sb:afl:ideas`). New league,
 *   empty board, no collision.
 *
 * The scope is ALWAYS derived from the session's `leagueId` on the server, not
 * from a query param or a request body — a param would let an AFL session post
 * onto TheLeague's board by editing one character. `/api/suggestions/*` routes
 * take the scope from `getAuthUser(request).leagueId` and nowhere else.
 */

import {
  ALL_LEAGUES,
  DEFAULT_LEAGUE_SLUG,
  getLeagueById,
  getLeagueBySlug,
} from '../config/leagues';

/**
 * A board bucket, keyed by the league's nav slug.
 *
 * A string rather than a closed union because — unlike rankings, where each
 * league's scope carries a hand-written comment — a league added to the
 * registry should get its own empty board automatically rather than silently
 * sharing TheLeague's. `unknown league → TheLeague` would be exactly the
 * cross-league leak this module exists to prevent, so the fallback below only
 * applies to a session we cannot attribute to any league at all.
 */
export type SuggestionsScope = string;

/**
 * The legacy bucket. Its keys are unprefixed, which is what makes every idea
 * posted before the AFL got a board still load.
 */
export const DEFAULT_SUGGESTIONS_SCOPE: SuggestionsScope = 'theleague';

/** Resolve a registry league slug (e.g. `afl-fantasy`) to its board scope. */
export function suggestionsScopeForLeagueSlug(
  slug: string | null | undefined,
): SuggestionsScope {
  if (!slug) return DEFAULT_SUGGESTIONS_SCOPE;
  return getLeagueBySlug(slug)?.navSlug ?? DEFAULT_SUGGESTIONS_SCOPE;
}

/**
 * Resolve an MFL league id (what a session JWT carries) to its board scope.
 *
 * A known league always gets its OWN bucket; only an id we cannot attribute to
 * any league falls back to the legacy one. Callers that need to REJECT an
 * unattributable session should check `getLeagueById` themselves — this
 * answers "which board", not "is this allowed".
 */
export function suggestionsScopeForLeagueId(
  leagueId: string | null | undefined,
): SuggestionsScope {
  if (!leagueId) return DEFAULT_SUGGESTIONS_SCOPE;
  return getLeagueById(leagueId)?.navSlug ?? DEFAULT_SUGGESTIONS_SCOPE;
}

/**
 * The registry slug a board scope belongs to — the inverse of
 * `suggestionsScopeForLeagueSlug`, for the places that need a config lookup
 * (team names) rather than a key.
 */
export function leagueSlugForSuggestionsScope(
  scope: SuggestionsScope,
): string {
  return SLUG_BY_SCOPE[scope] ?? DEFAULT_LEAGUE_SLUG;
}

/**
 * Redis key for a board scope. TheLeague returns `base` unchanged; every other
 * league gets its scope infixed after the `sb:` namespace so the keyspace still
 * groups by feature (`sb:afl:ideas`, not `afl:sb:ideas`).
 *
 * `base` must start with `sb:` — the infix position is derived from it rather
 * than hardcoded, and a caller that forgets the namespace would otherwise get a
 * key in the global keyspace root.
 */
export function scopedBoardKey(base: string, scope: SuggestionsScope): string {
  // Validated for EVERY scope, before the legacy early-return. Checking only
  // the non-default path made the contract hold in the AFL and not in
  // TheLeague, so a malformed key would sail through in the one league that
  // has data — the reverse of where you want a guard to be strict.
  if (!base.startsWith('sb:')) {
    throw new Error(`scopedBoardKey: expected an "sb:" key, got "${base}"`);
  }
  if (scope === DEFAULT_SUGGESTIONS_SCOPE) return base;
  return `sb:${scope}:${base.slice('sb:'.length)}`;
}

/**
 * scope → registry slug, for config lookups. Derived from the registry so a
 * league added there is resolvable here without a second edit.
 */
const SLUG_BY_SCOPE: Record<string, string> = Object.fromEntries(
  ALL_LEAGUES.map((l) => [l.navSlug, l.slug]),
);

/**
 * The board an authenticated session belongs to.
 *
 * The ONLY sanctioned way for an API route to pick a board. Taking it from the
 * session rather than a query param or body field is what makes the boundary
 * hold: a param would let an AFL session post onto TheLeague's board by
 * editing one character, which is the same class of bug the rankings scope
 * rejects a mismatched `?league=` for.
 */
export function boardScope(user: { leagueId: string }): SuggestionsScope {
  return suggestionsScopeForLeagueId(user.leagueId);
}
