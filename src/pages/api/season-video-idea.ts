/**
 * POST /api/season-video-idea — the "Got an idea for the next video?" box.
 *   { text, email?, kind?, look?, platform?, website?: '' }
 *
 * Keeps the idea in Redis (src/utils/season-video/ideas.ts) for the admin list
 * at /live/video-ideas. Public and unauthenticated, so it is limited per
 * caller (on the address our platform appends, which a caller cannot forge),
 * capped site-wide per day, and `website` is a honeypot only a bot fills in.
 * The email is optional and only for a reply; it never goes to Kit from here.
 */
import type { APIRoute } from 'astro';
import { allowIdea, allowSeasonVideoCall } from '../../utils/season-video/abuse-limits';
import { cleanIdea, MAX_IDEA_CHARS, saveIdea } from '../../utils/season-video/ideas';
import { normalizeEmail } from '../../utils/season-video/kit-optin';

export const prerender = false;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });

export const POST: APIRoute = async ({ request }) => {
	if (!(await allowSeasonVideoCall(request, 'season-video-idea'))) return json({ ok: false, message: 'That’s a lot of ideas. Wait a bit and send the next one.' }, 429);
	if (Number(request.headers.get('content-length') ?? 0) > MAX_IDEA_CHARS * 4 + 1000) return json({ ok: false, message: 'Keep it under 1,000 characters.' }, 413);
	let body: { text?: unknown; email?: unknown; kind?: unknown; look?: unknown; platform?: unknown; website?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, message: 'Type your idea first.' }, 400);
	}
	if (typeof body.website === 'string' && body.website.trim()) return json({ ok: true });
	const rawEmail = typeof body.email === 'string' ? body.email.trim() : '';
	const email = rawEmail ? normalizeEmail(rawEmail) : null;
	if (rawEmail && !email) return json({ ok: false, message: 'That email doesn’t look right. Fix it, or leave it blank.' }, 400);
	const idea = cleanIdea({ ...body, email });
	if (!idea) return json({ ok: false, message: 'Type your idea first.' }, 400);
	if (!(await allowIdea())) return json({ ok: false, message: 'We’ve had a flood of ideas today. Try again tomorrow.' }, 429);
	try {
		return (await saveIdea(idea)) ? json({ ok: true }) : json({ ok: false, message: 'We couldn’t save that just now. Try again in a bit.' }, 503);
	} catch {
		return json({ ok: false, message: 'We couldn’t save that just now. Try again in a bit.' }, 503);
	}
};
