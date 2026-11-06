/**
 * POST /api/season-video-email — the opt-in box after a video is made.
 *   { email, consent: true, platform?: 'mfl' | 'sleeper' | 'espn', website?: '' }
 *
 * Adds the address to Kit tagged "Season video" (src/utils/season-video/kit-optin.ts).
 * Nothing is sent without the visitor's own tick. Kit prices by subscriber,
 * so a bot filling the list costs real money: it is rate-limited per caller
 * (on the address our platform appends, which a caller cannot forge) and
 * capped site-wide per day, and `website` is a honeypot only a bot fills in.
 * Only production sends (`outboundAllowed`): staging and previews answer as if
 * it worked, so the form can be tried without filling the real list.
 */
import type { APIRoute } from 'astro';
import { allowEmailOptIn, allowSeasonVideoCall } from '../../utils/season-video/abuse-limits';
import { outboundAllowed } from '../../utils/deploy-environment';
import { kitFetcher, normalizeEmail, platformOf, subscribeToKit } from '../../utils/season-video/kit-optin';
import { recordFunnel } from '../../utils/history-funnel';

export const prerender = false;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });

export const POST: APIRoute = async ({ request }) => {
	if (!(await allowSeasonVideoCall(request, 'season-video-email'))) return json({ ok: false, message: 'Too many tries. Wait a bit and try again.' }, 429);
	if (Number(request.headers.get('content-length') ?? 0) > 2000) return json({ ok: false, message: 'That’s not an email address.' }, 413);
	let body: { email?: unknown; consent?: unknown; platform?: unknown; website?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, message: 'That’s not an email address.' }, 400);
	}
	// A bot that fills every field gets a cheerful yes and nothing else.
	if (typeof body.website === 'string' && body.website.trim()) return json({ ok: true });
	if (body.consent !== true) return json({ ok: false, message: 'Tick the box so we know it’s OK to email you.' }, 400);
	const email = normalizeEmail(body.email);
	if (!email) return json({ ok: false, message: 'That doesn’t look like an email address.' }, 400);

	// Staging and previews validate everything but never add a real person to the real list.
	if (!outboundAllowed()) return json({ ok: true, preview: true });

	const apiKey = process.env.KIT_API_KEY;
	if (!apiKey) return json({ ok: false, message: 'Email sign-up isn’t switched on yet. Your video is all yours either way.' }, 503);
	if (!(await allowEmailOptIn())) return json({ ok: false, message: 'Sign-ups are busy right now. Try again tomorrow.' }, 429);
	try {
		const platform = platformOf(body.platform);
		const ok = await subscribeToKit(kitFetcher(apiKey), email, platform);
		// Counted for the funnel on Site Insights; a count that fails never fails the sign-up.
		if (ok) await recordFunnel('email_optin', platform ?? 'manual').catch(() => false);
		return ok ? json({ ok: true }) : json({ ok: false, message: 'That address didn’t go through. Check it and try again.' }, 400);
	} catch {
		return json({ ok: false, message: 'Our email list isn’t answering. Try again in a bit.' }, 503);
	}
};
