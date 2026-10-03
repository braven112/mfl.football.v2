/**
 * Who has Owner Suite Pro on MFL Live (`/live`).
 *
 * Pro unlocks the Live and Projected standings views; the free tier keeps
 * MFL's own Final table (`FREE_STANDINGS_MODE`). See the Owner Suite product
 * page (`src/data/products.ts`).
 *
 * There is no subscription yet, so today Pro is the INCLUDED kind only: every
 * owner of a full-management league this site runs (TheLeague, the AFL,
 * Archie's) has it, the way every League Hub or League Package league's
 * owners do. Derived
 * from the registry rather than a list of slugs, so a new full league gets it
 * the day it is added. A draft-only best-ball league runs no live season and
 * gets nothing here, and neither does a pilot league
 * (`MFL_LIVE_PILOT_LEAGUE_IDS`), which is not in the registry at all.
 *
 * Keyed on the SESSION's league: Pro belongs to the person, and covers every
 * league on their board, including ones this site does not run.
 *
 * When subscriptions land, a paid Pro entitlement is OR-ed in here — this is
 * the one place the rest of MFL Live asks.
 */
import type { AuthUser } from './auth';
import { getLeagueById } from '../config/leagues';

export function hasMflLivePro(user: AuthUser | null | undefined): boolean {
	if (!user) return false;
	const league = getLeagueById(user.leagueId);
	return !!league && !league.bestBall;
}
