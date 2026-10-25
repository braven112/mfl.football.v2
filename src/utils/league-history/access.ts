/**
 * Who can see the free League History pages (`/history`, `/history/mfl/<id>`)
 * and use the setup form.
 *
 * Until launch: ONE seat, the same one `/live/analytics` and the product
 * pages admit (`canViewSiteInsights`). The product name, MFL's answer on
 * commercial use and the business setup come first (the business plan's
 * "Before selling" list). Launch is this constant; flip it, then give
 * `/history` a page-directory entry and switch the league pages from
 * noindex to indexable (they are meant to be found by search).
 *
 * Fixing a season's champion stays admin-only after launch too, until the
 * commissioner claim flow exists (docs/plans/league-history-free-page.md).
 */
import { franchiseIdForLeague, isCommissionerOrAdmin, type AuthUser } from '../auth';
import { getLeagueBySlug } from '../../config/leagues';
import { canViewSiteInsights } from '../site-insights';

/** Flip at launch. While false, only the site owner's seat sees the pages. */
export const LEAGUE_HISTORY_PUBLIC = false;

/**
 * The same owner's seat in the AFL. Sessions are per domain, so on
 * afl-fantasy.com he is signed in as the AFL's franchise 0001, and the AFL's
 * history pages turned him away on the AFL's own site (2026-10-25). VIEW only:
 * fixing a champion stays with the insights seat below.
 */
const PREVIEW_SEATS = [{ leagueSlug: 'afl-fantasy', franchiseId: '0001' }] as const;

function isPreviewSeat(user: AuthUser): boolean {
	return PREVIEW_SEATS.some(
		(seat) =>
			user.leagueId === getLeagueBySlug(seat.leagueSlug)?.id &&
			user.franchiseId === seat.franchiseId &&
			isCommissionerOrAdmin(user),
	);
}

/**
 * The free product for any MFL league: `/history`, `/history/mfl/<id>`, the
 * build endpoint and its share cards. Still one seat until launch.
 */
export function canUseHistoryProduct(user: AuthUser | null | undefined): boolean {
	if (LEAGUE_HISTORY_PUBLIC || canViewSiteInsights(user)) return true;
	return !!user && isPreviewSeat(user);
}

/**
 * Our own leagues' history pages (TheLeague and the AFL: history home,
 * Record Book, franchise, owner and rivalry history sections). Open to every
 * visitor, signed in or not, since 2026-10-25: the owner announced it to both
 * leagues and owners hit the gate. The call sites keep the check so a page can
 * be re-gated here without touching them.
 */
export function canViewLeagueHistory(_user: AuthUser | null | undefined): boolean {
	return true;
}

/** Set or clear a season's champion. Admin only, before and after launch. */
export function canFixLeagueHistory(user: AuthUser | null | undefined): boolean {
	return canViewSiteInsights(user);
}

/**
 * Ask the History (the question box on the history home): signed-in owners of
 * THAT league, since every question spends Claude tokens (Brandon,
 * 2026-10-25). A shared answer stays readable by anyone, like the rest of the
 * history pages; only asking is gated.
 */
export function canAskLeagueHistory(user: AuthUser | null | undefined, leagueId: string): boolean {
	return !!franchiseIdForLeague(user, leagueId);
}
