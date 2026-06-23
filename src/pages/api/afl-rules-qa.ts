/**
 * AFL Rules Q&A API Endpoint — "Ask Roger" for AFL Fantasy
 *
 * GET    /api/afl-rules-qa — Load all Q&As (pre-seeded + dynamic)
 * POST   /api/afl-rules-qa — Submit a new question, get AI answer
 * DELETE /api/afl-rules-qa — Remove a Q&A by ID (admin only)
 *
 * Auth: Any logged-in owner for GET/POST. Commissioner/admin for DELETE.
 * Storage: Upstash Redis via @upstash/redis, keyed by afl-rules-qa:all.
 * AI: Anthropic Claude Haiku for rules answers.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../utils/auth';
import { findBestMatch } from '../../utils/rules-qa-matching';
import type { RulesQA, AskQuestionRequest } from '../../types/rules-qa';
import seedData from '../../data/afl-rules-qa-seeds.json';
import { AFL_CONSTITUTION } from '../../data/afl-constitution';

type RedisClient = {
  get: <T>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown) => Promise<unknown>;
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
};

const REDIS_KEY = 'afl-rules-qa:all';
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 3600; // 1 hour in seconds

let loggedMissingRedisModule = false;

async function getRedis(): Promise<RedisClient | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;

  try {
    const { Redis } = await import('@upstash/redis');
    return new Redis({ url, token }) as unknown as RedisClient;
  } catch (error) {
    if (!loggedMissingRedisModule) {
      loggedMissingRedisModule = true;
      console.warn('[afl-rules-qa] Redis unavailable:', error);
    }
    return null;
  }
}

function makeRateLimitKey(franchiseId: string): string {
  return `afl-rules-qa:rate:${franchiseId}`;
}

function generateId(): string {
  return 'afl_qa_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function getAllQAs(redis: RedisClient | null): Promise<RulesQA[]> {
  const seeds = (seedData as RulesQA[]) ?? [];
  if (!redis) return seeds;

  try {
    const dynamic = await redis.get<RulesQA[]>(REDIS_KEY);
    if (!dynamic || !Array.isArray(dynamic)) return seeds;
    return [...dynamic, ...seeds];
  } catch {
    return seeds;
  }
}

// ── AFL Roger system prompt ──

const SYSTEM_PROMPT = `You are "Roger" — the AI rules expert for the AFL (American Football League), a 24-team keeper fantasy football league. You are NOT the Commissioner — you're Roger, a chatbot who's read the AFL constitution cover to cover. Your answers are *probably* right, but for definitive rulings, owners should ask the actual Commissioner.

PERSONALITY:
- Witty, sarcastic sports columnist who actually enjoys explaining rules
- Think bartender who moonlights as a constitutional law professor
- You love the arcane details — keeper strategy, draft order math, the NIT bonus formula, promotion/relegation drama
- Short, punchy answers. 2-4 paragraphs max. No bullet points unless listing specific rules.
- Light ribbing is encouraged. Heavy condescension is not.
- End with a relevant quip or callback when it fits naturally

SCOPE:
- You ONLY answer questions about AFL rules, structure, scoring, trades, keepers, drafts, and procedures
- The AFL has NO salary cap and NO contracts. If someone asks about cap space or contract length, clarify that those don't exist in the AFL — that's The League (a different league). Point them to the AFL rules page.
- For strategy questions (e.g., "who should I keep?", "is this trade good?", "who should I start?"), respond with something like: "I'm a rules bot, not a talent evaluator. I'll tell you the rules, but the decisions are on you."
- If asked about something not in the AFL constitution below, say so clearly — don't make things up. Say "I don't see that in the AFL constitution."
- When relevant, link to pages that can help: /afl-fantasy/rules (full constitution), /afl-fantasy/draft-predictor (draft order), /afl-fantasy/keepers (keeper plans), /afl-fantasy/rosters (rosters), /afl-fantasy/standings (standings)

FORMAT:
- Plain text with minimal markdown (bold for emphasis only, no headers)
- Keep answers under 300 words
- Use team names when referencing franchises
- Refer to yourself as "Roger" not "the Commissioner"
- ALWAYS end your answer with a rulebook link on its own line, formatted as: [Read the full rule](/afl-fantasy/rules#anchor-id)
- Use the most specific matching anchor from the RULEBOOK SECTIONS list below. If multiple sections are relevant, link to the primary one.
- If no section matches, link to [Read the full rulebook](/afl-fantasy/rules)
- ONLY use anchors from the list below — never fabricate anchor IDs.

RULEBOOK SECTIONS (use these exact anchor IDs):
  #league-information — League overview, commissioner, fees, format
  #important-dates — Dues, keeper deadline, trade deadline, draft window
  #division-setup — Two conferences, four divisions, team assignments
  #team-rosters — 16-player active roster, positions, IR availability
  #injured-reserve — IR rules, eligibility (Doubtful/Out/IR), violation penalty
  #starting-rosters — 9-starter lineup, TE-premium PPR scoring, kicker scoring
  #trades — Trade rules, cross-conference ban, trade deadline, pick deposits
  #free-agents — Yahoo-style rolling waivers, FCFS windows, waiver priority
  #keepers — 7-keeper limit, July 15 deadline, deadline penalty
  #draft — 9-round draft, conference draft order, NIT bonus, draft window
  #schedule — 17-game season, doubleheader weeks, schedule format
  #scoring — Scoring values, points-allowed tiers
  #game-tiebreakers — Playoff tiebreaker order
  #standings-tiebreakers — Division and wild card tiebreaker order
  #playoff-structure — League Championship bracket, NIT tournament
  #premier-dleague — Premier League / D-League side competition, promotion/relegation
  #payouts — Prize pool, prize amounts
  #replacement-owners — Owner departure, dispersal draft
  #rule-changes — Voting thresholds (75%/100%), amendment process

CRITICAL: Answer ONLY from the AFL constitution below. Do NOT infer, assume, or fill in gaps. If the answer isn't explicitly stated, say so. Getting a nuance wrong is worse than saying "I'm not sure — check with the Commissioner."

THE AFL CONSTITUTION (this is the complete, authoritative rulebook):

${AFL_CONSTITUTION}`;

/** Build the per-request "current date" block (Pacific Time) */
function buildDateBlock(now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return `CURRENT DATE: ${fmt.format(now)} (${iso}, Pacific Time).
Use this as the authoritative "today" when owners ask about timing, deadlines, or upcoming events.`;
}

async function callHaiku(question: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    temperature: 0.3,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
      {
        type: 'text',
        text: buildDateBlock(),
      },
    ],
    messages: [{ role: 'user', content: question }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type');
  return content.text;
}

// ── GET: Load all Q&As ──

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  const redis = await getRedis();
  const items = await getAllQAs(redis);

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return jsonResponse({ items });
};

// ── POST: Submit a new question ──

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user || !user.franchiseId) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  let body: AskQuestionRequest;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const question = body.question?.trim();
  if (!question || question.length < 10) {
    return jsonResponse({ error: 'Question must be at least 10 characters' }, 400);
  }
  if (question.length > 500) {
    return jsonResponse({ error: 'Question must be under 500 characters' }, 400);
  }

  const redis = await getRedis();

  // Rate limit check
  if (redis) {
    try {
      const rateLimitKey = makeRateLimitKey(user.franchiseId);
      const count = await redis.incr(rateLimitKey);
      if (count === 1) {
        await redis.expire(rateLimitKey, RATE_LIMIT_WINDOW);
      }
      if (count > RATE_LIMIT_MAX) {
        return jsonResponse(
          { error: "Easy there — you're limited to 5 questions per hour. Browse the existing answers or come back later." },
          429
        );
      }
    } catch (e) {
      console.warn('[afl-rules-qa] Rate limit check failed:', e);
    }
  }

  // Duplicate check against all existing Q&As
  const allQAs = await getAllQAs(redis);
  const match = findBestMatch(question, allQAs);
  if (match) {
    return jsonResponse({ qa: match, wasDuplicate: true });
  }

  // Call Haiku
  let answer: string;
  try {
    answer = await callHaiku(question);
  } catch (e) {
    console.error('[afl-rules-qa] Haiku call failed:', e);
    return jsonResponse({ error: 'Roger is temporarily unavailable. Try again in a moment.' }, 503);
  }

  // Look up team name from AFL config
  let teamName = user.name ?? 'Unknown';
  try {
    const config = await import('../../../data/afl-fantasy/afl.config.json');
    const teams: Array<{ franchiseId: string; name: string }> = config.default?.teams ?? config.teams ?? [];
    const team = teams.find((t) => t.franchiseId === user.franchiseId);
    if (team) teamName = team.name;
  } catch { /* use fallback */ }

  const newQA: RulesQA = {
    id: generateId(),
    question,
    answer,
    askedBy: {
      franchiseId: user.franchiseId,
      teamName,
    },
    createdAt: new Date().toISOString(),
    isPreSeeded: false,
  };

  // Save to Redis
  if (redis) {
    try {
      const existing = await redis.get<RulesQA[]>(REDIS_KEY);
      const updated = Array.isArray(existing) ? [newQA, ...existing] : [newQA];
      await redis.set(REDIS_KEY, updated);
    } catch (e) {
      console.error('[afl-rules-qa] Failed to save to Redis:', e);
    }
  }

  return jsonResponse({ qa: newQA, wasDuplicate: false });
};

// ── DELETE: Remove a Q&A by ID (admin only) ──

export const DELETE: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }
  if (!isCommissionerOrAdmin(user)) {
    return jsonResponse({ error: 'Admin access required' }, 403);
  }

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const id = body.id?.trim();
  if (!id) {
    return jsonResponse({ error: 'Missing Q&A id' }, 400);
  }

  const redis = await getRedis();
  if (!redis) {
    return jsonResponse({ error: 'Storage unavailable' }, 503);
  }

  try {
    const existing = await redis.get<RulesQA[]>(REDIS_KEY);
    if (!existing || !Array.isArray(existing)) {
      return jsonResponse({ error: 'Q&A not found' }, 404);
    }
    const updated = existing.filter(qa => qa.id !== id);
    if (updated.length === existing.length) {
      return jsonResponse({ error: 'Q&A not found' }, 404);
    }
    await redis.set(REDIS_KEY, updated);
    return jsonResponse({ deleted: true, id });
  } catch (e) {
    console.error('[afl-rules-qa] Failed to delete from Redis:', e);
    return jsonResponse({ error: 'Failed to delete' }, 500);
  }
};
