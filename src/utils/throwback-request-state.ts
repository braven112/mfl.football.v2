/**
 * "Is this a throwback week, and what has each owner picked?" — resolved once,
 * for any surface that dresses franchises in their legacy identity.
 *
 * Extracted from `FranchiseBandBrands.astro`, which had the only copy. The
 * roster header needed the same three answers (which NFL week, is it a
 * throwback week for THIS league's scope, and every owner's stored pick), and
 * a second copy of a recipe involving a Redis read, a preview-param override
 * and a TTL cache is how the two drift into disagreeing about what week it is
 * on one page.
 *
 * `docs/claude/insights/features/throwback-week.md` is explicit that eras are
 * never resolved inline in a page — every surface goes through a chokepoint.
 * This is the *state* half of that: the identity itself is still resolved by
 * `resolveThrowbackIdentity`, downstream of what this returns.
 */

import type { LeagueSlug } from '../types/nav';
import {
  isThrowbackWeekForScope,
  strictThrowbackScopeForNavSlug,
} from './throwback-scope';
import { getAllThrowbackPreferences } from './throwback-store';
import type { ThrowbackPick } from './throwback-identity';
import { getCurrentNFLWeek } from './current-week';
import { getTestDateFromSearchParams } from './league-year';
import theleagueConfig from '../data/theleague.config.json';
import aflConfig from '../../data/afl-fantasy/afl.config.json';

export interface ThrowbackRequestState {
  throwbackActive: boolean;
  throwbackOverrides: Record<string, ThrowbackPick>;
}

const TEAMS_BY_SCOPE: Record<string, any[]> = {
  theleague: (theleagueConfig as any).teams ?? [],
  afl: (aflConfig as any).teams ?? [],
};

/**
 * Module-scope, so it is shared across requests on a warm instance. That is
 * safe here and would not be for most cached data: throwback preferences are
 * LEAGUE-WIDE (every franchise's pick), never scoped to the viewer, so there
 * is no per-user state to leak. A failed read caches `{}` too — deliberately.
 * If Redis is down, every render should not pay the timeout to rediscover it.
 *
 * Keyed BY SCOPE. A single shared slot would serve TheLeague's picks to an AFL
 * page and vice versa for up to a minute, and the two leagues use the same
 * franchise ids, so every id would collide rather than miss.
 */
const THROWBACK_CACHE_TTL_MS = 60_000;
const throwbackCache = new Map<string, { at: number; value: Record<string, ThrowbackPick> }>();

async function cachedThrowbackOverrides(scope: string): Promise<Record<string, ThrowbackPick>> {
  const nowMs = Date.now();
  const hit = throwbackCache.get(scope);
  if (hit && nowMs - hit.at < THROWBACK_CACHE_TTL_MS) return hit.value;

  const value = await getAllThrowbackPreferences(
    (TEAMS_BY_SCOPE[scope] ?? []).map((t: any) => t.franchiseId),
    scope as Parameters<typeof getAllThrowbackPreferences>[1]
  );
  throwbackCache.set(scope, { at: nowMs, value });
  return value;
}

/**
 * The store read is gated on the week actually being a throwback one — outside
 * that week this costs a config walk and nothing else, which matters because
 * callers include a layout that renders on every page.
 *
 * `?week=` and `?testDate=` are honoured so a throwback week can be previewed
 * the same way it is everywhere else.
 */
export async function resolveThrowbackRequestState(
  league: LeagueSlug,
  url: URL,
): Promise<ThrowbackRequestState> {
  const now = getTestDateFromSearchParams(url.searchParams) ?? new Date();
  const weekParam = parseInt(url.searchParams.get('week') ?? '', 10);
  const week =
    Number.isFinite(weekParam) && weekParam > 0 ? weekParam : (getCurrentNFLWeek(now) ?? 0);

  // Null for a league that does not run Throwback Week at all (Best Ball).
  const scope = strictThrowbackScopeForNavSlug(league);
  const throwbackActive = scope !== null && isThrowbackWeekForScope(week, scope);
  const throwbackOverrides =
    throwbackActive && scope ? await cachedThrowbackOverrides(scope) : {};

  return { throwbackActive, throwbackOverrides };
}
