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
});

describe('product interest', () => {
	it('accepts only real product slugs', () => {
		expect(mod.isInterestProduct('league-hub')).toBe(true);
		expect(mod.isInterestProduct('owner-suite')).toBe(true);
		expect(mod.isInterestProduct('not-a-product')).toBe(false);
		expect(mod.isInterestProduct(undefined)).toBe(false);
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
		expect((await post({ product: 'league-hub', visitor: 'visitor-aaaa' })).status).toBe(200);
		await post({ product: 'league-hub', visitor: 'visitor-aaaa' });
		await post({ product: 'league-hub', visitor: 'visitor-bbbb' });
		const rows = (await mod.readProductInterest())!;
		const hub = rows.find((r) => r.slug === 'league-hub')!;
		expect(hub.people).toBe(2);
		expect(hub.clicks).toBe(3);
		expect(rows[0].slug).toBe('league-hub');
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
		expect((await post({ product: 'league-hub', visitor: '<script>' })).status).toBe(400);
		expect((await post({ product: 'league-hub', visitor: 'visitor-aaaa', email: 'x' })).status).toBe(400);
		expect(sets.size + hashes.size).toBe(0);
	});

	it('refuses a body that is not sent as JSON, so a cross-site form cannot post one', async () => {
		expect((await post({ product: 'league-hub', visitor: 'visitor-aaaa' }, 'text/plain')).status).toBe(415);
		expect(sets.size + hashes.size).toBe(0);
	});
});
