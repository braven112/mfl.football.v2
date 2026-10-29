import { describe, it, expect } from 'vitest';
import { prefersMarkdown } from '../src/utils/markdown-negotiation';
import { APPS, EXTRAS, PRODUCTS, addonsMarkdown } from '../src/data/addons-page';
import { isInterestProduct } from '../src/utils/product-interest';

/**
 * The /addons landing page and its markdown copy for AI tools. The markdown is
 * written from the page's own data, so it must list every card the page shows,
 * and only a request that asks for markdown may get it (never a browser).
 */
describe('/addons', () => {
	it('lists every card in the markdown copy', () => {
		const md = addonsMarkdown();
		for (const door of [...EXTRAS, ...APPS, ...PRODUCTS]) expect(md).toContain(door.name);
		expect(md).toContain('https://mfl.football/live/team-logo');
	});

	it('only uses interest slugs the endpoint accepts', () => {
		for (const door of [...EXTRAS, ...APPS, ...PRODUCTS]) expect(isInterestProduct(door.slug)).toBe(true);
	});

	it('answers markdown only when markdown is asked for', () => {
		expect(prefersMarkdown('text/markdown')).toBe(true);
		expect(prefersMarkdown('text/markdown, text/html;q=0.9')).toBe(true);
		expect(prefersMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')).toBe(false);
		expect(prefersMarkdown('text/html, text/markdown;q=0.5')).toBe(false);
		expect(prefersMarkdown('text/markdown;q=0')).toBe(false);
		expect(prefersMarkdown(null)).toBe(false);
	});
});
