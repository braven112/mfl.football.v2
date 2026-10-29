import type { APIRoute } from 'astro';
import { appJson, requireAppUser } from '../../../utils/live/owner-league';
import { hasMflLivePro } from '../../../utils/mfl-live-pro';
import { checkRateLimit } from '../../../utils/rate-limit';
import { LOGO_TRACE_MAX_BYTES, LOGO_TRACE_PER_HOUR, traceLogo } from '../../../utils/logo-trace';

export const prerender = false;

/**
 * Owner Suite Pro's logo tracer (`src/utils/logo-trace.ts`).
 *
 * POST the logo image itself as the body (PNG, JPEG or WebP, up to 4 MB) →
 * the traced SVG as `image/svg+xml`. Errors are JSON: 401 signed out, 403 not
 * Pro, 413 too big, 415 not an image, 429 over the hourly limit.
 *
 * Pro only (Brandon, 2026-10-29). The limit keys on league AND franchise:
 * both leagues have a franchise 0001.
 */
export const POST: APIRoute = async ({ request }) => {
	const gate = requireAppUser(request);
	if (gate instanceof Response) return gate;
	if (!hasMflLivePro(gate.user)) return appJson({ ok: false, error: 'pro-required' }, 403);

	const declared = Number(request.headers.get('content-length') ?? 0);
	if (declared > LOGO_TRACE_MAX_BYTES) return appJson({ ok: false, error: 'too-large' }, 413);

	const limit = await checkRateLimit('logo-trace', `${gate.user.leagueId}:${gate.user.franchiseId}`, LOGO_TRACE_PER_HOUR, 3600);
	if (!limit.allowed) return appJson({ ok: false, error: 'rate-limited' }, 429);

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
