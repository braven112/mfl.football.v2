/**
 * Suggestion Box — Poll Management (admin only)
 *
 * POST   /api/suggestions/ideas/{id}/poll — Create poll
 * DELETE /api/suggestions/ideas/{id}/poll — Remove poll
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../../../../../utils/auth';
import type { CreatePollRequest, Poll, PollOption } from '../../../../../../types/suggestions';
import { getIdeaById, saveIdea, generateId } from '../../../../../../utils/suggestions-storage';

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

  if (idea.poll) {
    return json({ error: 'This idea already has a poll. Remove it first.' }, 400);
  }

  let body: CreatePollRequest;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  if (!body.options || !Array.isArray(body.options) || body.options.length < 2) {
    return json({ error: 'Poll must have at least 2 options' }, 400);
  }
  if (body.options.length > 10) {
    return json({ error: 'Poll can have at most 10 options' }, 400);
  }

  const options: PollOption[] = body.options.map(label => ({
    id: generateId('opt'),
    label: label.trim(),
  }));

  const poll: Poll = {
    id: generateId('poll'),
    options,
    anonymous: body.anonymous ?? false,
    votes: [],
    createdAt: new Date().toISOString(),
  };

  idea.poll = poll;
  idea.lastActivityAt = new Date().toISOString();

  const ok = await saveIdea(idea);
  if (!ok) return json({ error: 'Failed to create poll' }, 500);

  return json({ idea }, 201);
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const user = getAuthUser(request);
  if (!user) return json({ error: 'Authentication required' }, 401);
  if (!isCommissionerOrAdmin(user)) return json({ error: 'Admin access required' }, 403);

  const idea = await getIdeaById(params.id!);
  if (!idea) return json({ error: 'Idea not found' }, 404);

  if (!idea.poll) {
    return json({ error: 'This idea has no poll' }, 400);
  }

  delete idea.poll;

  const ok = await saveIdea(idea);
  if (!ok) return json({ error: 'Failed to remove poll' }, 500);

  return json({ idea });
};
