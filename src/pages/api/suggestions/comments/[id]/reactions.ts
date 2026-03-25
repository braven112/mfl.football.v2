/**
 * Suggestion Box — Comment Reactions
 *
 * POST /api/suggestions/comments/{id}/reactions — Toggle emoji reaction
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../../../utils/auth';
import type { ToggleReactionRequest } from '../../../../../types/suggestions';
import {
  getAllIdeas,
  getCommentById,
  saveComment,
} from '../../../../../utils/suggestions-storage';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Find which idea a comment belongs to */
async function findCommentAcrossIdeas(commentId: string) {
  const ideas = await getAllIdeas();
  for (const idea of ideas) {
    const comment = await getCommentById(idea.id, commentId);
    if (comment) return comment;
  }
  return null;
}

export const POST: APIRoute = async ({ params, request }) => {
  const user = getAuthUser(request);
  if (!user?.franchiseId) return json({ error: 'Authentication required' }, 401);

  const comment = await findCommentAcrossIdeas(params.id!);
  if (!comment) return json({ error: 'Comment not found' }, 404);

  if (comment.deletedAt) {
    return json({ error: 'Cannot react to a deleted comment' }, 400);
  }

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

  // Toggle
  if (!comment.reactions) comment.reactions = {};
  const existing = comment.reactions[emoji] ?? [];
  const idx = existing.indexOf(user.franchiseId);

  if (idx >= 0) {
    existing.splice(idx, 1);
    if (existing.length === 0) {
      delete comment.reactions[emoji];
    } else {
      comment.reactions[emoji] = existing;
    }
  } else {
    comment.reactions[emoji] = [...existing, user.franchiseId];
  }

  const ok = await saveComment(comment);
  if (!ok) return json({ error: 'Failed to save reaction' }, 500);

  return json({ reactions: comment.reactions });
};
