import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SERVICES, COMPARISON, FORMER_BRAND } from '../src/data/mfl-services';
import {
	canonicalUrl,
	faqJsonLd,
	jsonLdScript,
	organizationJsonLd,
	serviceJsonLd,
} from '../src/utils/structured-data';
import { renderSitemap, sharedHostSitemapEntries } from '../src/utils/sitemap';

/**
 * The shared host's search and AI-search surface: service pages, sitemap,
 * robots.txt, llms.txt and JSON-LD. These pages exist to be found, so the
 * failure mode is silent: a service missing from the sitemap or llms.txt, a
 * canonical that names the wrong host, or a description long enough that
 * search engines cut it mid-sentence.
 */
const root = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

describe('service pages', () => {
	it('every service has a route file that renders it', () => {
		for (const s of SERVICES) {
			const file = `src/pages${s.path}.astro`;
			expect(existsSync(path.join(root, file)), file).toBe(true);
			expect(read(file)).toContain(`findService('${s.slug}')`);
		}
	});

	it('every service opens with an answer naming MFL and the former brand', () => {
		for (const s of SERVICES) {
			expect(s.answer, s.slug).toMatch(/MyFantasyLeague/);
			expect(s.answer, s.slug).toContain(`formerly ${FORMER_BRAND}`);
		}
	});

	it('titles and descriptions fit what search results show', () => {
		for (const s of SERVICES) {
			expect(s.description.length, s.slug).toBeLessThanOrEqual(160);
			expect(s.title.length, s.slug).toBeLessThanOrEqual(80);
			expect(s.h1.toLowerCase(), s.slug).toContain('mfl');
		}
	});

	it('every service has questions with standalone answers', () => {
		for (const s of SERVICES) {
			expect(s.faqs.length, s.slug).toBeGreaterThanOrEqual(4);
			for (const f of s.faqs) expect(f.a.length, f.q).toBeGreaterThan(20);
		}
	});

	it('comparison rows have one value per column', () => {
		for (const row of COMPARISON.rows) expect(row.values.length, row.label).toBe(COMPARISON.columns.length);
	});
});

describe('sitemap', () => {
	const xml = renderSitemap(sharedHostSitemapEntries());

	it('lists every service page on the canonical origin', () => {
		for (const s of SERVICES) expect(xml).toContain(`<loc>${canonicalUrl(s.path)}</loc>`);
	});

	it('lists no gated or league-prefixed page', () => {
		expect(xml).not.toMatch(/<loc>[^<]*\/(products|history|theleague|afl-fantasy|admin)/);
	});

	it('is referenced from robots.txt', () => {
		expect(read('public/robots.txt')).toMatch(/^Sitemap: https:\/\/mfl\.football\/sitemap\.xml$/m);
	});
});

describe('robots.txt', () => {
	const robots = read('public/robots.txt');

	it('names the AI search bots in a group with no crawl delay', () => {
		const group = robots.slice(robots.indexOf('User-agent: OAI-SearchBot'), robots.indexOf('User-agent: GPTBot'));
		for (const bot of ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'Perplexity-User']) {
			expect(group).toContain(`User-agent: ${bot}`);
		}
		expect(group).not.toMatch(/Crawl-delay/);
		// Every group repeats the full rule set (see the file's header).
		expect(group).toContain('Disallow: /api/');
	});
});

describe('llms.txt', () => {
	const llms = read('public/llms.txt');

	it('describes the brand, including the former name', () => {
		expect(llms).toContain(`formerly ${FORMER_BRAND}`);
	});

	it('links every service page', () => {
		for (const s of SERVICES) expect(llms).toContain(canonicalUrl(s.path));
	});
});

describe('structured data', () => {
	it('the organization carries the former brand as an alternate name', () => {
		const org = organizationJsonLd();
		expect(org.alternateName).toContain(FORMER_BRAND);
		expect(org.url).toBe(canonicalUrl('/'));
	});

	it('a service links back to the organization', () => {
		const ld = serviceJsonLd(SERVICES[0]);
		expect(ld.provider).toEqual({ '@id': (organizationJsonLd() as { '@id': string })['@id'] });
	});

	it('serialization cannot close the script element', () => {
		const out = jsonLdScript(faqJsonLd([{ q: 'x', a: '</script><b>' }]));
		expect(out).not.toContain('</script>');
		expect(JSON.parse(out).mainEntity[0].acceptedAnswer.text).toBe('</script><b>');
	});
});
