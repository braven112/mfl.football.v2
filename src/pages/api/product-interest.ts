/**
 * POST /api/product-interest — the "coming soon" product buttons.
 *
 * Body: { product, visitor, email? }. Without an email it counts a click; with
 * one it keeps the address for that product. No session is needed (the
 * buttons are for strangers), so every input is checked against a closed list
 * or a pattern before it reaches Redis, and each caller is rate-limited by a
 * salted hash of their address — the address itself is never stored.
 * See src/utils/product-interest.ts.
 */
import type { APIRoute } from 'astro';
import { createHash, createHmac } from 'node:crypto';
import { getClientIdentity } from '../../utils/client-ip';
import { isDemoDeploy } from '../../utils/deploy-environment';
import { checkRateLimit } from '../../utils/rate-limit';
import {
	isInterestProduct,
	isVisitorId,
	normalizeEmail,
	recordInterestClick,
	recordInterestEmail,
} from '../../utils/product-interest';

export const prerender = false;

/** Generous for one person reading the page; tight for a script. */
const MAX_PER_HOUR = 40;
/**
 * A ceiling on the hop our own infrastructure saw (client-ip.ts): the per-caller
 * key is forgeable on the raw *.vercel.app URLs, so it alone limits nothing. A
 * Cloudflare edge is shared by many real visitors, hence the larger number.
 */
const MAX_PER_HOP_PER_HOUR = 600;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function hashKey(value: string): string {
	const message = `product-interest:${value}`;
	const secret = process.env.JWT_SECRET;
	const digest = secret
		? createHmac('sha256', secret).update(message).digest('hex')
		: createHash('sha256').update(message).digest('hex');
	return digest.slice(0, 24);
}

export const POST: APIRoute = async ({ request }) => {
	if (isDemoDeploy()) return new Response(null, { status: 404 });
	// JSON only: a cross-site <form enctype="text/plain"> can post a JSON-shaped
	// body without a CORS preflight, but it cannot set this header.
	if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
		return json({ message: 'Expected JSON.' }, 415);
	}

	let body: { product?: unknown; visitor?: unknown; email?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ message: 'Bad JSON.' }, 400);
	}
	const { product, visitor } = body;
	if (!isInterestProduct(product) || !isVisitorId(visitor)) return json({ message: 'Unknown product.' }, 400);

	const hasEmail = body.email !== undefined && body.email !== '';
	const email = hasEmail ? normalizeEmail(body.email) : null;
	if (hasEmail && !email) return json({ message: 'That email doesn’t look right.' }, 400);

	const identity = getClientIdentity(request);
	if (identity.nearestHop) {
		const hop = await checkRateLimit('product-interest-hop', hashKey(identity.nearestHop), MAX_PER_HOP_PER_HOUR, 3600);
		if (!hop.allowed) return json({ message: 'Too many requests.' }, 429);
	}
	const limit = await checkRateLimit('product-interest', hashKey(identity.client ?? 'unknown'), MAX_PER_HOUR, 3600);
	if (!limit.allowed) return json({ message: 'Too many requests.' }, 429);

	try {
		const stored = email
			? await recordInterestEmail(product, email)
			: await recordInterestClick(product, visitor);
		if (!stored) return json({ message: 'Storage unavailable.' }, 503);
		return json({ ok: true });
	} catch {
		return json({ message: 'Storage unavailable.' }, 503);
	}
};
