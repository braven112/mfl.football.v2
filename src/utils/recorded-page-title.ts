/**
 * A readable name for a recorded page the page directory has no entry for.
 *
 * The directory lists routes, not records: one Schefter article, one
 * franchise page or one shared mock draft is a row of its own in the visit
 * counters, and with nothing to name it the Owner Activity page fell back to
 * prettifying the last path segment, which printed `Sf_2026_auction_recap` and
 * `0008`. The record behind the id is what the reader actually opened, so the
 * name comes from it: the article's headline, the franchise's current name.
 *
 * Server-only (the article lookup reads the feeds with fs). `site-analytics.ts`
 * stays free of I/O and takes this as its `titleFor` callback.
 */

import type { CanonicalLeagueSlug } from '../config/leagues';
import { getLeagueBySlug, stripLeaguePrefix } from '../config/leagues';
import { getLeagueTeamConfig } from './league-team-brands';
import { findSchefterPost } from './schefter-post-index';
import { isValidSchefterPostId } from './schefter-feed';

/**
 * Title for a canonical (league-prefixed) path, or null when it is not one of
 * the record pages this knows how to name.
 */
export function recordedPageTitle(path: string, league: CanonicalLeagueSlug): string | null {
	const def = getLeagueBySlug(league);
	if (!def) return null;
	const local = stripLeaguePrefix(def, path) || '/';

	const franchise = local.match(/^\/franchises\/(\d{4})$/);
	if (franchise) {
		const name = getLeagueTeamConfig(league, franchise[1])?.name;
		return name ? `Franchise: ${name}` : `Franchise ${franchise[1]}`;
	}

	const article = local.match(/^\/news\/([^/]+)$/);
	if (article) {
		const id = article[1];
		// The id is an allowlisted charset, so it needs no decoding — and a
		// recorded path is caller-supplied, so anything else is not looked up.
		if (!isValidSchefterPostId(id)) return 'Schefter article';
		const headline = findSchefterPost(id, league)?.post.headline;
		return headline ? `Schefter: ${headline}` : 'Schefter article';
	}

	if (/^\/draft\/mock\/[^/]+$/.test(local)) return 'Shared mock draft';

	return null;
}
