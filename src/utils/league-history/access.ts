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
import type { AuthUser } from '../auth';
import { canViewSiteInsights } from '../site-insights';

/** Flip at launch. While false, only the site owner's seat sees the pages. */
export const LEAGUE_HISTORY_PUBLIC = false;

export function canViewLeagueHistory(user: AuthUser | null | undefined): boolean {
	return LEAGUE_HISTORY_PUBLIC || canViewSiteInsights(user);
}

/** Set or clear a season's champion. Admin only, before and after launch. */
export function canFixLeagueHistory(user: AuthUser | null | undefined): boolean {
	return canViewSiteInsights(user);
}
