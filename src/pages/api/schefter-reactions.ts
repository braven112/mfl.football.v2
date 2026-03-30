/**
 * Schefter Feed — Reactions API
 *
 * GET  /api/schefter-reactions?postId={id}  — Get reaction counts + user's reaction
 * POST /api/schefter-reactions              — Toggle a reaction (auth required)
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getReactions, toggleReaction, isValidReaction } from '../../utils/schefter-reactions';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const postId = url.searchParams.get('postId');
  if (!postId) return json({ error: 'postId required' }, 400);

  const user = getAuthUser(request);
  const result = await getReactions(postId, user?.franchiseId);
  return json(result);
};

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user?.franchiseId) return json({ error: 'Authentication required' }, 401);

  let body: { postId?: string; reaction?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const { postId, reaction } = body;
  if (!postId || typeof postId !== 'string') {
    return json({ error: 'postId required' }, 400);
  }
  if (!reaction || typeof reaction !== 'string' || !isValidReaction(reaction)) {
    return json({ error: 'Invalid reaction emoji' }, 400);
  }

  const newReaction = await toggleReaction(postId, user.franchiseId, reaction);
  const updated = await getReactions(postId, user.franchiseId);

  return json({
    ...updated,
    userReaction: newReaction,
  });
};
