/**
 * GroupMe Messages — Serve cached messages from Redis
 *
 * GET /api/groupme/messages              — Recent messages (newest first)
 * GET /api/groupme/messages?since={ms}   — Messages after a timestamp (for polling)
 * GET /api/groupme/messages?limit={n}    — Limit results (default 50)
 *
 * Auth required — GroupMe content is only visible to authenticated owners.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { getRecentMessages, getMessagesSince, getLastSyncTs } from '../../../utils/groupme-storage';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const user = getAuthUser(request);
  if (!user?.franchiseId) return json({ error: 'Authentication required' }, 401);

  const sinceParam = url.searchParams.get('since');
  const limitParam = url.searchParams.get('limit');
  const limit = Math.min(Math.max(Number(limitParam) || 50, 1), 200);

  try {
    const messages = sinceParam
      ? await getMessagesSince(Number(sinceParam), limit)
      : await getRecentMessages(limit);

    const lastSync = await getLastSyncTs();

    return json({
      messages,
      count: messages.length,
      lastSync,
    });
  } catch (err) {
    console.error('[groupme/messages] Error:', err);
    return json({ error: 'Failed to fetch messages' }, 500);
  }
};
