/**
 * /sitemap.xml on the shared host. Listed in public/robots.txt.
 * Entries: src/utils/sitemap.ts.
 */
import type { APIRoute } from 'astro';
import { renderSitemap, sharedHostSitemapEntries } from '../utils/sitemap';

export const prerender = false;

export const GET: APIRoute = () =>
	new Response(renderSitemap(sharedHostSitemapEntries()), {
		headers: {
			'Content-Type': 'application/xml; charset=utf-8',
			'Cache-Control': 'public, max-age=3600, s-maxage=86400',
		},
	});
