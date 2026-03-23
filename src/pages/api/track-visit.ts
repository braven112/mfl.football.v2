/**
 * POST /api/track-visit?page=/rosters
 *
 * Records a franchise owner's visit timestamp in Redis.
 * Also tracks which page was visited for popularity analytics.
 * Called via sendBeacon from the layout on every page load (debounced client-side).
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { recordVisit } from '../../utils/owner-activity';

export const POST: APIRoute = async ({ request, url }) => {
	const user = getAuthUser(request);
	if (!user?.franchiseId || !user?.leagueId) {
		return new Response(null, { status: 401 });
	}

	const page = url.searchParams.get('page') || '/';
	await recordVisit(user.leagueId, user.franchiseId, page);
	return new Response(null, { status: 204 });
};
