/**
 * The custom-site demo's keeper slot (docs/plans/custom-site-demo.md, phase 4):
 * a fictional keeper league at demo.mfl.football/keeper, registered only on a
 * demo deployment and rendered by the AFL-family page components.
 *
 * Its data files exist only in a demo build's checkout, so they are read
 * through globs — a static import of a missing file fails every other build.
 */
import type { LeagueDefinition } from '../config/leagues';
import { getLeagueBySlug } from '../config/leagues';

import { keeperLeagueConfig } from './keeper-config';

/** The keeper league, or null anywhere but a demo deployment. */
export function keeperLeague(): LeagueDefinition | null {
  return getLeagueBySlug('keeper');
}

/** Its league config (teams, conferences, …) — an empty league when absent. */
export function keeperConfig(): any {
  return keeperLeagueConfig;
}
