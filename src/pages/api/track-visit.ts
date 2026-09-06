/**
 * POST /api/track-visit?page=/rosters&surface=pwa&platform=ios&league=theleague
 *
 * Records a visit from the layout's sendBeacon (debounced client-side).
 *
 * TWO PATHS, deliberately unequal:
 *
 * - SIGNED IN — the franchise's last-seen timestamp, daily page count, page
 *   popularity, and the PWA-vs-browser surface, all keyed by the session's
 *   franchise. The league comes from the SESSION, never from the query string.
 *
 * - LOGGED OUT — the surface counters only, and only in aggregate: no page,
 *   no timestamp, nothing that could identify the visitor. This is the half
 *   that makes the split honest, since an owner browsing signed out is exactly
 *   the traffic the authenticated counter cannot see.
 *
 * The `league` param exists only for that second path. A logged-out beacon
 * posts to `/api/track-visit`, a path with no league prefix, so on a preview
 * domain (where both leagues share a host) the request carries no other clue
 * which league's page it came from. It is validated against the registry, so
 * the worst a caller can do is pick a different league from the handful that
 * publicly exist — and the resulting counter is anonymous either way.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { recordVisit, recordAnonymousSurface } from '../../utils/owner-activity';
import { parseVisitContext } from '../../utils/visit-surface';
import { getLeagueBySlug, ALL_LEAGUES } from '../../config/leagues';
import { checkRateLimit } from '../../utils/rate-limit';

/**
 * Per-IP cap on the anonymous path. The client debounces to one beacon per
 * minute per tab, so 30/minute already allows a browser full of tabs; the
 * limit is here because this is a write endpoint that needs no session, not
 * because normal traffic comes anywhere near it. Fails open (see rate-limit.ts)
 * — the counters are analytics, and a Redis outage should not start rejecting.
 */
const ANON_MAX_PER_MINUTE = 30;

function clientIp(request: Request): string {
	const forwarded = request.headers.get('x-forwarded-for');
	if (forwarded) return forwarded.split(',')[0].trim();
	return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Resolve the league for an anonymous beacon from the client's `league` param
 * — a nav slug (`theleague` / `afl`) or a registry slug — checked against the
 * registry.
 *
 * No fallback on purpose. `getLeagueByPath('/api/track-visit')` answers with
 * the DEFAULT league rather than nothing, so a fallback would silently file
 * the AFL's logged-out traffic under TheLeague. An unrecognized or missing
 * param drops the count instead.
 */
function resolveAnonymousLeagueId(param: string | null): string | null {
	if (!param) return null;
	const bySlug = getLeagueBySlug(param);
	if (bySlug) return bySlug.id;
	return ALL_LEAGUES.find((l) => l.navSlug === param)?.id ?? null;
}

export const POST: APIRoute = async ({ request, url }) => {
	const visit = parseVisitContext(
		url.searchParams.get('surface'),
		url.searchParams.get('platform'),
	);

	const user = getAuthUser(request);
	if (!user?.franchiseId || !user?.leagueId) {
		// Nothing to count for a logged-out visitor whose client could not tell
		// us which surface it is — the page path alone is not worth a public
		// write endpoint.
		if (!visit) return new Response(null, { status: 204 });

		const leagueId = resolveAnonymousLeagueId(url.searchParams.get('league'));
		if (!leagueId) return new Response(null, { status: 204 });

		const { allowed } = await checkRateLimit(
			'track-visit-anon',
			clientIp(request),
			ANON_MAX_PER_MINUTE,
			60,
		);
		if (!allowed) return new Response(null, { status: 429 });

		await recordAnonymousSurface(leagueId, visit);
		return new Response(null, { status: 204 });
	}

	const page = url.searchParams.get('page') || '/';
	await recordVisit(user.leagueId, user.franchiseId, page, visit);
	return new Response(null, { status: 204 });
};
