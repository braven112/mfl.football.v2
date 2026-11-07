/**
 * POST /api/league-history/guest-email — the public Ask the History demo's
 * email box (Brandon, 2026-11-07: "allow 3 and then email for another 3").
 *   { league, email, consent: true, website?: '' }
 *
 * A signed-out visitor who has used their 3 free questions leaves an email
 * and gets 3 more a day (guest-ask.ts). The address goes to Kit tagged
 * "History demo" plus "Platform: MFL", the same opt-in-only list the season
 * video's box feeds; nothing is added without the visitor's own tick.
 *
 * Abuse: limited per caller and per address (`nearestHop`, unforgeable), a
 * site-wide daily ceiling on Kit sign-ups, and `website` is a honeypot. A
 * visitor needs the demo's cookie first, which only asking sets. Only
 * production writes to Kit (`outboundAllowed`); staging and previews unlock
 * without adding anyone, so the box can be tried.
 */
import type { APIRoute } from 'astro';
import { getLeagueBySlug } from '../../../config/leagues';
import { getClientIdentity } from '../../../utils/client-ip';
import { checkRateLimit } from '../../../utils/rate-limit';
import { outboundAllowed } from '../../../utils/deploy-environment';
import { allowEmailOptIn } from '../../../utils/season-video/abuse-limits';
import { kitFetcher, normalizeEmail, subscribeToKit } from '../../../utils/season-video/kit-optin';
import { canGuestAsk, guestAllowance, guestIdFrom, unlockWithEmail } from '../../../utils/league-history/guest-ask';
import { recordFunnel } from '../../../utils/history-funnel';

export const prerender = false;

const KIT_DEMO_TAG = 'History demo';

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });

export const POST: APIRoute = async ({ request }) => {
	if (Number(request.headers.get('content-length') ?? 0) > 2000) return json({ ok: false, message: 'That’s not an email address.' }, 413);
	const { client, nearestHop } = getClientIdentity(request);
	if (nearestHop && !(await checkRateLimit('history-guest-email-hop', nearestHop, 10, 3600)).allowed) return json({ ok: false, message: 'Too many tries. Wait a bit and try again.' }, 429);
	if (client && !(await checkRateLimit('history-guest-email', client, 5, 3600)).allowed) return json({ ok: false, message: 'Too many tries. Wait a bit and try again.' }, 429);

	let body: { league?: unknown; email?: unknown; consent?: unknown; website?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, message: 'That’s not an email address.' }, 400);
	}
	const league = getLeagueBySlug(typeof body.league === 'string' ? body.league : '');
	if (!league || !canGuestAsk(league.slug)) return json({ ok: false, message: 'Unknown league.' }, 404);
	const id = guestIdFrom(request);
	if (!id) return json({ ok: false, message: 'Ask a question first.' }, 400);
	// A bot that fills every field gets a cheerful yes and nothing else.
	if (typeof body.website === 'string' && body.website.trim()) return json({ ok: true });
	if (body.consent !== true) return json({ ok: false, message: 'Tick the box so we know it’s OK to email you.' }, 400);
	const email = normalizeEmail(body.email);
	if (!email) return json({ ok: false, message: 'That doesn’t look like an email address.' }, 400);

	if (outboundAllowed()) {
		const apiKey = process.env.KIT_API_KEY;
		if (!apiKey) return json({ ok: false, message: 'Email sign-up isn’t switched on yet. Try again soon.' }, 503);
		if (!(await allowEmailOptIn())) return json({ ok: false, message: 'Sign-ups are busy right now. Try again tomorrow.' }, 429);
		try {
			if (!(await subscribeToKit(kitFetcher(apiKey), email, 'mfl', KIT_DEMO_TAG))) {
				return json({ ok: false, message: 'That address didn’t go through. Check it and try again.' }, 400);
			}
		} catch {
			return json({ ok: false, message: 'Our email list isn’t answering. Try again in a bit.' }, 503);
		}
	}
	if (!(await unlockWithEmail(id))) return json({ ok: false, message: 'Asking is resting for a minute. Try again shortly.' }, 503);
	await recordFunnel('ask_demo_email', 'mfl', id).catch(() => false);
	return json({ ok: true, guest: await guestAllowance(league.slug, id).catch(() => null) });
};
