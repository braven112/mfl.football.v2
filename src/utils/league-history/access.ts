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
import { isCommissionerOrAdmin, type AuthUser } from '../auth';
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

export function canViewLeagueHistory(user: AuthUser | null | undefined): boolean {
	if (LEAGUE_HISTORY_PUBLIC || canViewSiteInsights(user)) return true;
	return !!user && isPreviewSeat(user);
}

/** Set or clear a season's champion. Admin only, before and after launch. */
export function canFixLeagueHistory(user: AuthUser | null | undefined): boolean {
	return canViewSiteInsights(user);
}
