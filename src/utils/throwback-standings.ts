/**
 * Throwback Week on the standings pages.
 *
 * During a throwback week every row wears its legacy ART (the era banner, or
 * era crest on the icon tables) while TODAY's team name rides underneath on a
 * second line, so the table stays readable to someone who doesn't know every
 * club's old identity.
 *
 * The era itself comes from `applyThrowbackOverrides` — the same chokepoint
 * live scoring uses — never resolved inline here (see
 * `docs/claude/insights/features/throwback-week.md`). Only the CURRENT season
 * throws back: an archived season already renders the identity each club wore
 * that year, and dressing it in an owner's picked era would rewrite history.
 */

import type { LeagueSlug } from '../types/nav';
import { applyThrowbackOverrides, type ConfigTeam } from './live-scoring-data';
import { strictThrowbackScopeForNavSlug } from './throwback-scope';
import type { ThrowbackRequestState } from './throwback-request-state';

export interface StandingsThrowback<T> {
  /** The config to compute standings from — era identities when active. */
  config: T;
  /**
   * franchiseId → today's team name, for the second line. `undefined` when
   * the page is not throwing back, which is what tells the table to render
   * exactly as it always has.
   */
  todayNames: Record<string, string> | undefined;
}

// `T` is left loose on `teams`: each page passes its own league-config shape
// (TheLeague's JSON import, the AFL's StructuredLeagueConfig), and the return
// must keep that shape so the standings helpers downstream still accept it.
export function applyThrowbackToStandingsConfig<T extends { teams: readonly object[] }>(
  league: LeagueSlug,
  config: T,
  state: ThrowbackRequestState,
  { isCurrentSeason }: { isCurrentSeason: boolean },
): StandingsThrowback<T> {
  const scope = strictThrowbackScopeForNavSlug(league);
  if (!state.throwbackActive || !isCurrentSeason || !scope) {
    return { config, todayNames: undefined };
  }

  const configTeams = config.teams as ConfigTeam[];
  const todayNames = Object.fromEntries(configTeams.map((t) => [t.franchiseId, t.name]));
  const teams = applyThrowbackOverrides(configTeams, true, state.throwbackOverrides, scope);
  return { config: { ...config, teams: teams as unknown as T['teams'] }, todayNames };
}
