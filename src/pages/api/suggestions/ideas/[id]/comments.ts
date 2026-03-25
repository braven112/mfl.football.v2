/**
 * Suggestion Box — Comments on an Idea
 *
 * POST /api/suggestions/ideas/{id}/comments — Create a comment
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../../../utils/auth';
import type { Comment, CreateCommentRequest } from '../../../../../types/suggestions';
import {
  getIdeaById,
  saveIdea,
  saveComment,
  getCommentById,
  generateId,
  checkRateLimit,
  resolveTeamName,
} from '../../../../../utils/suggestions-storage';

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

  if (idea.locked) {
    return json({ error: 'Comments are locked on this idea' }, 403);
  }

  let body: CreateCommentRequest;
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

  // Validate parentId if provided
  if (body.parentId) {
    const parent = await getCommentById(idea.id, body.parentId);
    if (!parent) {
      return json({ error: 'Parent comment not found' }, 400);
    }
  }

  // Rate limit
  const { allowed } = await checkRateLimit(user.franchiseId);
  if (!allowed) {
    return json({ error: 'Slow down — you\'re limited to 10 posts per hour.' }, 429);
  }

  const teamName = await resolveTeamName(user.franchiseId);
  const now = new Date().toISOString();

  const comment: Comment = {
    id: generateId('cmt'),
    ideaId: idea.id,
    parentId: body.parentId ?? null,
    body: commentBody,
    author: { franchiseId: user.franchiseId, teamName },
    images: (body.imageUrls ?? []).map(url => ({ url })),
    reactions: {},
    createdAt: now,
  };

  const ok = await saveComment(comment);
  if (!ok) return json({ error: 'Failed to save comment' }, 500);

  // Update idea's comment count and last activity
  idea.commentCount = (idea.commentCount || 0) + 1;
  idea.lastActivityAt = now;
  await saveIdea(idea);

  return json({ comment }, 201);
};
