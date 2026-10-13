/**
 * GET /api/owner-activity
 *
 * Returns all franchise visit timestamps for the authenticated user's league.
 * The same data as the Owner Activity report, so the same gate: private to
 * site admins, and to the commissioner once an admin has opened it to them
 * (src/utils/owner-activity-access.ts).
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getAllActivity } from '../../utils/owner-activity';
import { resolveOwnerActivityAccess } from '../../utils/owner-activity-access';
import { getLeagueById } from '../../config/leagues';
import { unauthorized } from '../../utils/api-response';

export const GET: APIRoute = async ({ request }) => {
	const user = getAuthUser(request);
	const league = user?.leagueId ? getLeagueById(user.leagueId) : undefined;
	if (!user || !league) {
		return unauthorized({ error: 'Unauthorized' });
	}
	const access = await resolveOwnerActivityAccess(user, league);
	if (access.kind !== 'allow') {
		return new Response(JSON.stringify({ error: 'Forbidden' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const data = await getAllActivity(user.leagueId);
	return new Response(JSON.stringify({ data }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
