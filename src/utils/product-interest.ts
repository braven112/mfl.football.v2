/**
 * "Coming soon" interest for the products that are not on sale yet.
 *
 * The homepage shows every product with its price, but nothing is for sale
 * (`PRODUCT_PAGES_PUBLIC` is still false). Each product's button is a fake
 * door: it opens a "coming soon" dialog, counts the click, and offers an
 * optional email so the owner can tell interested people at launch. The
 * owner reads the totals on Site Insights (`/live/analytics`).
 *
 *   product-interest:v:<slug>       set of browser ids that clicked (the count)
 *   product-interest:clicks         hash slug → every click, repeats included
 *   product-interest:emails:<slug>  hash email → ISO time it was left
 *
 * A browser is counted once per product: the id is a random value the page
 * keeps in localStorage, never anything about the person. The endpoint needs
 * no session, so every field name here comes from a closed list (the product
 * slug) or is validated (the id, the email) before it is written.
 */
import { PRODUCTS, type ProductSlug } from '../data/products';
import { getRedis } from './redis-client';

/**
 * Doors with no product page behind them: things the MFL Add-ons landing page
 * (`/addons`) asks about before they are priced or packaged. They count and
 * keep emails exactly like a product, and Site Insights lists them alongside.
 */
export const INTEREST_ONLY = [
	{ slug: 'tv-app', name: 'TV app' },
	{ slug: 'phone-app', name: 'Phone app' },
	{ slug: 'custom-build', name: 'Custom builds' },
	{ slug: 'champion-card', name: 'Champion card' },
	{ slug: 'league-domain', name: 'League domain' },
	{ slug: 'logo-hosting', name: 'Logo hosting' },
] as const;

export type InterestSlug = ProductSlug | (typeof INTEREST_ONLY)[number]['slug'];

const INTEREST_ITEMS: ReadonlyArray<{ slug: InterestSlug; name: string }> = [
	...PRODUCTS.map((p) => ({ slug: p.slug, name: p.name })),
	...INTEREST_ONLY,
];

const visitorsKey = (slug: InterestSlug) => `product-interest:v:${slug}`;
const CLICKS_KEY = 'product-interest:clicks';
const emailsKey = (slug: InterestSlug) => `product-interest:emails:${slug}`;

const INTEREST_SLUGS = new Set<string>(INTEREST_ITEMS.map((p) => p.slug));

export function isInterestProduct(slug: unknown): slug is InterestSlug {
	return typeof slug === 'string' && INTEREST_SLUGS.has(slug);
}

/** The browser id the page generates: a UUID, or anything close enough to one. */
export function isVisitorId(id: unknown): id is string {
	return typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);
}

/** Lower-cased and trimmed, or null when it is not plausibly an address. */
export function normalizeEmail(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const email = raw.trim().toLowerCase();
	if (email.length > 254) return null;
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Count a click. Returns false when storage is unavailable. */
export async function recordInterestClick(slug: InterestSlug, visitor: string): Promise<boolean> {
	const redis = await getRedis();
	if (!redis) return false;
	await Promise.all([redis.sadd(visitorsKey(slug), visitor), redis.hincrby(CLICKS_KEY, slug, 1)]);
	return true;
}

/**
 * The most addresses one product keeps. The endpoint has no session, so this
 * bounds what a determined caller can write; a real launch list is far below it.
 */
export const MAX_EMAILS_PER_PRODUCT = 5000;

/** Keep an email left in the dialog. The same address twice keeps the first time. */
export async function recordInterestEmail(slug: InterestSlug, email: string, now = new Date()): Promise<boolean> {
	const redis = await getRedis();
	if (!redis) return false;
	const existing = await redis.hget(emailsKey(slug), email);
	if (!existing && (await redis.hlen(emailsKey(slug))) < MAX_EMAILS_PER_PRODUCT) {
		await redis.hset(emailsKey(slug), { [email]: now.toISOString() });
	}
	return true;
}

export interface ProductInterestRow {
	slug: InterestSlug;
	name: string;
	/** Browsers that clicked, each counted once. */
	people: number;
	/** Every click, repeats included. */
	clicks: number;
	emails: Array<{ email: string; at: string }>;
}

/** Every product's totals, most-wanted first. Null when storage is unavailable. */
export async function readProductInterest(): Promise<ProductInterestRow[] | null> {
	const redis = await getRedis();
	if (!redis) return null;
	const clicks = (await redis.hgetall<number | string>(CLICKS_KEY)) ?? {};
	const rows = await Promise.all(
		INTEREST_ITEMS.map(async (p): Promise<ProductInterestRow> => {
			const [people, emails] = await Promise.all([
				redis.scard(visitorsKey(p.slug)),
				redis.hgetall<string>(emailsKey(p.slug)),
			]);
			return {
				slug: p.slug,
				name: p.name,
				people: Number(people) || 0,
				clicks: Number(clicks[p.slug]) || 0,
				emails: Object.entries(emails ?? {})
					.map(([email, at]) => ({ email, at: String(at) }))
					.sort((a, b) => a.at.localeCompare(b.at)),
			};
		}),
	);
	return rows.sort((a, b) => b.people - a.people || b.clicks - a.clicks);
}
