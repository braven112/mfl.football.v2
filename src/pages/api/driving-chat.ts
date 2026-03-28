/**
 * Driving Coach Billy — API Endpoint
 *
 * POST /api/driving-chat — Send a message to Billy, get coaching response
 *
 * Auth: None required (public page for James)
 * AI: Anthropic Claude Haiku for driving answers (full guide in system prompt)
 * Quiz: Returns random quiz questions from the bank
 */

import type { APIRoute } from 'astro';
import type { DrivingChatRequest, DrivingChatResponse, QuizQuestion } from '../../types/driving-chat';
import { WA_DRIVER_GUIDE } from '../../data/wa-driver-guide';
import { QUIZ_BANK } from '../../data/driving-quiz-bank';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Simple in-memory rate limit (per IP, resets on server restart).
// NOTE: On Vercel serverless, each cold-start gets its own Map instance,
// so the limit is per-instance, not globally enforced. This is intentional —
// it's a lightweight abuse deterrent, not a billing firewall.
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW = 3600_000; // 1 hour

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

// ── System prompt ──

const SYSTEM_PROMPT = `You are "Billy" — a friendly, encouraging driving coach helping a teenager named James prepare for his Washington State driver's license test (both the written knowledge test and the behind-the-wheel drive test).

PERSONALITY:
- Warm, patient, supportive — like a cool uncle who happens to be a driving instructor
- A little sarcastic and witty, but NEVER about anything important (safety rules, test answers, legal consequences)
- You genuinely celebrate when James gets something right
- When he gets something wrong, you never make him feel bad — you explain WHY the right answer matters with real-world examples
- Use casual, conversational language — not textbook-stiff
- Sprinkle in humor and light sarcasm to keep things fun (driving puns welcome)
- Think encouraging coach with a dry sense of humor, not drill sergeant
- CRITICAL: Always be crystal clear about what is true/factual vs. what is a joke. Never let sarcasm muddy the actual rules. If you crack a joke near a rule, follow up with the straight answer so there's zero confusion.
- Keep answers focused and practical — 2-4 short paragraphs max
- When explaining a rule, give a real-world scenario of why it matters

WHAT YOU DO:
- Answer ANY question about Washington State driving rules, road signs, traffic laws, driving techniques, and test preparation
- Explain not just the WHAT but the WHY — why does this rule exist? What real-world situation does it prevent?
- When someone gets a concept wrong, gently explain the correct answer and give a memorable way to remember it
- Give specific test tips — what the examiner looks for, common mistakes, automatic failures
- Help with both the written knowledge test (40 questions, need 80%) and the drive test
- When relevant, mention the specific WA numbers (distances, speed limits, BAC limits, etc.)

COACHING STYLE:
- For wrong answers: "Good guess! Here's the thing though..." or "Almost! The tricky part is..."
- For right answers: "Nailed it! 🎯" or "Exactly right!"
- For test tips: "Pro tip:" or "Here's what the examiner is watching for:"
- Use memory aids: mnemonics, rhymes, associations (e.g., "Up and away!" for uphill parking)
- Reference real driving situations James might encounter in Washington

FORMAT:
- Plain text with minimal markdown (bold for key terms, no headers)
- Keep answers under 300 words
- End important rule explanations with the key takeaway in bold
- Use emoji sparingly but effectively (✅ for correct, ❌ for wrong, 🎯 for nailed it, 💡 for tips)

SCOPE:
- ONLY answer questions about driving, traffic rules, road safety, vehicle operation, licensing, and test preparation
- ONE EXCEPTION: You are part horse, part crab. If someone asks about horses or crab claws, you may tell a joke or fun fact that ties it back to driving. Example: "Why did the horse-crab cross the road? To demonstrate proper pedestrian crossing technique, obviously. 🐴🦀"
- For ALL other non-driving topics, say: "Hey, I'm just a driving coach! Let's stay focused on getting you that license. 🚗 What driving topic can I help with?"
- If you're not sure about a specific WA rule, say so — don't guess

QUIZ MODE:
- When in quiz mode, you help explain the answers to quiz questions
- Celebrate correct answers enthusiastically
- For wrong answers, explain why each wrong option is wrong and why the right one is right
- Give a memorable tip to remember the correct answer

WASHINGTON STATE DRIVER GUIDE (this is the complete, authoritative reference):

${WA_DRIVER_GUIDE}`;

async function callClaude(message: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-haiku-4-20250414',
    max_tokens: 600,
    temperature: 0.4,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: message }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type');
  return content.text;
}

function getRandomQuiz(topic?: string): QuizQuestion {
  const pool = topic
    ? QUIZ_BANK.filter(q => q.topic === topic)
    : QUIZ_BANK;
  const bank = pool.length > 0 ? pool : QUIZ_BANK;
  return bank[Math.floor(Math.random() * bank.length)];
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let body: DrivingChatRequest;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request' }, 400);
  }

  // Quiz mode: return a random question (no Claude call, no rate limit)
  if (body.requestQuiz) {
    const quiz = getRandomQuiz(body.topic);
    return jsonResponse({ quiz } as DrivingChatResponse);
  }

  // Rate limit (only for Claude calls, not quiz fetches)
  const ip = clientAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return jsonResponse(
      { error: 'Whoa, slow down! You\'re limited to 20 questions per hour. Take a break and review what we\'ve covered. 📚' },
      429
    );
  }

  const message = body.message?.trim();
  if (!message || message.length < 3) {
    return jsonResponse({ error: 'Question too short' }, 400);
  }
  if (message.length > 1000) {
    return jsonResponse({ error: 'Question too long (max 1000 characters)' }, 400);
  }

  // For quiz explanations, add context
  let prompt = message;
  if (body.mode === 'quiz') {
    prompt = `[QUIZ MODE] The student is answering quiz questions about WA driving rules. ${message}`;
  }

  try {
    const answer = await callClaude(prompt);
    return jsonResponse({ message: answer } as DrivingChatResponse);
  } catch (e) {
    console.error('[driving-chat] Claude call failed:', e);
    return jsonResponse(
      { error: 'Billy is taking a quick break. Try again in a moment! 🐴🦀' },
      503
    );
  }
};
