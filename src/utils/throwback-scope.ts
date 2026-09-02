/**
 * Throwback scope — which league's era rules and storage bucket a Throwback
 * Week resolution reads.
 *
 * Deliberately shaped like `rankings-scope.ts`, for the same two reasons:
 *
 * - **TheLeague's keys stay byte-identical.** Its scope produces the exact
 *   pre-existing `throwback:{franchiseId}` KV key, so no owner loses the era
 *   they already picked.
 * - **Franchise ids collide across leagues.** AFL 0001 (Smokane FC) and
 *   TheLeague 0001 (Pacific Pigskins) are different teams with different
 *   `history[]` arrays, so a bare `throwback:0001` was genuinely ambiguous the
 *   moment a second league gained eras. It is the disambiguator, not
 *   decoration.
 *
 * The scope also selects the ERA RULES — exclusions and per-franchise defaults
 * — because those are keyed by franchise id too. Resolving an AFL franchise
 * against TheLeague's `DEFAULT_THROWBACK_ERA` would not throw; it would
 * quietly hand back the wrong era for any id both leagues share, which is all
 * of 0001–0016.
 */

import { getLeagueBySlug, getLeagueById } from '../config/leagues';
import {
  DEFAULT_THROWBACK_ERA,
  THROWBACK_ASSET_CONFLICTS,
  THROWBACK_WEEKS,
} from '../data/theleague/throwback-config';
import {
  AFL_DEFAULT_THROWBACK_ERA,
  AFL_THROWBACK_ASSET_CONFLICTS,
  AFL_THROWBACK_REBRAND,
  AFL_THROWBACK_REBRAND_ERA,
  AFL_THROWBACK_WEEKS_LIST,
} from '../data/afl-fantasy/throwback-config';
import type { FranchiseHistoryEntry } from './team-names';

/** The buckets throwback data can live in. Add one per league that runs it. */
export type ThrowbackScope = 'theleague' | 'afl';

export const DEFAULT_THROWBACK_SCOPE: ThrowbackScope = 'theleague';

/** navSlug → scope. A league absent here does not run Throwback Week. */
const SCOPE_BY_NAV_SLUG: Record<string, ThrowbackScope> = {
  theleague: 'theleague',
  afl: 'afl',
};

export interface ThrowbackRules {
  /** NFL weeks that trigger throwback identity in this league. */
  weeks: number[];
  /** franchiseId → the era `yearStart` the commissioner seeded. */
  defaults: Record<string, number>;
  /** Eras excluded from eligibility (art or name claimed elsewhere). */
  conflicts: { franchiseId: string; yearStart: number }[];
  /**
   * The Throwback Rebrand, when the league runs one: a franchise serving a
   * last-place rename wears a shame identity borrowed from another
   * franchise's history, overriding its own pick. Null where the league has
   * no such assignment.
   */
  rebrand: {
    franchiseId: string;
    sourceFranchiseId: string;
    era: FranchiseHistoryEntry;
  } | null;
}

/** Pair an assignment with its resolved era, or null if either is missing. */
function toRebrandRule(
  assignment: { franchiseId: string; sourceFranchiseId: string; yearStart: number } | null,
  era: FranchiseHistoryEntry | null
): ThrowbackRules['rebrand'] {
  if (!assignment || !era) return null;
  return {
    franchiseId: assignment.franchiseId,
    sourceFranchiseId: assignment.sourceFranchiseId,
    era,
  };
}

const RULES: Record<ThrowbackScope, ThrowbackRules> = {
  theleague: {
    weeks: THROWBACK_WEEKS,
    defaults: DEFAULT_THROWBACK_ERA,
    conflicts: THROWBACK_ASSET_CONFLICTS,
    // TheLeague has no last-place rename, so nothing to impose.
    rebrand: null,
  },
  afl: {
    weeks: AFL_THROWBACK_WEEKS_LIST,
    defaults: AFL_DEFAULT_THROWBACK_ERA,
    conflicts: AFL_THROWBACK_ASSET_CONFLICTS,
    rebrand: toRebrandRule(AFL_THROWBACK_REBRAND, AFL_THROWBACK_REBRAND_ERA),
  },
};

/** Resolve a league's nav slug to its throwback scope. Unknown → TheLeague. */
export function throwbackScopeForNavSlug(
  navSlug: string | null | undefined,
): ThrowbackScope {
  if (!navSlug) return DEFAULT_THROWBACK_SCOPE;
  return SCOPE_BY_NAV_SLUG[navSlug] ?? DEFAULT_THROWBACK_SCOPE;
}

/** Resolve a registry league slug (e.g. 'afl-fantasy') to its scope. */
export function throwbackScopeForLeagueSlug(
  slug: string | null | undefined,
): ThrowbackScope {
  if (!slug) return DEFAULT_THROWBACK_SCOPE;
  return throwbackScopeForNavSlug(getLeagueBySlug(slug)?.navSlug);
}

/**
 * Resolve an MFL league id (what a session JWT carries) to its scope.
 *
 * Answers "which bucket", not "is this allowed" — a route that must REJECT an
 * unattributable session checks `getLeagueById` itself, the way
 * `rankings-scope.ts` documents.
 */
export function throwbackScopeForLeagueId(
  leagueId: string | null | undefined,
): ThrowbackScope {
  if (!leagueId) return DEFAULT_THROWBACK_SCOPE;
  return throwbackScopeForNavSlug(getLeagueById(leagueId)?.navSlug);
}

/**
 * Strict counterpart to the resolvers above: the scope for a league that
 * actually RUNS Throwback Week, or `null` for one that does not.
 *
 * The lenient resolvers fall back to TheLeague for anything unrecognized,
 * which is right for "which bucket do I read" and dangerously wrong for "may
 * this session write". Best Ball is the live example — it has no `history[]`
 * and no throwback week, so a lenient resolve would hand a bb1 owner
 * TheLeague's storage. Anything gating access must use this.
 */
export function strictThrowbackScopeForLeagueId(
  leagueId: string | null | undefined,
): ThrowbackScope | null {
  if (!leagueId) return null;
  const navSlug = getLeagueById(leagueId)?.navSlug;
  if (!navSlug) return null;
  return SCOPE_BY_NAV_SLUG[navSlug] ?? null;
}

/** Same, from a registry league slug (e.g. 'afl-fantasy'). */
export function strictThrowbackScopeForLeagueSlug(
  slug: string | null | undefined,
): ThrowbackScope | null {
  if (!slug) return null;
  const navSlug = getLeagueBySlug(slug)?.navSlug;
  if (!navSlug) return null;
  return SCOPE_BY_NAV_SLUG[navSlug] ?? null;
}

/** The era rules for a scope. */
export function throwbackRules(scope: ThrowbackScope): ThrowbackRules {
  return RULES[scope] ?? RULES[DEFAULT_THROWBACK_SCOPE];
}

/** True when `week` runs Throwback Week in this scope's league. */
export function isThrowbackWeekForScope(week: number, scope: ThrowbackScope): boolean {
  return throwbackRules(scope).weeks.includes(week);
}

/**
 * Redis key for a franchise's stored era pick. TheLeague returns the legacy
 * `throwback:{franchiseId}` unchanged; every other scope is namespaced.
 */
export function scopedThrowbackKey(franchiseId: string, scope: ThrowbackScope): string {
  return scope === DEFAULT_THROWBACK_SCOPE
    ? `throwback:${franchiseId}`
    : `throwback:${scope}:${franchiseId}`;
}
