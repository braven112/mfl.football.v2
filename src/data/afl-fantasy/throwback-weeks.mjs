/**
 * Which weeks are Throwback Week in the AFL — the one piece of the AFL's
 * `throwback-config.ts` that node scripts also need.
 *
 * Split out for the same reason as TheLeague's copy next door
 * (`src/data/theleague/throwback-weeks.mjs`): `compute-league-events.mjs` runs
 * in plain node and cannot import the `.ts`, so the week list has to be
 * reachable without a TypeScript loader.
 */

import { LEAGUES } from '../../config/leagues-data.mjs';

/**
 * NFL week numbers that trigger AFL throwback identity, every season. The list
 * is a per-league constant and therefore lives in the registry
 * (`throwbackWeeks`); change it there, not here.
 */
export const AFL_THROWBACK_WEEKS = LEAGUES['afl-fantasy'].throwbackWeeks ?? [];

export function isAflThrowbackWeek(week) {
  return AFL_THROWBACK_WEEKS.includes(week);
}
