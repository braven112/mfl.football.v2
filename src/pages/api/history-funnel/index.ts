/**
 * POST /api/history-funnel — a browser-side step of the video → History
 * funnel (src/utils/history-funnel.ts). Body: { event, platform, visitor }.
 *
 * No session: the video page is for strangers. So only BROWSER events are
 * accepted (an import starting or finishing is written by our own build
 * endpoint, never here), every field is a closed list or a pattern, and each
 * caller is rate-limited by a salted hash of their address, which is never
 * stored. Same shape as /api/product-interest.
 */
import type { APIRoute } from 'astro';
import { createHash, createHmac } from 'node:crypto';
import { getClientIdentity } from '../../../utils/client-ip';
import { isDemoDeploy } from '../../../utils/deploy-environment';
import { checkRateLimit } from '../../../utils/rate-limit';
import { isBrowserFunnelEvent, isFunnelPlatform, isFunnelVisitor, recordFunnel } from '../../../utils/history-funnel';

export const prerender = false;

/** A person making a few videos and clicking around; tight for a script. */
const MAX_PER_HOUR = 120;
/** Ceiling on the hop our infrastructure saw (see product-interest.ts). */
const MAX_PER_HOP_PER_HOUR = 1500;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function hashKey(value: string): string {
	const message = `history-funnel:${value}`;
	const secret = process.env.JWT_SECRET;
	const digest = secret
		? createHmac('sha256', secret).update(message).digest('hex')
		: createHash('sha256').update(message).digest('hex');
	return digest.slice(0, 24);
}

export const POST: APIRoute = async ({ request }) => {
	if (isDemoDeploy()) return new Response(null, { status: 404 });
	if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
		return json({ message: 'Expected JSON.' }, 415);
	}
	let body: { event?: unknown; platform?: unknown; visitor?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ message: 'Bad JSON.' }, 400);
	}
	const { event, platform, visitor } = body;
	if (!isBrowserFunnelEvent(event) || !isFunnelPlatform(platform) || !isFunnelVisitor(visitor)) {
		return json({ message: 'Unknown event.' }, 400);
	}

	const identity = getClientIdentity(request);
	if (identity.nearestHop) {
		const hop = await checkRateLimit('history-funnel-hop', hashKey(identity.nearestHop), MAX_PER_HOP_PER_HOUR, 3600);
		if (!hop.allowed) return json({ message: 'Too many requests.' }, 429);
	}
	const limit = await checkRateLimit('history-funnel', hashKey(identity.client ?? 'unknown'), MAX_PER_HOUR, 3600);
	if (!limit.allowed) return json({ message: 'Too many requests.' }, 429);

	try {
		const stored = await recordFunnel(event, platform, visitor);
		return stored ? json({ ok: true }) : json({ message: 'Storage unavailable.' }, 503);
	} catch {
		return json({ message: 'Storage unavailable.' }, 503);
	}
};
