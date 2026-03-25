/**
 * Suggestion Box — Idea Reactions
 *
 * POST /api/suggestions/ideas/{id}/reactions — Toggle emoji reaction
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../../../utils/auth';
import type { ToggleReactionRequest } from '../../../../../types/suggestions';
import { getIdeaById, saveIdea } from '../../../../../utils/suggestions-storage';

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

  let body: ToggleReactionRequest;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const emoji = body.emoji?.trim();
  if (!emoji || emoji.length > 8) {
    return json({ error: 'Invalid emoji' }, 400);
  }

  // Toggle: add if not present, remove if already reacted
  if (!idea.reactions) idea.reactions = {};
  const existing = idea.reactions[emoji] ?? [];
  const idx = existing.indexOf(user.franchiseId);

  if (idx >= 0) {
    existing.splice(idx, 1);
    if (existing.length === 0) {
      delete idea.reactions[emoji];
    } else {
      idea.reactions[emoji] = existing;
    }
  } else {
    idea.reactions[emoji] = [...existing, user.franchiseId];
  }

  const ok = await saveIdea(idea);
  if (!ok) return json({ error: 'Failed to save reaction' }, 500);

  return json({ reactions: idea.reactions });
};
