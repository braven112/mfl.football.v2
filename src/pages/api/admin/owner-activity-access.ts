/**
 * GET/PUT /api/admin/owner-activity-access?league=<slug>
 *
 * The switch that opens a league's Owner Activity report to its commissioner
 * (src/utils/owner-activity-access.ts). PLATFORM ADMINS ONLY: the report is
 * theirs by default, and whether a commissioner sees it is the admin's call,
 * never the commissioner's own.
 *
 * PUT body: `{ "commissionerAccess": true | false }`.
 */
import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { isPlatformAdmin } from '../../../utils/league-admin';
import { getLeagueBySlug, type LeagueDefinition } from '../../../config/leagues';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { getCommissionerAccess, setCommissionerAccess } from '../../../utils/owner-activity-access';

export const prerender = false;

type Gate = { ok: true; league: LeagueDefinition } | { ok: false; response: Response };

function gate(request: Request, url: URL): Gate {
  const user = getAuthUser(request);
  if (!user) return { ok: false, response: json({ ok: false, error: 'Sign in required.' }, 401, JSON_HEADERS_NO_STORE) };
  if (!isPlatformAdmin(user)) {
    return { ok: false, response: json({ ok: false, error: 'Site admins only.' }, 403, JSON_HEADERS_NO_STORE) };
  }
  const league = getLeagueBySlug(url.searchParams.get('league') ?? '');
  if (!league) return { ok: false, response: json({ ok: false, error: 'Unknown league.' }, 400, JSON_HEADERS_NO_STORE) };
  return { ok: true, league };
}

export const GET: APIRoute = async ({ request, url }) => {
  const g = gate(request, url);
  if (!g.ok) return g.response;
  const commissionerAccess = await getCommissionerAccess(g.league.slug);
  return json({ ok: true, league: g.league.slug, commissionerAccess }, 200, JSON_HEADERS_NO_STORE);
};

export const PUT: APIRoute = async ({ request, url }) => {
  const g = gate(request, url);
  if (!g.ok) return g.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Body must be JSON.' }, 400, JSON_HEADERS_NO_STORE);
  }
  const value = (body as { commissionerAccess?: unknown } | null)?.commissionerAccess;
  if (typeof value !== 'boolean') {
    return json({ ok: false, error: 'commissionerAccess must be true or false.' }, 400, JSON_HEADERS_NO_STORE);
  }

  try {
    await setCommissionerAccess(g.league.slug, value);
  } catch {
    return json({ ok: false, error: 'Could not save — try again.' }, 503, JSON_HEADERS_NO_STORE);
  }
  return json({ ok: true, league: g.league.slug, commissionerAccess: value }, 200, JSON_HEADERS_NO_STORE);
};
