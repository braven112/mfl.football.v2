/**
 * Lineup API for the custom-site demo's keeper league — the same shared
 * implementation as the AFL's (src/utils/lineup-route.ts), pinned to the
 * keeper slot. Built lazily: the slot is registered only on a demo
 * deployment, and createLineupRoute throws for a league it cannot find.
 */
import type { APIRoute } from 'astro';
import { createLineupRoute } from '../../../utils/lineup-route';
import { keeperLeague } from '../../../utils/keeper-slot';

export const prerender = false;

let routes: ReturnType<typeof createLineupRoute> | null = null;
const route = () => (keeperLeague() ? (routes ??= createLineupRoute('keeper')) : null);
const notFound = () => new Response(null, { status: 404 });

export const GET: APIRoute = (context) => route()?.GET(context) ?? notFound();
export const POST: APIRoute = (context) => route()?.POST(context) ?? notFound();
