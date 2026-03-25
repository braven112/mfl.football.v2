/**
 * Suggestion Box — Set Idea Status (admin only)
 *
 * PATCH /api/suggestions/ideas/{id}/status
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../../../../utils/auth';
import type { IdeaStatus, SetIdeaStatusRequest } from '../../../../../types/suggestions';
import { getIdeaById, saveIdea } from '../../../../../utils/suggestions-storage';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const VALID_STATUSES: IdeaStatus[] = ['open', 'under-review', 'approved', 'rejected', 'implemented', 'tabled'];

export const PATCH: APIRoute = async ({ params, request }) => {
  const user = getAuthUser(request);
  if (!user) return json({ error: 'Authentication required' }, 401);
  if (!isCommissionerOrAdmin(user)) return json({ error: 'Admin access required' }, 403);

  const idea = await getIdeaById(params.id!);
  if (!idea) return json({ error: 'Idea not found' }, 404);

  let body: SetIdeaStatusRequest;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  if (!VALID_STATUSES.includes(body.status)) {
    return json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
  }

  idea.status = body.status;
  idea.lastActivityAt = new Date().toISOString();

  const ok = await saveIdea(idea);
  if (!ok) return json({ error: 'Failed to update status' }, 500);

  return json({ idea });
};
