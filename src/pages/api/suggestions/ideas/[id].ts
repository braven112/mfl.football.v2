/**
 * Suggestion Box — Single Idea CRUD
 *
 * GET    /api/suggestions/ideas/{id} — Get idea with all comments
 * PATCH  /api/suggestions/ideas/{id} — Edit idea (own or admin)
 * DELETE /api/suggestions/ideas/{id} — Delete idea (own or admin)
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../../../utils/auth';
import type { UpdateIdeaRequest } from '../../../../types/suggestions';
import {
  getIdeaById,
  saveIdea,
  deleteIdea,
  getCommentsForIdea,
} from '../../../../utils/suggestions-storage';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ params, request }) => {
  const user = getAuthUser(request);
  if (!user) return json({ error: 'Authentication required' }, 401);

  const idea = await getIdeaById(params.id!);
  if (!idea) return json({ error: 'Idea not found' }, 404);

  const comments = await getCommentsForIdea(idea.id);

  return json({ idea, comments });
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const user = getAuthUser(request);
  if (!user) return json({ error: 'Authentication required' }, 401);

  const idea = await getIdeaById(params.id!);
  if (!idea) return json({ error: 'Idea not found' }, 404);

  const isAdmin = isCommissionerOrAdmin(user);
  const isOwner = idea.author.franchiseId === user.franchiseId;
  if (!isOwner && !isAdmin) {
    return json({ error: 'You can only edit your own ideas' }, 403);
  }

  let body: UpdateIdeaRequest;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  if (body.title !== undefined) {
    const title = body.title.trim();
    if (title.length < 5 || title.length > 200) {
      return json({ error: 'Title must be 5-200 characters' }, 400);
    }
    idea.title = title;
  }

  if (body.body !== undefined) {
    const bodyText = body.body.trim();
    if (bodyText.length < 10 || bodyText.length > 5000) {
      return json({ error: 'Description must be 10-5000 characters' }, 400);
    }
    idea.body = bodyText;
  }

  if (body.imageUrls !== undefined) {
    idea.images = body.imageUrls.map(url => ({ url }));
  }

  idea.editedAt = new Date().toISOString();

  const ok = await saveIdea(idea);
  if (!ok) return json({ error: 'Failed to update idea' }, 500);

  return json({ idea });
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const user = getAuthUser(request);
  if (!user) return json({ error: 'Authentication required' }, 401);

  const idea = await getIdeaById(params.id!);
  if (!idea) return json({ error: 'Idea not found' }, 404);

  const isAdmin = isCommissionerOrAdmin(user);
  const isOwner = idea.author.franchiseId === user.franchiseId;
  if (!isOwner && !isAdmin) {
    return json({ error: 'You can only delete your own ideas' }, 403);
  }

  const ok = await deleteIdea(idea.id);
  if (!ok) return json({ error: 'Failed to delete idea' }, 500);

  return json({ deleted: true, id: idea.id });
};
