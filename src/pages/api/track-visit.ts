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
 *   no timestamp, no franchise. This is the half that makes the split honest,
 *   since an owner browsing signed out is exactly the traffic the
 *   authenticated counter cannot see. The one other thing this path writes is
 *   its own rate-limit counter, keyed by a salted HASH of the caller's IP with
 *   a 60-second TTL — the raw address is never stored, and the key is gone a
 *   minute later.
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
import { createHmac, createHash } from 'node:crypto';
import { recordVisit, recordAnonymousSurface } from '../../utils/owner-activity';
import { parseVisitContext } from '../../utils/visit-surface';
import { getLeagueBySlug, ALL_LEAGUES } from '../../config/leagues';

/**
 * Per-caller cap on the anonymous path. The client debounces to one beacon per
 * minute per tab, so 30/minute already allows a browser full of tabs; the limit
 * is here because this is a write endpoint that needs no session, not because
 * normal traffic comes anywhere near it. It is applied inside the same Lua
 * script as the counters (see `recordAnonymousSurface`), so a visit costs one
 * Upstash command whether it is counted or rejected, and it fails open.
 */
const ANON_MAX_PER_MINUTE = 30;
const ANON_WINDOW_SECONDS = 60;

function clientIp(request: Request): string {
	const forwarded = request.headers.get('x-forwarded-for');
	if (forwarded) return forwarded.split(',')[0].trim();
	return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Opaque per-caller key for the rate limit. A rate limit needs to tell callers
 * apart; it does not need to know who they are, and this endpoint promises
 * logged-out visitors that nothing identifying is stored — a raw IP in a Redis
 * key would quietly break that promise.
 *
 * HMAC'd with the session secret when one is set, because a bare SHA-256 of an
 * IPv4 address is reversible by exhausting the 2^32 address space; the
 * purpose-scoped message keeps it from colliding with any other use of that
 * key. With no secret configured (local dev) it degrades to a plain digest,
 * which is still not the address itself.
 */
function callerKey(request: Request): string {
	const message = `track-visit-anon:${clientIp(request)}`;
	const secret = process.env.JWT_SECRET;
	const digest = secret
		? createHmac('sha256', secret).update(message).digest('hex')
		: createHash('sha256').update(message).digest('hex');
	return digest.slice(0, 24);
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

		const { limited } = await recordAnonymousSurface(leagueId, visit, {
			callerKey: callerKey(request),
			max: ANON_MAX_PER_MINUTE,
			windowSeconds: ANON_WINDOW_SECONDS,
		});
		return new Response(null, { status: limited ? 429 : 204 });
	}

	const page = url.searchParams.get('page') || '/';
	await recordVisit(user.leagueId, user.franchiseId, page, visit);
	return new Response(null, { status: 204 });
};
