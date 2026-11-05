/**
 * GET /api/season-video-logo?url=<image link> — a logo for the video maker
 * (/champion-video), fetched here and handed back as a data: URL.
 *
 * The browser records the video from a canvas, and one picture loaded from
 * another site taints that canvas so it can't be recorded. So a pasted link
 * is fetched server-side, through `fetchLogoAsDataUrl` (public URLs only via
 * `validatePublicUrl`, image types only, size-capped). Public and
 * unauthenticated, so it is rate-limited (src/utils/season-video/abuse-limits.ts).
 */
import type { APIRoute } from 'astro';
import { allowSeasonVideoCall } from '../../utils/season-video/abuse-limits';
import { fetchLogoAsDataUrl } from '../../utils/season-video/fetch-logo';

export const prerender = false;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
	});

export const GET: APIRoute = async ({ request, url }) => {
	if (!(await allowSeasonVideoCall(request, 'season-video-logo'))) return json({ ok: false, error: 'rate-limited', message: 'Too many tries. Wait a bit and try again.' }, 429);

	const raw = (url.searchParams.get('url') ?? '').trim();
	let target: URL;
	try {
		target = new URL(raw);
	} catch {
		return json({ ok: false, error: 'bad-url', message: 'That doesn’t look like a link. It should start with https://' }, 400);
	}
	if (target.protocol !== 'https:' && target.protocol !== 'http:') {
		return json({ ok: false, error: 'bad-url', message: 'That doesn’t look like a link. It should start with https://' }, 400);
	}
	const logo = await fetchLogoAsDataUrl(target.href).catch(() => null);
	if (!logo) {
		return json(
			{ ok: false, error: 'no-image', message: 'We couldn’t get an image from that link. Try the link to the picture itself, or upload the file.' },
			404,
		);
	}
	return json({ ok: true, logo });
};
