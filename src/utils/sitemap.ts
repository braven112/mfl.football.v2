/**
 * The shared host's sitemap: every public, indexable page on mfl.football.
 *
 * A league's pages live on its own apex (theleague.us, afl-fantasy.com), so
 * they belong in that host's sitemap, never this one. Pages behind a sign-in
 * gate (/products, /history) stay out until they open, or the sitemap would
 * hand a crawler a login redirect.
 */
import { SERVICES } from '../data/mfl-services';
import { canonicalUrl } from './structured-data';

export interface SitemapEntry {
	path: string;
	changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly';
	priority: number;
}

export function sharedHostSitemapEntries(): SitemapEntry[] {
	return [
		{ path: '/', changefreq: 'weekly', priority: 1 },
		...SERVICES.map((s) => ({ path: s.path, changefreq: 'monthly' as const, priority: 0.9 })),
		{ path: '/mfl-all-play-standings', changefreq: 'monthly', priority: 0.8 },
		{ path: '/fantasy-football-logo-maker', changefreq: 'monthly', priority: 0.8 },
		{ path: '/compare', changefreq: 'monthly', priority: 0.7 },
		{ path: '/about', changefreq: 'monthly', priority: 0.7 },
		{ path: '/live', changefreq: 'weekly', priority: 0.8 },
		{ path: '/instructions', changefreq: 'monthly', priority: 0.6 },
		{ path: '/privacy', changefreq: 'yearly', priority: 0.2 },
	];
}

export function renderSitemap(entries: SitemapEntry[]): string {
	const urls = entries
		.map(
			(e) =>
				`  <url>\n    <loc>${canonicalUrl(e.path)}</loc>\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority.toFixed(1)}</priority>\n  </url>`,
		)
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
