/**
 * /api/owner-links — link an owner's former teams to their career.
 *
 * GET  → { links, canReview } for the session's league. A commissioner sees
 *        every link; an owner sees the ones they filed or that name them.
 * POST { franchiseId, yearStart, yearEnd, targetOwnerId?, note? }
 *      → { link }. An owner's link is PENDING until the commissioner approves
 *        it; a commissioner's is approved, and live, on the spot.
 *
 * The league is the SESSION's (owner-link-actions.ts#leagueForSession), never a
 * parameter. Writes are rate-limited per league + franchise.
 */
import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { checkRateLimit } from '../../../utils/rate-limit';
import { OwnerLinkStoreUnavailable, listOwnerLinks } from '../../../utils/owner-link-store';
import { invalidateOwnerLinks, leagueLatestYear, loadLiveOwnerTenures } from '../../../utils/owner-link-live';
import {
  canReviewOwnerLinks,
  fileOwnerLink,
  leagueForSession,
  ownersForFranchise,
  visibleLinks,
} from '../../../utils/owner-link-actions';

export const prerender = false;

const MAX_PER_HOUR = 30;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) return json({ error: 'Sign in to link teams.' }, 401);
  const league = await leagueForSession(user);
  if (!league) return json({ error: 'Owner links are not available in this league.' }, 404);
  const reviewer = canReviewOwnerLinks(user, league);
  const [links, data] = await Promise.all([listOwnerLinks(league.slug), loadLiveOwnerTenures(league.slug)]);
  const mine = ownersForFranchise(data, user.franchiseId);
  return json({ league: league.slug, canReview: reviewer, links: visibleLinks(links, user, mine, reviewer) });
};

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) return json({ error: 'Sign in to link teams.' }, 401);
  const league = await leagueForSession(user);
  if (!league) return json({ error: 'Owner links are not available in this league.' }, 404);

  const limit = await checkRateLimit('owner-links', `${league.slug}:${user.franchiseId || user.id}`, MAX_PER_HOUR, 3600);
  if (!limit.allowed) return json({ error: 'Too many requests — try again in a bit.' }, 429);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Bad request.' }, 400);
  }

  const [data, existing, latestYear] = await Promise.all([
    loadLiveOwnerTenures(league.slug),
    listOwnerLinks(league.slug),
    leagueLatestYear(league.slug),
  ]);
  if (!data) return json({ error: 'Owner history is not available.' }, 503);

  try {
    const result = await fileOwnerLink({ user, league, data, latestYear, existing, body });
    if (!result.ok) return json({ error: result.error }, result.status);
    invalidateOwnerLinks(league.slug);
    return json({ link: result.link }, 201);
  } catch (e) {
    if (e instanceof OwnerLinkStoreUnavailable) return json({ error: e.message }, 503);
    throw e;
  }
};
