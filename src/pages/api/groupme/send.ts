/**
 * GroupMe Send — Post a message to GroupMe via the bot
 *
 * POST /api/groupme/send
 * Body: { text: string, raw?: boolean, replyTo?: string }
 *
 * If raw=true, posts text as-is (already Schefter-rewritten).
 * Otherwise prepends team name for attribution.
 * Auth required. Rate limited: 20 messages/hour per franchise.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { postAsBot } from '../../../utils/groupme-client';
import { checkSendRateLimit, loadTeamConfig } from '../../../utils/groupme-storage';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user?.franchiseId) return json({ error: 'Authentication required' }, 401);

  let body: { text: string; raw?: boolean; replyTo?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const text = body.text?.trim() ?? '';
  if (!text) return json({ error: 'Message cannot be empty' }, 400);

  // Rate limit
  const { allowed, count } = await checkSendRateLimit(user.franchiseId);
  if (!allowed) {
    return json({ error: 'Slow down — you\'re limited to 20 messages per hour.', count }, 429);
  }

  let finalText: string;

  if (body.raw) {
    // Already Schefter-rewritten — post as-is
    finalText = text;
  } else {
    // Prepend team name for attribution
    const teamConfig = await loadTeamConfig();
    const team = teamConfig.find(t => t.franchiseId === user.franchiseId);
    const teamName = team?.name ?? 'Unknown Team';

    if (body.replyTo) {
      const quotedLines = body.replyTo.split('\n').map(l => `> ${l}`).join('\n');
      finalText = `${teamName}:\n${quotedLines}\n\n${text}`;
    } else {
      finalText = `${teamName}:\n${text}`;
    }
  }

  // Trim to GroupMe's 1000 char limit
  if (finalText.length > 1000) {
    finalText = finalText.slice(0, 997) + '...';
  }

  const success = await postAsBot(finalText);
  if (!success) return json({ error: 'Failed to send message to GroupMe' }, 502);

  return json({ sent: true, count });
};
