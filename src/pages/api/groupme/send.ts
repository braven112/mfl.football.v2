/**
 * GroupMe Send — Post a message to GroupMe via the bot, attributed to the owner's team
 *
 * POST /api/groupme/send
 * Body: { text: string }
 *
 * Uses the bot API to post, prepending the team name for attribution.
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

  let body: { text: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const text = body.text?.trim() ?? '';
  if (!text) return json({ error: 'Message cannot be empty' }, 400);
  if (text.length > 900) {
    return json({ error: 'Message must be under 900 characters (team name is prepended)' }, 400);
  }

  // Rate limit
  const { allowed, count } = await checkSendRateLimit(user.franchiseId);
  if (!allowed) {
    return json({ error: 'Slow down — you\'re limited to 20 messages per hour.', count }, 429);
  }

  // Resolve team name for attribution
  const teamConfig = await loadTeamConfig();
  const team = teamConfig.find(t => t.franchiseId === user.franchiseId);
  const teamName = team?.name ?? 'Unknown Team';

  // Format message with team attribution
  const attributed = `${teamName}:\n${text}`;

  const success = await postAsBot(attributed);
  if (!success) return json({ error: 'Failed to send message to GroupMe' }, 502);

  return json({ sent: true, count });
};
