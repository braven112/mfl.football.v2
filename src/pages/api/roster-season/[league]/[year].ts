/**
 * GET /api/roster-season/{league}/{year}
 *
 * Serves one frozen historical season payload for the rosters page.
 *
 * Why this exists: the rosters page used to inline EVERY season into
 * `#roster-config` — 20 seasons x 16 teams = 320 team-seasons, 8.2 MB — so that
 * the season picker could switch instantly. Nobody looks at 320 rosters; they
 * look at one. The current season(s) stay inline (they must be fresh, and
 * switching between the 16 current teams is the common action, which stays
 * synchronous and instant). Everything older is frozen by definition and comes
 * from here instead, on demand, with an idle-time prefetch warming the cache
 * after first paint so the picker still feels instant in practice.
 *
 * "Frozen" is the load-bearing word. This route serves ONLY seasons present in
 * the derived payload file, which `scripts/compute-roster-season-payloads.mjs`
 * regenerates and which by construction excludes any season still being played.
 * Current seasons are built live in the page frontmatter from the MFL feeds and
 * are never served from here — a stale derived entry for a live season would be
 * wrong, and the page overwrites those inline for exactly that reason.
 *
 * Public, like the page: an anonymous request to /theleague/rosters already
 * returns this same data, so there is nothing here to gate.
 */

import type { APIRoute } from 'astro';
import { getLeagueBySlug } from '../../../../config/leagues';

export const prerender = false;

/**
 * Registry-driven, not hardcoded: adding a league's derived payloads is a
 * data-only change (drop the file in, the glob picks it up). Eager because the
 * payloads are static JSON and Vite would otherwise re-resolve per request.
 */
const derivedModules = import.meta.glob<{ default: unknown }>(
  '../../../../../data/*/derived/roster-season-payloads.json',
  { eager: true },
);

/** `.../data/<slug>/derived/roster-season-payloads.json` -> `<slug>` */
function slugFromPath(path: string): string | null {
  return path.match(/\/data\/([^/]+)\/derived\//)?.[1] ?? null;
}

type SeasonPayload = Record<string, unknown>;

const seasonsByLeague: Record<string, Record<string, SeasonPayload>> = {};
for (const [path, mod] of Object.entries(derivedModules)) {
  const slug = slugFromPath(path);
  if (!slug) continue;
  const data = (mod as { default?: { seasons?: Record<string, SeasonPayload> } })?.default;
  if (data?.seasons) seasonsByLeague[slug] = data.seasons;
}

function json(data: unknown, status: number, cache: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cache },
  });
}

// A frozen season cannot change between deploys; the only thing that rewrites
// one is a regeneration of the derived file, which ships as a new deploy.
const CACHE_HIT = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';
const CACHE_MISS = 'no-store';

export const GET: APIRoute = async ({ params }) => {
  const { league, year } = params;

  if (!league || !getLeagueBySlug(league)) {
    return json({ error: 'Unknown league' }, 404, CACHE_MISS);
  }
  // Reject anything that isn't a plain 4-digit year before it reaches a lookup.
  if (!year || !/^\d{4}$/.test(year)) {
    return json({ error: 'Invalid season' }, 400, CACHE_MISS);
  }

  const seasons = seasonsByLeague[league];
  const payload = seasons?.[year];
  if (!payload) {
    // Either the league has no derived payloads or the season is one the page
    // builds live. Both are "not served from here", and neither is cacheable.
    return json({ error: 'Season not available' }, 404, CACHE_MISS);
  }

  return json({ season: year, payload }, 200, CACHE_HIT);
};
