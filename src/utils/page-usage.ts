/**
 * How much each page is really used, for ranking site search.
 *
 * Search used to sort by the page directory's hand-set `popularity`, which by
 * Oct 2026 was close to backwards: Sunday Ticket (70) outranked Tip Schefter
 * (30), TheLeague's third most-opened page. The visit counters already hold
 * the real answer, so this sums them per page:
 *
 * - every OWNER's all-time page counts, minus the league's admin franchises
 *   (`adminFranchiseIds`). The commissioner opens every page, admin tools
 *   included, and on TheLeague alone is about half of all signed-in views —
 *   left in, search would rank by one person's habits.
 * - plus the signed-out counts, which only ever name directory pages.
 *
 * Keys are canonical paths (`canonicalPath`), so a page recorded under an old
 * address or a different host's prefix lands on the same entry the directory
 * resolves to. Cached per league for a few minutes: search is opened often,
 * the ranking moves slowly, and a Redis outage must not break the page, so any
 * failure answers an empty map and search falls back to the hand-set order.
 */

import { getLeagueBySlug, type CanonicalLeagueSlug } from '../config/leagues';
import { getAllOwnerPagePopularity, getAnonPagePopularity } from './owner-activity';
import { getLeagueTeamConfigs } from './league-team-brands';
import { canonicalPath } from './site-analytics';

const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<CanonicalLeagueSlug, { at: number; usage: Map<string, number> }>();

type PageCount = { page: string; count: number };

/** Pure half: sum the counters into canonical path → views. */
export function sumPageUsage(
	league: CanonicalLeagueSlug,
	ownerPages: Record<string, readonly PageCount[]>,
	anonPages: readonly PageCount[],
	excludeFranchiseIds: readonly string[],
): Map<string, number> {
	const usage = new Map<string, number>();
	const add = ({ page, count }: PageCount) => {
		const key = canonicalPath(page, league);
		usage.set(key, (usage.get(key) ?? 0) + count);
	};
	for (const [franchiseId, pages] of Object.entries(ownerPages)) {
		if (excludeFranchiseIds.includes(franchiseId)) continue;
		pages.forEach(add);
	}
	anonPages.forEach(add);
	return usage;
}

/** Canonical path → real views for one league; empty when unavailable. */
export async function getPageUsage(league: CanonicalLeagueSlug): Promise<Map<string, number>> {
	const hit = cache.get(league);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.usage;

	const def = getLeagueBySlug(league);
	if (!def) return new Map();
	const admins = def.adminFranchiseIds ?? [];
	const owners = getLeagueTeamConfigs(league)
		.map((team) => String(team?.franchiseId ?? ''))
		.filter((id) => id && !admins.includes(id));

	try {
		const [ownerPages, anonPages] = await Promise.all([
			getAllOwnerPagePopularity(def.id, owners),
			getAnonPagePopularity(def.id),
		]);
		const usage = sumPageUsage(league, ownerPages, anonPages, admins);
		cache.set(league, { at: Date.now(), usage });
		return usage;
	} catch (err) {
		console.warn('[page-usage] could not read visit counters:', err);
		return hit?.usage ?? new Map();
	}
}
