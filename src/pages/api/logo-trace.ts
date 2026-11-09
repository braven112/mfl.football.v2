import type { APIRoute } from 'astro';
import { getMflLiveUser } from '../../utils/auth';
import { getClientIdentity } from '../../utils/client-ip';
import { appJson } from '../../utils/live/owner-league';
import { checkRateLimit } from '../../utils/rate-limit';
import { LOGO_TRACE_HOP_PER_HOUR, LOGO_TRACE_MAX_BYTES, LOGO_TRACE_PER_HOUR, traceLogo } from '../../utils/logo-trace';

export const prerender = false;

/**
 * The free logo tracer (`src/utils/logo-trace.ts`), on the public logo maker,
 * `/team-logo`. Not under `api/mfl-live/`: those endpoints are app-only and
 * gated on an owner session, and this one is open to anyone.
 *
 * POST the logo image itself as the body (PNG, JPEG or WebP, up to 4 MB) →
 * the traced SVG as `image/svg+xml`. Errors are JSON: 413 too big, 415 not an
 * image, 429 over the hourly limit.
 *
 * Free and needs no account (Brandon, 2026-11-09: it was Pro, but a trace is
 * about a second of CPU, a fraction of a cent). The hourly limit is what keeps
 * it that cheap: a signed-in owner keys on league AND franchise (both leagues
 * have a franchise 0001); anyone else keys on their address, which a caller
 * reaching the raw deployment URL can forge, so a coarse ceiling on the
 * unforgeable nearest hop sits behind it (`src/utils/client-ip.ts`).
 */
export const POST: APIRoute = async ({ request }) => {
	const declared = Number(request.headers.get('content-length') ?? 0);
	if (declared > LOGO_TRACE_MAX_BYTES) return appJson({ ok: false, error: 'too-large' }, 413);

	const user = getMflLiveUser(request);
	const limited = user
		? !(await checkRateLimit('logo-trace', `${user.leagueId}:${user.franchiseId}`, LOGO_TRACE_PER_HOUR, 3600)).allowed
		: await anonymousLimitHit(request);
	if (limited) return appJson({ ok: false, error: 'rate-limited' }, 429);

	const bytes = new Uint8Array(await request.arrayBuffer());
	const traced = await traceLogo(bytes).catch((e) => {
		console.error('[logo-trace] failed', e);
		return null;
	});
	if (!traced) return appJson({ ok: false, error: 'trace-failed' }, 500);
	if (!traced.ok) {
		const status = traced.error === 'too-large' ? 413 : traced.error === 'not-an-image' ? 415 : 422;
		return appJson({ ok: false, error: traced.error }, status);
	}
	return new Response(traced.svg, {
		headers: {
			'Content-Type': 'image/svg+xml; charset=utf-8',
			'Cache-Control': 'private, no-store',
		},
	});
};

async function anonymousLimitHit(request: Request): Promise<boolean> {
	const { client, nearestHop } = getClientIdentity(request);
	const own = await checkRateLimit('logo-trace-ip', client ?? 'anon', LOGO_TRACE_PER_HOUR, 3600);
	if (!own.allowed) return true;
	const hop = await checkRateLimit('logo-trace-hop', nearestHop ?? 'anon', LOGO_TRACE_HOP_PER_HOUR, 3600);
	return !hop.allowed;
}
