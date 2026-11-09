import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { looksLikeImage, snapAlpha, traceLogo, withViewBox, LOGO_TRACE_MAX_BYTES } from '../src/utils/logo-trace';

/**
 * The free logo tracer: a finished AI logo PNG in, a scalable SVG out. The
 * traced file must carry a viewBox (vtracer writes none, so it would not
 * scale), the feathered edge must not come back as a gray halo, and the
 * endpoint, open to anyone, must hold every caller to an hourly limit BEFORE
 * it spends a trace.
 */

const getMflLiveUser = vi.fn();
const checkRateLimit = vi.fn();
vi.mock('../src/utils/auth', () => ({ getMflLiveUser: (r: Request) => getMflLiveUser(r) }));
vi.mock('../src/utils/rate-limit', () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));

/** A red disc with a feathered edge on a transparent ground, as a PNG. */
function discPng(): Uint8Array {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><defs><radialGradient id="g"><stop offset="0.8" stop-color="#c8102e"/><stop offset="1" stop-color="#c8102e" stop-opacity="0"/></radialGradient></defs><circle cx="100" cy="100" r="90" fill="url(#g)"/></svg>`;
	return new Resvg(svg).render().asPng();
}

describe('logo trace helpers', () => {
	it('adds a viewBox matching the size, once', () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1254"><path d="M0 0"/></svg>';
		expect(withViewBox(svg)).toContain('viewBox="0 0 1254 1254" width="1254" height="1254"');
		expect(withViewBox(withViewBox(svg))).toBe(withViewBox(svg));
	});

	it('snaps every pixel fully solid or fully clear', () => {
		const px = new Uint8Array([1, 2, 3, 40, 1, 2, 3, 159, 1, 2, 3, 160, 1, 2, 3, 255]);
		snapAlpha(px);
		expect([px[3], px[7], px[11], px[15]]).toEqual([0, 0, 255, 255]);
		expect([px[0], px[1], px[2]]).toEqual([1, 2, 3]);
	});

	it('knows an image by its first bytes', () => {
		expect(looksLikeImage(discPng())).toBe(true);
		expect(looksLikeImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(false);
	});
});

describe('traceLogo', () => {
	it('traces a PNG into a scalable SVG with no halo color', async () => {
		const traced = await traceLogo(discPng());
		expect(traced.ok).toBe(true);
		if (!traced.ok) return;
		expect(traced.svg).toMatch(/^<svg[^>]*viewBox="0 0 200 200"/);
		expect(traced.svg).toContain('<path');
		const fills = [...traced.svg.matchAll(/fill="(#[0-9a-f]{3,6})"/gi)].map((m) => m[1].toLowerCase());
		expect(fills.length).toBeGreaterThan(0);
		// A gray or pale ring would be a fill well off the disc's red.
		for (const f of fills) expect(f, f).toMatch(/^#(c[0-9a-f]|b[0-9a-f]|d[0-9a-f])/);
	});

	it('refuses what is not an image, and what is too big', async () => {
		expect(await traceLogo(new TextEncoder().encode('hello'))).toEqual({ ok: false, error: 'not-an-image' });
		expect(await traceLogo(new Uint8Array(LOGO_TRACE_MAX_BYTES + 1))).toEqual({ ok: false, error: 'too-large' });
	});
});

describe('/api/logo-trace', () => {
	beforeEach(() => {
		getMflLiveUser.mockReset();
		checkRateLimit.mockReset();
		checkRateLimit.mockResolvedValue({ allowed: true, count: 1 });
	});

	const post = async (body: Uint8Array) => {
		const { POST } = await import('../src/pages/api/logo-trace');
		const request = new Request('https://mfl.football/api/logo-trace', { method: 'POST', body: new Blob([body as BlobPart]) });
		return (POST as (ctx: { request: Request }) => Promise<Response>)({ request });
	};

	it('traces for anyone, signed in or not', async () => {
		for (const user of [null, { leagueId: '999999', franchiseId: '0001', role: 'owner' }]) {
			getMflLiveUser.mockReturnValue(user);
			const res = await post(discPng());
			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toContain('image/svg+xml');
			expect(await res.text()).toContain('viewBox=');
		}
	});

	it('limits a signed-in owner by league and franchise, anyone else by address', async () => {
		getMflLiveUser.mockReturnValue({ leagueId: '999999', franchiseId: '0001', role: 'owner' });
		await post(discPng());
		expect(checkRateLimit.mock.calls.map((c) => [c[0], c[1]])).toEqual([['logo-trace', '999999:0001']]);

		checkRateLimit.mockClear();
		getMflLiveUser.mockReturnValue(null);
		await post(discPng());
		expect(checkRateLimit.mock.calls.map((c) => c[0])).toEqual(['logo-trace-ip', 'logo-trace-hop']);
	});

	it('429s over the limit without tracing', async () => {
		getMflLiveUser.mockReturnValue(null);
		checkRateLimit.mockResolvedValue({ allowed: false, count: 99 });
		const res = await post(discPng());
		expect(res.status).toBe(429);
		expect(await res.json()).toMatchObject({ error: 'rate-limited' });
	});
});
