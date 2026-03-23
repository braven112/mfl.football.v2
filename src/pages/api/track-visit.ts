/**
 * POST /api/track-visit
 *
 * Records a franchise owner's visit timestamp in Redis.
 * Called via sendBeacon from the layout on every page load (debounced client-side).
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { recordVisit } from '../../utils/owner-activity';

export const POST: APIRoute = async ({ request }) => {
	const user = getAuthUser(request);
	if (!user?.franchiseId || !user?.leagueId) {
		return new Response(null, { status: 401 });
	}

	await recordVisit(user.leagueId, user.franchiseId);
	return new Response(null, { status: 204 });
};
