/**
 * Suggestion Box — Single Comment Edit/Delete
 *
 * PATCH  /api/suggestions/comments/{id} — Edit comment (own or admin)
 * DELETE /api/suggestions/comments/{id} — Soft-delete comment (own or admin)
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../../../../utils/auth';
import type { UpdateCommentRequest } from '../../../../../types/suggestions';
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

/** Find which idea a comment belongs to by scanning all ideas' comment hashes */
async function findCommentAcrossIdeas(commentId: string) {
  const ideas = await getAllIdeas();
  for (const idea of ideas) {
    const comment = await getCommentById(idea.id, commentId);
    if (comment) return { idea, comment };
  }
  return null;
}

export const PATCH: APIRoute = async ({ params, request }) => {
  const user = getAuthUser(request);
  if (!user) return json({ error: 'Authentication required' }, 401);

  const found = await findCommentAcrossIdeas(params.id!);
  if (!found) return json({ error: 'Comment not found' }, 404);

  const { comment } = found;
  const isAdmin = isCommissionerOrAdmin(user);
  const isOwner = comment.author.franchiseId === user.franchiseId;
  if (!isOwner && !isAdmin) {
    return json({ error: 'You can only edit your own comments' }, 403);
  }

  if (comment.deletedAt) {
    return json({ error: 'Cannot edit a deleted comment' }, 400);
  }

  let body: UpdateCommentRequest;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const commentBody = body.body?.trim();
  if (!commentBody || commentBody.length < 1) {
    return json({ error: 'Comment cannot be empty' }, 400);
  }
  if (commentBody.length > 3000) {
    return json({ error: 'Comment must be under 3000 characters' }, 400);
  }

  comment.body = commentBody;
  if (body.imageUrls !== undefined) {
    comment.images = body.imageUrls.map(url => ({ url }));
  }
  comment.editedAt = new Date().toISOString();

  const ok = await saveComment(comment);
  if (!ok) return json({ error: 'Failed to update comment' }, 500);

  return json({ comment });
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const user = getAuthUser(request);
  if (!user) return json({ error: 'Authentication required' }, 401);

  const found = await findCommentAcrossIdeas(params.id!);
  if (!found) return json({ error: 'Comment not found' }, 404);

  const { comment } = found;
  const isAdmin = isCommissionerOrAdmin(user);
  const isOwner = comment.author.franchiseId === user.franchiseId;
  if (!isOwner && !isAdmin) {
    return json({ error: 'You can only delete your own comments' }, 403);
  }

  // Soft delete: preserve thread structure
  comment.body = '[deleted]';
  comment.images = [];
  comment.deletedAt = new Date().toISOString();

  const ok = await saveComment(comment);
  if (!ok) return json({ error: 'Failed to delete comment' }, 500);

  return json({ deleted: true, id: comment.id });
};
