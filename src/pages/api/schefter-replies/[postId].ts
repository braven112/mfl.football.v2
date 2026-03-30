/**
 * Schefter Feed — Replies API
 *
 * GET  /api/schefter-replies/{postId}  — Get all replies for a post
 * POST /api/schefter-replies/{postId}  — Create a reply (auth required)
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import type { SchefterReply, CreateReplyRequest } from '../../../types/schefter-replies';
import {
  getRepliesForPost,
  saveReply,
  generateReplyId,
  checkReplyRateLimit,
  resolveTeamInfo,
} from '../../../utils/schefter-replies-storage';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ params }) => {
  const postId = params.postId;
  if (!postId) return json({ error: 'postId required' }, 400);

  const replies = await getRepliesForPost(postId);
  return json({ replies });
};

export const POST: APIRoute = async ({ params, request }) => {
  const user = getAuthUser(request);
  if (!user?.franchiseId) return json({ error: 'Authentication required' }, 401);

  const postId = params.postId;
  if (!postId) return json({ error: 'postId required' }, 400);

  let body: CreateReplyRequest;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const replyBody = body.body?.trim() ?? '';
  if (!replyBody) return json({ error: 'Reply cannot be empty' }, 400);
  if (replyBody.length > 500) return json({ error: 'Reply must be under 500 characters' }, 400);

  const { allowed } = await checkReplyRateLimit(user.franchiseId);
  if (!allowed) {
    return json({ error: 'Slow down — you\'re limited to 10 replies per hour.' }, 429);
  }

  const teamInfo = await resolveTeamInfo(user.franchiseId);

  const reply: SchefterReply = {
    id: generateReplyId(),
    postId,
    parentId: body.parentId ?? null,
    body: replyBody,
    author: {
      type: 'owner',
      franchiseId: user.franchiseId,
      name: teamInfo.name,
      avatar: teamInfo.icon,
    },
    createdAt: new Date().toISOString(),
  };

  const saved = await saveReply(reply);
  if (!saved) return json({ error: 'Failed to save reply' }, 500);

  return json({ reply }, 201);
};
