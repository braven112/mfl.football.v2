import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRODUCTS, FEATURES, findProduct, productsIncluding } from '../src/data/products';
import { PRODUCT_PAGES_PUBLIC, canViewProductPages } from '../src/utils/product-pages-access';

/**
 * The product pages (/products) — src/data/products.ts.
 *
 * Two kinds of check. STRUCTURE: every cross-reference resolves, so a page
 * never links to a product or feature that is not there, and the lineup reads
 * cheapest first (each page builds on the ones before it). LEAKS: the repo is
 * public, so the data must carry only the customer-facing half — the internal
 * half (costs, margins, build status, client names) lives in the business plan
 * doc. The word scan is a tripwire for the obvious slips, not a proof.
 */

const ROOT = process.cwd();
const dataSource = readFileSync(join(ROOT, 'src/data/products.ts'), 'utf8');

describe('product pages — structure', () => {
	it('has unique product slugs and feature ids', () => {
		const slugs = PRODUCTS.map((p) => p.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
		const ids = FEATURES.map((f) => f.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('never names a feature id that collides with a static route', () => {
		expect(findProduct('features')).toBeUndefined();
	});

	it('resolves every buildsOn product and every included feature', () => {
		const slugs = new Set(PRODUCTS.map((p) => p.slug));
		const ids = new Set(FEATURES.map((f) => f.id));
		for (const product of PRODUCTS) {
			for (const ref of product.buildsOn ?? []) expect(slugs, `${product.slug} → ${ref}`).toContain(ref);
			for (const ref of product.features ?? []) expect(ids, `${product.slug} → ${ref}`).toContain(ref);
		}
	});

	it('only builds on products that come EARLIER in the lineup', () => {
		PRODUCTS.forEach((product, i) => {
			for (const ref of product.buildsOn ?? []) {
				const j = PRODUCTS.findIndex((p) => p.slug === ref);
				expect(j, `${product.slug} builds on ${ref}, which comes after it`).toBeLessThan(i);
			}
		});
	});

	it('includes every catalog feature in at least one product', () => {
		for (const feature of FEATURES) {
			expect(productsIncluding(feature.id).length, feature.id).toBeGreaterThan(0);
		}
	});

	it('gives every tier row one value per column', () => {
		for (const product of PRODUCTS) {
			if (!product.tiers) continue;
			for (const row of product.tiers.rows) {
				expect(row.values.length, `${product.slug}: ${row.label}`).toBe(product.tiers.columns.length);
			}
		}
	});
});

describe('product pages — public repo, customer-facing copy only', () => {
	// Internal-only words: business plan material, third-party data sources
	// and trademarks the paid products must not lean on, and the reporter's
	// current real-person name.
	const FORBIDDEN = [
		/\bmargin\b/i,
		/\bour cost\b/i,
		/\bcost to us\b/i,
		/\binternal\b/i,
		/\bArchie\b/,
		/\bESPN\b/,
		/\bSchefter\b/,
		/\bSunday Ticket\b/,
		/\bNFL\.com\b/,
		/\bGemini\b/,
	];

	it.each(FORBIDDEN.map((re) => [re.source, re]))('the product data never says %s', (_label, re) => {
		expect(dataSource).not.toMatch(re as RegExp);
	});
});

describe('product pages — access', () => {
	it('stays gated until launch', () => {
		// Flipping this is the launch. When you do, also add page-directory
		// entries for /products and each product page, then update this test.
		expect(PRODUCT_PAGES_PUBLIC).toBe(false);
	});

	it('refuses a signed-out visitor and an ordinary owner while gated', () => {
		expect(canViewProductPages(null)).toBe(false);
		expect(
			canViewProductPages({ leagueId: '00000', franchiseId: '0005', role: 'owner' } as never),
		).toBe(false);
	});
});
