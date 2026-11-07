/**
 * GET /addons.md — the MFL Add-ons landing page as markdown, for AI tools and
 * crawlers. Written from the same data as the page (src/data/addons-page.ts),
 * and linked from it with <link rel="alternate" type="text/markdown">.
 */
import type { APIRoute } from 'astro';
import { addonsMarkdown } from '../data/addons-page';

export const prerender = true;

export const GET: APIRoute = () =>
	new Response(addonsMarkdown(), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
