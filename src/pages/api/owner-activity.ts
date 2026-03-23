/**
 * GET /api/owner-activity
 *
 * Returns all franchise visit timestamps for the authenticated user's league.
 * Used by client-side components that need activity data after initial render.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getAllActivity } from '../../utils/owner-activity';

export const GET: APIRoute = async ({ request }) => {
	const user = getAuthUser(request);
	if (!user?.leagueId) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const data = await getAllActivity(user.leagueId);
	return new Response(JSON.stringify({ data }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
