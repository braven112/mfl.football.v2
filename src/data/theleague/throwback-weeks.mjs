/**
 * Which weeks are Throwback Week — the one piece of `throwback-config.ts` that
 * node scripts also need.
 *
 * Split out for the same reason as `rivalry-intensity.mjs`: the schedule
 * release runs in plain node and reserves a marquee slot for the throwback
 * game, and a script that cannot import the .ts would otherwise have to
 * hardcode `4`. The rest of the config (era defaults, asset conflicts) stays
 * in the .ts, which re-exports these two.
 */

import { LEAGUES } from '../../config/leagues-data.mjs';

/**
 * NFL week numbers that trigger throwback identity, every season (not tied to
 * a specific year — recurs automatically). The list itself is a per-league
 * constant and therefore lives in the registry (`throwbackWeeks`); change it
 * there. Make a given week one-time by moving the check into
 * `isThrowbackWeek` instead.
 */
export const THROWBACK_WEEKS = LEAGUES.theleague.throwbackWeeks ?? [];

export function isThrowbackWeek(week) {
  return THROWBACK_WEEKS.includes(week);
}
