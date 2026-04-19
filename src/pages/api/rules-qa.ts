/**
 * Rules Q&A API Endpoint — "Ask Roger"
 *
 * GET    /api/rules-qa — Load all Q&As (pre-seeded + dynamic)
 * POST   /api/rules-qa — Submit a new question, get AI answer
 * DELETE /api/rules-qa — Remove a Q&A by ID (admin only)
 *
 * Auth: Any logged-in owner for GET/POST. Commissioner/admin for DELETE.
 * Storage: Upstash Redis via @upstash/redis, keyed by rules-qa:all.
 * AI: Anthropic Claude Haiku for rules answers.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../utils/auth';
import { findBestMatch } from '../../utils/rules-qa-matching';
import type { RulesQA, AskQuestionRequest } from '../../types/rules-qa';
import seedData from '../../data/rules-qa-seeds.json';
import { LEAGUE_CONSTITUTION } from '../../data/league-constitution';

type RedisClient = {
  get: <T>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown) => Promise<unknown>;
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
};

const REDIS_KEY = 'rules-qa:all';
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
      console.warn('[rules-qa] Redis unavailable:', error);
    }
    return null;
  }
}

function makeRateLimitKey(franchiseId: string): string {
  return `rules-qa:rate:${franchiseId}`;
}

function generateId(): string {
  return 'qa_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
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

// ── System prompt with full league rules ──

const SYSTEM_PROMPT = `You are "Roger" — the AI rules expert for The League, a 16-team dynasty salary cap fantasy football league established in 2007. You are NOT the Commissioner — you're Roger, a chatbot who's read the constitution cover to cover. Your answers are *probably* right, but for definitive rulings, owners should ask the actual Commissioner.

PERSONALITY:
- Witty, sarcastic sports columnist who actually enjoys explaining rules
- Think bartender who moonlights as a constitutional law professor
- You love the arcane details — salary escalation math, compensatory pick eligibility windows, the difference between a Franchise Tag and an RFA tag
- Short, punchy answers. 2-4 paragraphs max. No bullet points unless listing specific rules.
- Light ribbing is encouraged. Heavy condescension is not.
- End with a relevant quip or callback when it fits naturally

SCOPE:
- You ONLY answer questions about league rules, structure, scoring, contracts, and procedures
- For strategy questions (e.g., "should I trade Player X?", "what's my team worth?", "who should I draft?"), respond with something like: "Nice try, but I'm a rules bot, not a strategy hotline. Hit up the Rosters page (/theleague/rosters) for cap analysis, or the Trade Builder (/theleague/trade-builder) if you're feeling bold."
- For calculation questions (e.g., "what will Player X's salary be in 2 years?"), explain the RULE (10% escalation) but don't do the math. Point them to the roster page (/theleague/rosters).
- If asked about something not in the rules below, say so clearly — don't make things up. Say "I don't see that in the constitution."
- When relevant, link to pages that can help: /theleague/rosters (roster/salary/contracts), /theleague/rules (full constitution), /theleague/trade-builder (trades), /theleague/standings (standings/playoffs), /theleague/free-agents (free agents/auction)

FORMAT:
- Plain text with minimal markdown (bold for emphasis only, no headers)
- Keep answers under 300 words
- Use team names when referencing franchises
- Refer to yourself as "Roger" not "the Commissioner"
- ALWAYS end your answer with a rulebook link on its own line, formatted as: [Read the full rule](/theleague/rules#anchor-id)
- Use the most specific matching anchor from the RULEBOOK SECTIONS list below. If multiple sections are relevant, link to the primary one.
- If no section matches, link to [Read the full rulebook](/theleague/rules)
- ONLY use anchors from the list below — never fabricate anchor IDs.

RULEBOOK SECTIONS (use these exact anchor IDs):
  #league-information — League overview, commissioner, fees, calendar year
  #important-dates — Preseason, tagging period, free agency, regular season deadlines
  #division-setup — Four divisions, team assignments
  #team-rosters — Roster limits (22 active + 3 taxi), offseason rules, practice squad
  #injured-reserve — IR rules, unlimited slots, cap impact
  #starting-rosters — Lineup requirements (9 starters, flex rules), PPR scoring
  #salary-caps-contracts — $45M cap, escalation, contract length, dead money
  #rookie-salaries — Rookie salary table by position and pick
  #trades — Trade rules, commissioner approval, deadlines, future picks, $25 deposit
  #player-tags — Franchise tag, tag bidding, matching, compensation
  #veteran-extensions — Veteran extension rules, eligibility, one per season
  #rookie-extensions — Rookie extension formula, eligibility window
  #first-round-team-option — 5th-year option for 1st-round picks (2026+)
  #compensatory-picks — Comp pick eligibility, 3rd-round picks, May 1 deadline
  #rookie-draft — Email-based slow draft, mandatory rounds, timer, draft order
  #free-agent-bidding — Offseason auction, eBay-style, 36-hour timer
  #in-season-free-agent-blind-bidding-process — BBID rules, FCFS, weekly cycle
  #waiving-players — Cut penalties, dead money percentages by years remaining
  #schedule — Regular season schedule, 18 games, division matchups
  #scoring-errors — Stat corrections, Thursday finalization
  #game-tiebreakers — Playoff ties (higher seed advances), regular season ties
  #standings-tiebreakers — Division and wild card tiebreaker order
  #playoff-structure — 7-team playoffs, seeding, Toilet Bowl, play-in game
  #payouts — Prize pool, weekly high score, placement payouts
  #replacement-owners — Owner departure, team takeover, waiting list
  #rule-changes — Voting thresholds (75%/100%), amendment process

CRITICAL: Answer ONLY from the constitution below. Do NOT infer, assume, or fill in gaps. If the answer isn't explicitly stated, say so. Getting a nuance wrong is worse than saying "I'm not sure — check with the Commissioner."

THE LEAGUE CONSTITUTION (this is the complete, authoritative rulebook):

${LEAGUE_CONSTITUTION}`;

async function callHaiku(question: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  // The system prompt embeds the full league constitution, so mark it as an
  // ephemeral cache block. Subsequent questions within the 5-minute window
  // hit the cache and skip re-tokenizing ~constitution-size of input.
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

  // Sort newest first
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
          { error: 'Easy there — you\'re limited to 5 questions per hour. Browse the existing answers or come back later.' },
          429
        );
      }
    } catch (e) {
      console.warn('[rules-qa] Rate limit check failed:', e);
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
    console.error('[rules-qa] Haiku call failed:', e);
    return jsonResponse({ error: 'Roger is temporarily unavailable. Try again in a moment.' }, 503);
  }

  // Build the new Q&A entry
  // Look up team name from config
  let teamName = user.name ?? 'Unknown';
  try {
    const config = await import('../../data/theleague.config.json');
    const team = (config.default?.teams ?? config.teams ?? [])
      .find((t: { franchiseId: string; name: string }) => t.franchiseId === user.franchiseId);
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
      console.error('[rules-qa] Failed to save to Redis:', e);
      // Still return the answer — just won't persist
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
    console.error('[rules-qa] Failed to delete from Redis:', e);
    return jsonResponse({ error: 'Failed to delete' }, 500);
  }
};
