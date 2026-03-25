/**
 * Suggestion Box — Cast/Change Poll Vote
 *
 * POST /api/suggestions/ideas/{id}/poll/vote
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../../../../utils/auth';
import type { CastVoteRequest } from '../../../../../../types/suggestions';
import { getIdeaById, saveIdea } from '../../../../../../utils/suggestions-storage';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ params, request }) => {
  const user = getAuthUser(request);
  if (!user?.franchiseId) return json({ error: 'Authentication required' }, 401);

  const idea = await getIdeaById(params.id!);
  if (!idea) return json({ error: 'Idea not found' }, 404);

  if (!idea.poll) {
    return json({ error: 'This idea has no poll' }, 400);
  }

  if (idea.poll.closedAt) {
    return json({ error: 'This poll is closed' }, 400);
  }

  let body: CastVoteRequest;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const optionId = body.optionId?.trim();
  if (!optionId || !idea.poll.options.some(o => o.id === optionId)) {
    return json({ error: 'Invalid option' }, 400);
  }

  // Remove existing vote from this user (if changing vote)
  idea.poll.votes = idea.poll.votes.filter(v => v.franchiseId !== user.franchiseId);

  // Add new vote
  idea.poll.votes.push({
    franchiseId: user.franchiseId,
    optionId,
    votedAt: new Date().toISOString(),
  });

  const ok = await saveIdea(idea);
  if (!ok) return json({ error: 'Failed to cast vote' }, 500);

  return json({ poll: idea.poll });
};
