/**
 * GET /api/owner-activity
 *
 * Returns all franchise visit timestamps for the authenticated user's league.
 * Used by client-side components that need activity data after initial render.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getAllActivity } from '../../utils/owner-activity';
import { unauthorized } from '../../utils/api-response';

export const GET: APIRoute = async ({ request }) => {
	const user = getAuthUser(request);
	if (!user?.leagueId) {
		return unauthorized({ error: 'Unauthorized' });
	}

	const data = await getAllActivity(user.leagueId);
	return new Response(JSON.stringify({ data }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
