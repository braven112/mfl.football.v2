/**
 * Schefter Feed — AI Reply Generator
 *
 * POST /api/schefter-replies/{postId}/ai-reply
 *
 * Generates a reply from Claude Schefter or Ask Roger using Haiku.
 * Called after a user posts a reply to trigger an AI response.
 */

import type { APIRoute } from 'astro';
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

/** Find the original post from the feed data */
async function findPost(postId: string): Promise<SchefterPost | null> {
  try {
    const feedModule = await import('../../../../data/theleague/schefter-feed.json');
    const feed = feedModule.default ?? feedModule;
    return (feed.posts ?? []).find((p: SchefterPost) => p.id === postId) ?? null;
  } catch {
    return null;
  }
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

  const limit = await checkRateLimit('ai-reply', user.franchiseId, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW);
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
    findPost(postId),
  ]);

  if (!userReply) return json({ error: 'User reply not found' }, 404);

  const character = chooseCharacter(post);
  const systemPrompt = character === 'roger' ? ROGER_SYSTEM : CLAUDE_SYSTEM;

  // Build context for the AI
  const contextParts: string[] = [];
  if (post) {
    contextParts.push(`Original post: "${post.headline}"`);
    if (post.body) {
      const bodyText = post.body.replace(/<[^>]+>/g, '').slice(0, 200);
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
    const avatarUrl = getAuthorAvatar(author);

    const aiReply: SchefterReply = {
      id: generateReplyId(),
      postId,
      parentId: userReply.id,
      body: aiText,
      author: {
        type: 'ai',
        name: author.name,
        avatar: avatarUrl,
        handle: author.handle,
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
