/**
 * The page index behind the header's inline search (HeaderSearch.astro).
 *
 * Fetched once, the first time a visitor opens the search box on a page, so
 * the ~140 KB directory never rides along on pages where nobody searches. The
 * /search page renders the same index server-side through the same builder
 * (src/utils/page-search-index.ts), so the two can never disagree.
 *
 * Only leagues that HAVE a search page answer — getSearchPath is the single
 * source for which those are. Admin-only ("hidden") entries come from the
 * SESSION, never a param; hrefs follow the requesting host's prefix rule the
 * same way the page's own links do (locals.hideLeaguePrefix).
 */
import type { APIRoute } from 'astro';
import { getLeagueBySlug, type CanonicalLeagueSlug } from '../../config/leagues';
import { getSearchPath } from '../../utils/nav-utils';
import { getAuthUser, isCommissionerOrAdmin } from '../../utils/auth';
import { buildPageSearchIndex } from '../../utils/page-search-index';

export const prerender = false;

export const GET: APIRoute = async ({ request, url, locals }) => {
  const slug = url.searchParams.get('league') ?? '';
  const league = getLeagueBySlug(slug);
  if (!league || !getSearchPath(league.slug as CanonicalLeagueSlug)) {
    return new Response(JSON.stringify({ error: 'unknown league' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const user = getAuthUser(request);
  const entries = await buildPageSearchIndex(league.slug as CanonicalLeagueSlug, {
    isAdmin: !!user && isCommissionerOrAdmin(user),
    hideLeaguePrefix: locals.hideLeaguePrefix ?? false,
  });

  // Only what the dropdown draws; tags are already folded into `search`.
  const pages = entries.map(({ title, description, href, icon, admin, search, rank }) => ({
    title, description, href, icon, admin, search, rank,
  }));

  return new Response(JSON.stringify({ pages }), {
    headers: {
      'Content-Type': 'application/json',
      // Per viewer (admins see more), and the ranking moves slowly.
      'Cache-Control': 'private, max-age=60',
    },
  });
};
