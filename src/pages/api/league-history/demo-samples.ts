/**
 * GET /api/league-history/demo-samples?league=<public demo league>
 * → `{ samples: DemoSample[] }` | `{ pending: true }` | `{ unavailable: true }`
 *
 * The real, owner-masked sample answers the /ask-the-history product page
 * shows under its live ask box (utils/league-history/demo-samples.ts). Read
 * from a week-long cache; only the first request after it expires spends
 * model tokens, and a lock keeps that to one. `pending` tells the page to
 * look again in a few seconds.
 */
import type { APIRoute } from 'astro';
import { demoSamples } from '../../../utils/league-history/demo-samples';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
	const result = await demoSamples(url.searchParams.get('league') ?? '');
	const cache = 'samples' in result ? 'public, max-age=300, s-maxage=3600' : 'no-store';
	return new Response(JSON.stringify(result), {
		status: 200,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': cache },
	});
};
