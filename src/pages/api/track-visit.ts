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
 * - LOGGED OUT — aggregate counters only: no timestamp, no franchise, nothing
 *   that could name the visitor. The surface split, the day's signed-out
 *   total, and — only when the path is one the page directory already knows —
 *   the page. That last condition is a BOUND, not a nicety: the field names of
 *   an anonymous hash come from an unauthenticated caller, so an unchecked
 *   path would let anyone grow it one invented string at a time (the same
 *   reasoning that keeps the surface allowlist to eight fields). An unknown
 *   path still counts toward the day's total; it just never names a page.
 *   This is the half that makes the numbers honest, since someone browsing
 *   signed out is exactly the traffic the authenticated counter cannot see.
 *   The one other thing this path writes is its own rate-limit counter, keyed
 *   by a salted HASH of the caller's IP with a 60-second TTL — the raw address
 *   is never stored, and the key is gone a minute later.
 *
 * SITE INSIGHTS. Every beacon — including MFL Live's and the shared host's,
 * which carry no `league` — is also counted in the admin-only, site-wide
 * insights (`/live/analytics`), with the same signed-out bound: an anonymous
 * page is named only when it is a known route.
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
import { recordVisit, recordAnonymousVisit } from '../../utils/owner-activity';
import { canonicalPath, isDirectoryPath } from '../../utils/site-analytics';
import { parseVisitContext } from '../../utils/visit-surface';
import {
	getLeagueBySlug,
	ALL_LEAGUES,
	type LeagueDefinition,
} from '../../config/leagues';
import { getClientIdentity } from '../../utils/client-ip';
import { recordInsightVisit, type InsightVisit } from '../../utils/site-insights';
import {
	classifyLandingSource,
	isKnownAppPath,
	normalizeInsightPath,
	parseInsightDevice,
	parseInsightLinkArea,
	resolveSection,
} from '../../utils/site-insights-model';

/**
 * Per-caller cap on the anonymous path. The client debounces to one beacon per
 * minute per tab, so 30/minute already allows a browser full of tabs; the limit
 * is here because this is a write endpoint that needs no session, not because
 * normal traffic comes anywhere near it. It is applied inside the same Lua
 * script as the counters (see `recordAnonymousVisit`), so a visit costs one
 * Upstash command whether it is counted or rejected, and it fails open.
 */
const ANON_MAX_PER_MINUTE = 30;
const ANON_WINDOW_SECONDS = 60;

/**
 * Shared helper rather than another private reader: three copies of this had
 * grown and they disagreed on header precedence and fallback. The value is
 * still hashed below — see the note on the rate-limit key.
 */
function clientIp(request: Request): string {
	return getClientIdentity(request).client ?? 'unknown';
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
function resolveAnonymousLeague(param: string | null): LeagueDefinition | null {
	if (!param) return null;
	const bySlug = getLeagueBySlug(param);
	if (bySlug) return bySlug;
	return ALL_LEAGUES.find((l) => l.navSlug === param) ?? null;
}

export const POST: APIRoute = async ({ request, url }) => {
	const visit = parseVisitContext(
		url.searchParams.get('surface'),
		url.searchParams.get('platform'),
	);

	const rawPage = url.searchParams.get('page');

	// The league whose pages sent this beacon — only TheLeagueLayout names one.
	// MFL Live and the shared host's own pages send none, and so never touch
	// the per-league `/activity` counters below; they are counted only in the
	// site-wide insights (see src/utils/site-insights.ts).
	const league = resolveAnonymousLeague(url.searchParams.get('league'));
	const surface = visit?.surface ?? null;

	const user = getAuthUser(request);
	if (!user?.franchiseId || !user?.leagueId) {
		// A beacon that reports neither a surface nor a page has nothing to
		// count, and this endpoint needs no session — so it does no work.
		if (!visit && !rawPage) return new Response(null, { status: 204 });

		const limit = {
			callerKey: callerKey(request),
			max: ANON_MAX_PER_MINUTE,
			windowSeconds: ANON_WINDOW_SECONDS,
		};

		if (league) {
			// Only a path the directory recognizes may name a page (see the
			// header). Checked BEFORE canonicalizing — `isDirectoryPath`
			// canonicalizes to answer, so an unknown path on this
			// unauthenticated, uncapped route costs one pass instead of two.
			const known = Boolean(rawPage && isDirectoryPath(rawPage, league.slug));
			const page = known ? canonicalPath(rawPage!, league.slug) : null;

			const { limited } = await recordAnonymousVisit(league.id, { visit, page }, limit);
			if (limited) return new Response(null, { status: 429 });
			// Already rate-limited by the script above, so no second limit here.
			// `page` is already canonical, or null for a path it may not name.
			await recordInsightVisit({ ...describeInsightVisit(url, league, page, surface), user: null });
			return new Response(null, { status: 204 });
		}

		// No league: MFL Live or the shared host's own pages. The path is only
		// normalized (a bounded regex pass, no directory walk) before the
		// allowlist decides whether it may be named.
		const insight = describeInsightVisit(url, null, rawPage || '/', surface);
		const { limited } = await recordInsightVisit({
			...insight,
			page: insight.page && isKnownAppPath(insight.page) ? insight.page : null,
			user: null,
			rateLimit: limit,
		});
		return new Response(null, { status: limited ? 429 : 204 });
	}

	if (league) await recordVisit(user.leagueId, user.franchiseId, rawPage || '/', visit);
	const signedInPage = league && rawPage ? canonicalPath(rawPage, league.slug) : rawPage || '/';
	await recordInsightVisit({
		...describeInsightVisit(url, league, signedInPage, surface),
		user: { leagueId: user.leagueId, franchiseId: user.franchiseId, username: user.name ?? '' },
	});
	return new Response(null, { status: 204 });
};

/**
 * The site-insights half of a beacon: section, page, device and — on a tab's
 * first beacon only (`landing=1`) — where the visit came from. Every value is
 * validated against a fixed vocabulary in `site-insights-model.ts`.
 */
function describeInsightVisit(
	url: URL,
	league: LeagueDefinition | null,
	/** Already canonical for a league page; null when the page may not be named. */
	canonicalPage: string | null,
	surface: string | null,
): Omit<InsightVisit, 'user'> {
	const page = normalizeInsightPath(canonicalPage);
	const landing = url.searchParams.get('landing') === '1';
	return {
		section: resolveSection(league?.slug ?? null, page ?? ''),
		page,
		device: parseInsightDevice(url.searchParams.get('device')),
		source: landing
			? classifyLandingSource({
					refHost: url.searchParams.get('ref'),
					requestHost: url.hostname,
					srcTag: url.searchParams.get('src'),
					surface,
				})
			: null,
		// Which tagged area's link brought the visitor here (fixed vocabulary;
		// anything else is dropped, never stored).
		via: parseInsightLinkArea(url.searchParams.get('via')),
	};
}
