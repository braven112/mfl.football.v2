/**
 * Schefter Feed — AI Reply Generator
 *
 * POST /api/schefter-replies/{postId}/ai-reply
 *
 * Generates a reply from the league's news persona (Claude Schefter by
 * default) or Ask Roger using Haiku. Called after a user posts a reply to
 * trigger an AI response. The league is the SESSION's: its feed supplies the
 * post context, its persona names the replier, and its name goes in the
 * prompt — TheLeague's default-persona prompt is byte-identical to before.
 */

import type { APIRoute } from 'astro';
import { stripTags } from '../../../../utils/whats-new-links';
import { getAuthUser } from '../../../../utils/auth';
import { checkRateLimit } from '../../../../utils/rate-limit';
import type { SchefterReply, AiReplyRequest } from '../../../../types/schefter-replies';
import {
  getReplyById,
  saveReply,
  generateReplyId,
} from '../../../../utils/schefter-replies-storage';
import { getAuthor, getAuthorAvatar } from '../../../../types/schefter';
import type { SchefterPost } from '../../../../types/schefter';
import { getLeagueById, type LeagueDefinition } from '../../../../config/leagues';
import { getLeaguePersona } from '../../../../utils/persona-server';
import { isDefaultPersona, personaByline } from '../../../../utils/persona.mjs';
import { scrubLeagueNames } from '../../../../utils/league-name-guard.mjs';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CLAUDE_SYSTEM = `You are Claude Schefter, the league's beat reporter and insider for a dynasty fantasy football league called TheLeague. You're responding to league owners in the comments of your news feed.

Personality:
- Channel Adam Schefter's breaking-news energy but with more humor and edge
- Play along with smack talk — roast owners when they deserve it
- Be entertaining, witty, and slightly sarcastic but never mean-spirited
- Use sports metaphors, insider lingo, and league-specific references
- Reference the post content for context when relevant
- Encourage banter and rivalry between owners

Rules:
- Keep replies under 140 characters — old-school Twitter length, punchy and tight
- Never break character — you ARE Claude Schefter
- Never mention being an AI or language model
- Be opinionated — take sides, make predictions, call out bad takes`;

const ROGER_SYSTEM = `You are Ask Roger, the commissioner's AI assistant for a dynasty fantasy football league called TheLeague. You're responding to league owners in the comments of the news feed.

Personality:
- You're the league's rule enforcer and deadline reminder, but with dry wit
- Deadpan humor — like a seasoned bureaucrat who's seen everything
- You've read the constitution so they don't have to
- Slightly exasperated but always professional
- Reference rules and deadlines when relevant, but keep it conversational
- Play along with smack talk but from an authority position

Rules:
- Keep replies under 140 characters — old-school Twitter length, punchy and tight
- Never break character — you ARE Ask Roger
- Never mention being an AI or language model
- Be the voice of reason, but make it entertaining`;

// Every league's feed, loaded lazily (a feed is ~1 MB): TheLeague's lives
// under src/data, the rest under data/. Keyed by the registry's
// `schefterFeedPath`, so a new league needs no edit here.
const SRC_FEEDS = import.meta.glob('../../../../data/*/schefter-feed.json', { import: 'default' });
const ROOT_FEEDS = import.meta.glob('../../../../../data/*/schefter-feed.json', { import: 'default' });
const FEED_LOADERS: Record<string, () => Promise<unknown>> = Object.fromEntries([
  ...Object.entries(SRC_FEEDS).map(([k, load]) => [`src/${k.replace(/^(\.\.\/)+/, '')}`, load]),
  ...Object.entries(ROOT_FEEDS).map(([k, load]) => [k.replace(/^(\.\.\/)+/, ''), load]),
]);

/** Find the original post in the league's own feed */
async function findPost(league: LeagueDefinition, postId: string): Promise<SchefterPost | null> {
  const load = league.schefterFeedPath ? FEED_LOADERS[league.schefterFeedPath] : undefined;
  if (!load) return null;
  try {
    const feed = (await load()) as { posts?: SchefterPost[] };
    return (feed.posts ?? []).find((p) => p.id === postId) ?? null;
  } catch {
    return null;
  }
}

/** The persona's system prompt for a league other than TheLeague, or a renamed persona. */
function personaSystem(persona: { name: string; voice: string }, leagueName: string): string {
  return `You are ${persona.name}, the league's beat reporter and insider for a fantasy football league called ${leagueName}. You're responding to league owners in the comments of your news feed.

Voice:
${persona.voice}

Personality:
- Play along with smack talk — roast owners when they deserve it
- Be entertaining, witty, and slightly sarcastic but never mean-spirited
- Reference the post content for context when relevant
- Encourage banter and rivalry between owners

Rules:
- Keep replies under 140 characters — old-school Twitter length, punchy and tight
- Never break character — you ARE ${persona.name}
- Never mention being an AI or language model
- Be opinionated — take sides, make predictions, call out bad takes`;
}

/** Decide which AI character responds */
function chooseCharacter(post: SchefterPost | null): 'claude' | 'roger' {
  if (post?.authorId === 'roger') return 'roger';
  if (post?.type === 'ask-roger') return 'roger';
  return 'claude';
}

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW = 3600; // 1 hour

export const POST: APIRoute = async ({ params, request }) => {
  const user = getAuthUser(request);
  if (!user?.franchiseId) return json({ error: 'Authentication required' }, 401);
  // getAuthUser only returns sessions for a registry league (or an MFL Live
  // pilot, which has no feed and no replies to answer).
  const league = getLeagueById(user.leagueId);
  if (!league) return json({ error: 'No news feed for this league' }, 404);

  // Keyed by league AND franchise: both leagues have a franchise 0001.
  const limit = await checkRateLimit('ai-reply', `${user.leagueId}:${user.franchiseId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW);
  if (!limit.allowed) {
    return json({ error: 'Too many AI replies this hour — give Schefter a breather.' }, 429);
  }

  const postId = params.postId;
  if (!postId) return json({ error: 'postId required' }, 400);

  let body: AiReplyRequest;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  if (!body.userReplyId) return json({ error: 'userReplyId required' }, 400);

  // Load context
  const [userReply, post] = await Promise.all([
    getReplyById(postId, body.userReplyId),
    findPost(league, postId),
  ]);

  if (!userReply) return json({ error: 'User reply not found' }, 404);

  const character = chooseCharacter(post);
  const persona = await getLeaguePersona(league.slug);
  const leagueName = league.shortName ?? league.name;
  const original = league.slug === 'theleague';
  const systemPrompt =
    character === 'roger'
      ? original
        ? ROGER_SYSTEM
        : ROGER_SYSTEM.replace('a dynasty fantasy football league called TheLeague', `a fantasy football league called ${leagueName}`)
      : original && isDefaultPersona(persona)
        ? CLAUDE_SYSTEM
        : personaSystem(persona, leagueName);

  // Build context for the AI
  const contextParts: string[] = [];
  if (post) {
    contextParts.push(`Original post: "${post.headline}"`);
    if (post.body) {
      const bodyText = stripTags(post.body).slice(0, 200);
      contextParts.push(`Post body: "${bodyText}"`);
    }
  }
  contextParts.push(`${userReply.author.name} replied: "${userReply.body}"`);

  const userMessage = contextParts.join('\n\n');

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      temperature: 0.8,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const aiText = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('');

    if (!aiText) return json({ error: 'AI generated empty response' }, 500);

    const author = getAuthor(character);
    // The persona renames only its own byline; Roger keeps his.
    const byline = personaByline(author, getAuthorAvatar(author), persona);

    const aiReply: SchefterReply = {
      id: generateReplyId(),
      postId,
      parentId: userReply.id,
      // Another league's name never publishes (utils/league-name-guard.mjs).
      body: scrubLeagueNames(aiText, league.slug),
      author: {
        type: 'ai',
        name: byline.name,
        avatar: byline.avatar,
        handle: byline.handle,
        aiCharacter: character,
      },
      createdAt: new Date().toISOString(),
    };

    const saved = await saveReply(aiReply);
    if (!saved) return json({ error: 'Failed to save AI reply' }, 500);

    return json({ reply: aiReply }, 201);
  } catch (err) {
    console.error('[ai-reply] Anthropic API error:', err);
    return json({ error: 'AI reply generation failed' }, 500);
  }
};
