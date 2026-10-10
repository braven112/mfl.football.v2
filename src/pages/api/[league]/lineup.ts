/**
 * Lineup API for package leagues — `/api/<slug>/lineup`, one file for every
 * league built from the package-league kit (Archie's, Launcher leagues).
 *
 * Still pinned per ROUTE PATH, as createLineupRoute requires: the slug comes
 * from the URL, never from the session, so a post to /api/archies/lineup can
 * only ever write into Archie's league. Only package leagues are served here —
 * TheLeague, the AFL and the demo's keeper slot have their own static routes,
 * which Astro matches before this one — and any other slug is a 404.
 */
import type { APIRoute } from 'astro';
import { createLineupRoute } from '../../../utils/lineup-route';
import { getLeagueBySlug, type CanonicalLeagueSlug } from '../../../config/leagues';
import { isPackageLeague } from '../../../config/package-league-routes.mjs';

export const prerender = false;

const routes = new Map<string, ReturnType<typeof createLineupRoute>>();
function route(slug: string | undefined) {
  const league = slug ? getLeagueBySlug(slug) : null;
  if (!league || !isPackageLeague(league)) return null;
  let r = routes.get(league.slug);
  if (!r) {
    r = createLineupRoute(league.slug as CanonicalLeagueSlug);
    routes.set(league.slug, r);
  }
  return r;
}
const notFound = () => new Response(null, { status: 404 });

export const GET: APIRoute = (context) => route(context.params.league)?.GET(context) ?? notFound();
export const POST: APIRoute = (context) => route(context.params.league)?.POST(context) ?? notFound();
