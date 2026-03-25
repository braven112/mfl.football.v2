/**
 * Suggestion Box — Activity Tracking
 *
 * GET  /api/suggestions/activity — Get new activity since last visit
 * POST /api/suggestions/activity — Mark "last seen" timestamp
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import {
  getLastSeen,
  setLastSeen,
  getIdeasWithActivitySince,
  getAllIdeas,
} from '../../../utils/suggestions-storage';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user?.franchiseId) return json({ error: 'Authentication required' }, 401);

  const lastSeen = await getLastSeen(user.franchiseId);
  if (!lastSeen) {
    // First visit — no new activity
    return json({ newIdeaCount: 0, ideaIdsWithNewActivity: [] });
  }

  const ideaIds = await getIdeasWithActivitySince(lastSeen);
  const ideas = await getAllIdeas();
  const newIdeas = ideas.filter(i =>
    new Date(i.createdAt).getTime() > new Date(lastSeen).getTime() && !i.archived
  );

  return json({
    newIdeaCount: newIdeas.length,
    ideaIdsWithNewActivity: ideaIds,
    lastSeen,
  });
};

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user?.franchiseId) return json({ error: 'Authentication required' }, 401);

  await setLastSeen(user.franchiseId);

  return json({ ok: true });
};
