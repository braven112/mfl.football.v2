/**
 * POST /api/owner-links/decide — { id, decision: 'approved' | 'rejected', note? }
 *
 * The commissioner's review queue. Approving makes a pending link live on the
 * next request; rejecting an approved link takes it back off the site. Gated by
 * isCommissionerOrAdminForLeague against the SESSION's league — a TheLeague
 * commissioner cannot decide an AFL link, because the AFL's hash is never the
 * one this session's league resolves to.
 */
import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { checkRateLimit } from '../../../utils/rate-limit';
import { OwnerLinkStoreUnavailable, decideOwnerLink } from '../../../utils/owner-link-store';
import { invalidateOwnerLinks } from '../../../utils/owner-link-live';
import { actorOf, canReviewOwnerLinks, leagueForSession } from '../../../utils/owner-link-actions';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const REASONS = {
  'not-found': [404, 'That link no longer exists.'],
  unchanged: [409, 'That link is already in that state.'],
  'not-allowed': [409, 'A declined request is closed — the owner can file a new one.'],
} as const;

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) return json({ error: 'Sign in first.' }, 401);
  const league = leagueForSession(user);
  if (!league || !canReviewOwnerLinks(user, league)) return json({ error: 'Commissioners only.' }, 403);

  const limit = await checkRateLimit('owner-links-decide', `${league.slug}:${user.id}`, 120, 3600);
  if (!limit.allowed) return json({ error: 'Too many requests — try again in a bit.' }, 429);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Bad request.' }, 400);
  }
  const id = typeof body.id === 'string' ? body.id : '';
  const decision = body.decision === 'approved' || body.decision === 'rejected' ? body.decision : null;
  if (!id || !decision) return json({ error: 'Bad request.' }, 400);
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 280) || null : null;

  try {
    const result = await decideOwnerLink(league.slug, id, decision, actorOf(user), note);
    if (!result.ok) {
      const [status, error] = REASONS[result.reason];
      return json({ error }, status);
    }
    invalidateOwnerLinks(league.slug);
    return json({ link: result.link });
  } catch (e) {
    if (e instanceof OwnerLinkStoreUnavailable) return json({ error: e.message }, 503);
    throw e;
  }
};
