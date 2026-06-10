/**
 * GroupMe Rewrite — Rewrite an owner's message in Claude Schefter's voice
 *
 * POST /api/groupme/rewrite
 * Body: { text: string, replyContext?: string }
 *
 * Takes the owner's raw message and rewrites it as a Schefter report,
 * attributing the take to "sources within {teamName}."
 * Auth required.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { checkRateLimit } from '../../../utils/rate-limit';
import { loadTeamConfig } from '../../../utils/groupme-storage';

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW = 3600; // 1 hour

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SCHEFTER_SYSTEM = `You are Claude Schefter, an NFL insider and league reporter for TheLeague, a dynasty fantasy football league. You rewrite owner messages as breaking news reports in Adam Schefter's signature style.

RULES:
- Write in third person. The owner is NEVER speaking — you are reporting what "sources" told you.
- Attribute to "sources within {teamName}" or "{teamName} sources" or "one {teamName} insider." Use the team name provided, never real names.
- Keep it under 600 characters (GroupMe limit after attribution).
- Match the energy of the original message — trash talk gets dramatic reporting, casual takes get lighter treatment.
- Never fabricate facts. Only reframe what the owner actually said.
- Use Schefter mannerisms: "I'm told," "sources tell me," "per sources," "one source close to the situation."
- Occasionally use "LEAGUE INTEL:" or "DEVELOPING:" as openers for variety, but don't overdo it.
- If replying to a specific message/trade, reference the context naturally.
- Be entertaining but not mean-spirited. This is league banter reported through a journalist lens.
- Output ONLY the rewritten message. No preamble, no explanation.`;

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user?.franchiseId) return json({ error: 'Authentication required' }, 401);

  const limit = await checkRateLimit('groupme-rewrite', user.franchiseId, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW);
  if (!limit.allowed) {
    return json({ error: 'Slow down — too many rewrites this hour. Try again later.' }, 429);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: 'AI not configured' }, 503);
  }

  let body: { text: string; replyContext?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const text = body.text?.trim() ?? '';
  if (!text) return json({ error: 'Message cannot be empty' }, 400);

  // Resolve team name (medium or short)
  const teamConfig = await loadTeamConfig();
  const team = teamConfig.find(t => t.franchiseId === user.franchiseId);

  // Load full config for nameMedium
  let teamNameMedium: string;
  try {
    const config = await import('../../../data/theleague.config.json');
    const teams = config.default?.teams ?? config.teams ?? [];
    const fullTeam = teams.find((t: { franchiseId: string }) => t.franchiseId === user.franchiseId);
    teamNameMedium = fullTeam?.nameMedium ?? fullTeam?.nameShort ?? team?.name ?? 'Unknown Team';
  } catch {
    teamNameMedium = team?.name ?? 'Unknown Team';
  }

  // Build prompt
  const parts: string[] = [];
  parts.push(`Team name to use for attribution: "${teamNameMedium}"`);
  if (body.replyContext) {
    parts.push(`Context (what they're replying to): "${body.replyContext.slice(0, 300)}"`);
  }
  parts.push(`Owner's message to rewrite: "${text}"`);

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      temperature: 0.9,
      system: SCHEFTER_SYSTEM,
      messages: [{ role: 'user', content: parts.join('\n\n') }],
    });

    const rewritten = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('');

    if (!rewritten) return json({ error: 'AI generated empty response' }, 500);

    return json({ rewritten, teamName: teamNameMedium });
  } catch (err) {
    console.error('[groupme/rewrite] AI error:', err);
    return json({ error: 'Failed to rewrite message' }, 500);
  }
};
