import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The "coming soon" product buttons (src/utils/product-interest.ts and
 * /api/product-interest). The endpoint needs no session, so the rules that
 * matter are the ones that keep a stranger from writing arbitrary keys: only
 * real product slugs, only a plausible browser id, only a plausible email.
 */

const sets = new Map<string, Set<string>>();
const hashes = new Map<string, Map<string, string>>();
const fakeRedis = {
	sadd: async (k: string, ...m: string[]) => {
		const s = sets.get(k) ?? new Set();
		m.forEach((x) => s.add(x));
		sets.set(k, s);
		return m.length;
	},
	scard: async (k: string) => sets.get(k)?.size ?? 0,
	hincrby: async (k: string, f: string, by: number) => {
		const h = hashes.get(k) ?? new Map();
		const v = Number(h.get(f) ?? 0) + by;
		h.set(f, String(v));
		hashes.set(k, h);
		return v;
	},
	hget: async (k: string, f: string) => hashes.get(k)?.get(f) ?? null,
	hset: async (k: string, fv: Record<string, string>) => {
		const h = hashes.get(k) ?? new Map();
		Object.entries(fv).forEach(([f, v]) => h.set(f, v));
		hashes.set(k, h);
		return 1;
	},
	hlen: async (k: string) => hashes.get(k)?.size ?? 0,
	hgetall: async (k: string) => (hashes.has(k) ? Object.fromEntries(hashes.get(k)!) : null),
	incr: async () => 1,
	expire: async () => 1,
};

vi.mock('../src/utils/redis-client', () => ({ getRedis: async () => fakeRedis }));
const pushes: unknown[][] = [];
vi.mock('../src/utils/push-sender', () => ({
	sendPushToFranchise: async (...args: unknown[]) => {
		pushes.push(args);
		return { sent: 1 };
	},
}));

const mod = await import('../src/utils/product-interest');
const { POST } = await import('../src/pages/api/product-interest');

const post = (body: unknown, contentType = 'application/json') =>
	POST({
		request: new Request('http://x/api/product-interest', {
			method: 'POST',
			headers: { 'Content-Type': contentType },
			body: JSON.stringify(body),
		}),
	} as any) as Promise<Response>;

beforeEach(() => {
	sets.clear();
	hashes.clear();
	pushes.length = 0;
});

describe('product interest', () => {
	it('accepts only real product slugs', () => {
		expect(mod.isInterestProduct('league-package')).toBe(true);
		expect(mod.isInterestProduct('contest-package')).toBe(true);
		expect(mod.isInterestProduct('not-a-product')).toBe(false);
		expect(mod.isInterestProduct(undefined)).toBe(false);
	});

	it('accepts the /addons doors that have no product page, and reports them', async () => {
		for (const slug of ['tv-app', 'phone-app', 'custom-build', 'champion-card', 'league-domain', 'logo-hosting']) expect(mod.isInterestProduct(slug)).toBe(true);
		expect((await post({ product: 'tv-app', visitor: 'visitor-aaaa' })).status).toBe(200);
		const tv = (await mod.readProductInterest())!.find((r) => r.slug === 'tv-app')!;
		expect(tv.name).toBe('TV app');
		expect(tv.people).toBe(1);
	});

	it('validates browser ids and emails', () => {
		expect(mod.isVisitorId('3b241101-e2bb-4255-8caf-4136c566a962')).toBe(true);
		expect(mod.isVisitorId('short')).toBe(false);
		expect(mod.isVisitorId('a:b:c:d:e:f')).toBe(false);
		expect(mod.normalizeEmail('  Owner@Example.COM ')).toBe('owner@example.com');
		expect(mod.normalizeEmail('nope')).toBeNull();
		expect(mod.normalizeEmail(`${'a'.repeat(250)}@x.co`)).toBeNull();
	});

	it('counts a browser once per product but every click', async () => {
		expect((await post({ product: 'league-package', visitor: 'visitor-aaaa' })).status).toBe(200);
		await post({ product: 'league-package', visitor: 'visitor-aaaa' });
		await post({ product: 'league-package', visitor: 'visitor-bbbb' });
		const rows = (await mod.readProductInterest())!;
		const hub = rows.find((r) => r.slug === 'league-package')!;
		expect(hub.people).toBe(2);
		expect(hub.clicks).toBe(3);
		expect(rows[0].slug).toBe('league-package');
	});

	it('keeps an email once, without counting it as a click', async () => {
		await post({ product: 'add-ons', visitor: 'visitor-aaaa', email: 'A@b.co' });
		await post({ product: 'add-ons', visitor: 'visitor-aaaa', email: 'a@b.co' });
		const addOns = (await mod.readProductInterest())!.find((r) => r.slug === 'add-ons')!;
		expect(addOns.emails.map((e) => e.email)).toEqual(['a@b.co']);
		expect(addOns.clicks).toBe(0);
	});

	it('rejects unknown products, bad ids and bad emails without writing', async () => {
		expect((await post({ product: 'free-money', visitor: 'visitor-aaaa' })).status).toBe(400);
		expect((await post({ product: 'league-package', visitor: '<script>' })).status).toBe(400);
		expect((await post({ product: 'league-package', visitor: 'visitor-aaaa', email: 'x' })).status).toBe(400);
		expect(sets.size + hashes.size).toBe(0);
	});

	it('refuses a body that is not sent as JSON, so a cross-site form cannot post one', async () => {
		expect((await post({ product: 'league-package', visitor: 'visitor-aaaa' }, 'text/plain')).status).toBe(415);
		expect(sets.size + hashes.size).toBe(0);
	});
});

describe('contact requests (products on sale now)', () => {
	const visitor = 'abcdef12-3456';
	const base = { product: 'beat-reporter', visitor, contact: true, name: 'Pat', email: 'Pat@Example.com', league: 'Gumbas' };

	it('lists exactly the two $49 products and the bundle as available now', () => {
		expect([...mod.AVAILABLE_NOW].sort()).toEqual(['beat-reporter', 'history-and-reporter', 'league-history']);
	});

	it('keeps the request, adds the email, and pushes the owner', async () => {
		const res = await post({ ...base, message: 'Can you start this week?' });
		expect(res.status).toBe(200);
		const rows = await mod.readContactRequests();
		expect(rows).toHaveLength(1);
		expect(rows![0]).toMatchObject({ product: 'beat-reporter', name: 'Pat', email: 'pat@example.com', league: 'Gumbas', message: 'Can you start this week?' });
		const list = await mod.readProductInterest();
		expect(list!.find((r) => r.slug === 'beat-reporter')!.emails.map((e) => e.email)).toEqual(['pat@example.com']);
		expect(pushes).toHaveLength(1);
		expect(pushes[0][3]).toBe('ops-product-request');
	});

	it('a resend replaces the earlier request instead of adding one', async () => {
		await post(base);
		await post({ ...base, league: 'Gumbas League' });
		const rows = await mod.readContactRequests();
		expect(rows).toHaveLength(1);
		expect(rows![0].league).toBe('Gumbas League');
	});

	it('refuses a product that is not on sale, and a request with no name or email', async () => {
		expect((await post({ ...base, product: 'league-package' })).status).toBe(400);
		expect((await post({ ...base, name: '   ' })).status).toBe(400);
		expect((await post({ ...base, email: '' })).status).toBe(400);
		expect(await mod.readContactRequests()).toEqual([]);
		expect(pushes).toHaveLength(0);
	});

	it('strips control characters and caps the free text', () => {
		expect(mod.cleanContactText('a\u0000b\n\nc  d', 80)).toBe('a b c d');
		expect(mod.cleanContactText('x'.repeat(500), 200)).toHaveLength(200);
		expect(mod.cleanContactText(42, 80)).toBe('');
	});
});
