/**
 * Schefter Feed — Reactions API
 *
 * GET  /api/schefter-reactions?postId={id}[&anonymous=1]  — Get reaction counts + user's reaction
 * POST /api/schefter-reactions                            — Toggle a reaction (auth required)
 *
 * Anonymous mode (rumor_mill posts): reactions are keyed on hashedOwnerId, not
 * franchiseId, and stored in a separate `schefter:reactions:anon:` namespace.
 * Responses only ever expose counts + the caller's own reaction — never the
 * identity of any other reactor.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { hashTipsterId } from '../../utils/schefter-tipster-hash';
import {
  getReactions,
  toggleReaction,
  isValidReaction,
  getAnonymousReactions,
  toggleAnonymousReaction,
  isValidRumorReactionEmoji,
} from '../../utils/schefter-reactions';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function safeHash(userId: string): string | null {
  try {
    return hashTipsterId(userId);
  } catch {
    return null;
  }
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const postId = url.searchParams.get('postId');
  if (!postId) return json({ error: 'postId required' }, 400);

  const isAnonymous = url.searchParams.get('anonymous') === '1';
  const user = getAuthUser(request);

  if (isAnonymous) {
    const hashedOwnerId = user?.id ? safeHash(user.id) ?? undefined : undefined;
    const result = await getAnonymousReactions(postId, hashedOwnerId);
    return json(result);
  }

  const result = await getReactions(postId, user?.franchiseId);
  return json(result);
};

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user?.franchiseId) return json({ error: 'Authentication required' }, 401);

  let body: { postId?: string; reaction?: string; anonymous?: boolean };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const { postId, reaction, anonymous } = body;
  if (!postId || typeof postId !== 'string') {
    return json({ error: 'postId required' }, 400);
  }

  if (anonymous === true) {
    if (!reaction || typeof reaction !== 'string' || !isValidRumorReactionEmoji(reaction)) {
      return json({ error: 'Invalid reaction emoji' }, 400);
    }
    const hashedOwnerId = safeHash(user.id);
    if (!hashedOwnerId) return json({ error: 'server_misconfigured' }, 500);

    const newReaction = await toggleAnonymousReaction(postId, hashedOwnerId, reaction);
    const updated = await getAnonymousReactions(postId, hashedOwnerId);

    return json({
      ...updated,
      userReaction: newReaction,
    });
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
