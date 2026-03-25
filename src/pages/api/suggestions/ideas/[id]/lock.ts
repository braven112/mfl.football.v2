/**
 * Suggestion Box — Toggle Comment Lock (admin only)
 *
 * POST /api/suggestions/ideas/{id}/lock
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../../../../utils/auth';
import { getIdeaById, saveIdea } from '../../../../../utils/suggestions-storage';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ params, request }) => {
  const user = getAuthUser(request);
  if (!user) return json({ error: 'Authentication required' }, 401);
  if (!isCommissionerOrAdmin(user)) return json({ error: 'Admin access required' }, 403);

  const idea = await getIdeaById(params.id!);
  if (!idea) return json({ error: 'Idea not found' }, 404);

  idea.locked = !idea.locked;

  const ok = await saveIdea(idea);
  if (!ok) return json({ error: 'Failed to toggle lock' }, 500);

  return json({ idea });
};
