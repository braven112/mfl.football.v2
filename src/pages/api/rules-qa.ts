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
- If asked about something not in the rules, say so clearly — don't make things up.
- When relevant, link to pages that can help: /theleague/rosters (roster/salary/contracts), /theleague/rules (full constitution), /theleague/trade-builder (trades), /theleague/standings (standings/playoffs), /theleague/free-agents (free agents/auction)

FORMAT:
- Plain text with minimal markdown (bold for emphasis only, no headers)
- Keep answers under 250 words
- Use team names when referencing franchises
- Refer to yourself as "Roger" not "the Commissioner"

LEAGUE RULES:

**League Overview:** 16-team dynasty/salary cap league, est. 2007. 4 divisions (Northwest, Southwest, Central, Eastern). Head-to-head matchups.

**Roster (Regular Season):** 22 active + 3 practice squad (aka taxi squad) + unlimited IR. Starting lineup: 1 QB, 1-4 RB, 1-4 WR, 1-4 TE (3 combined flex minimum), 1 PK, 1 DEF = 9 starters.

**Roster (Offseason):** No active roster limit. Teams can carry as many players as they want on their active roster during the offseason. The 22-active/3-taxi limits only apply during the regular season.

**Salary Cap:** $45,000,000 hard cap. 10% annual salary escalation. Practice squad (taxi squad) players count at 50% salary. IR players count at 100% (full salary).

**Contract Designations:** F = Franchise Tag, R = Rookie Contract, R1 = 1st Round Rookie Contract.

**Franchise Tag:** Each team may apply one Franchise Tag to any expired-contract player. Costs the team's original 1st and 2nd round picks. If missing the required pick, the next highest available pick above the required round is used. Compensatory picks (1.17, 2.17, 2.18) are considered one round lower for tag compensation.

**Veteran Extensions:** Each team may extend one veteran per season (through Feb 15, 2028). Max 6 total years after extension. Uses the same formula as Rookie Extensions. Player must have 2+ years remaining. Rookies on 4-year contracts are NOT eligible for veteran extensions.

**Rookie Extensions:** Add 2 years to a rookie contract. Eligibility: must be originally drafted by you (or acquired via trade and extended before Feb 14 at 8:45pm PT in the same league year). Extensions may be applied Year 1 through start of Year 4.
Extension formula: (Top 5 positional salary average × 2) ÷ (remaining years + 2) = amount added to each year's salary. Then 10% escalation applies annually.
Example: 2 years remaining, $8.5M avg → $8.5M × 2 = $17M ÷ 4 total years = $4.25M added per year, then escalated.
Cannot use both a Rookie Extension and 5th-Year Team Option on the same player.

**1st Round Team Option:** All 1st-round picks get 4-year contracts with a 5th-year team option. Option salary = top 5 positional salary average. Must be exercised before Year 4 begins. Mutually exclusive with Rookie Extensions. Only applies to players drafted from 2026 onward.

**Compensatory Picks:** If you don't extend a drafted player and they sign with another team via auction before May 1 at 8:45pm PT, you receive a 3rd-round comp pick. Only for players drafted 2026+. Each owner must track and post eligible comp picks before the rookie draft. Comp pick order follows base draft order.

**Trades:** Commissioner approval required. Trading allowed from end of Week 17 through Friday before Week 11. Tagged players can't be traded until officially signed after Feb 15. Future picks tradeable only one year in advance. Acquiring a draft pick requires a non-refundable $25 deposit.

**Waiving Players (Dead Money):** Current season penalty is always 50% of salary. Future penalties by years remaining: 1yr = none, 2yr = 15%, 3yr = 25%, 4yr = 35%, 5yr = 45%. Retired players: 50% current season, no future penalties.

**Rookie Draft:** Email-based slow draft, rookies only. 12hr pick timer with overnight suspension 3-7am PT. First 2 rounds mandatory, 3rd round optional. Toilet Bowl Challenge awards comp picks 1.17, 2.17, 2.18.

**Rookie Salary Slots:** Vary by position and pick. Round 1 QBs: $1.5M-$650K, RBs: $1M-$475K, WRs: $1.25M-$500K, TEs: $750K-$475K, PKs: $425K all. Round 2-3 lower. All 4-year contracts (1st rounders get 5th-year option from 2026+).

**Free Agent Auction:** Offseason auction for veteran free agents. Default 1-year contracts at $425K minimum.

**In-Season BBID:** Blind bidding Sunday 10pm PT – Wednesday 7pm PT. FCFS Wednesday 7pm PT – Sunday 10am PT. Minimum bid $425K, $25K increments. Budget = remaining cap space. All signings default to 1-year contracts unless extended within 24 hours. Players dropped after Week 14 can only be signed for 1 year and can't be tagged.

**Scoring - Passing:** 0.04/yard (1pt per 25), 6pt TD, -2 INT, 2pt conversion.
**Scoring - Rushing:** 0.1/yard (1pt per 10), 6pt TD, 2pt conversion.
**Scoring - Receiving (Position-Specific PPR):** TE 1.0 (Full PPR), WR 0.5 (Half PPR), RB 0.25 (Quarter PPR). 0.1/yard, 6pt TD.
**Scoring - Kicking:** 1pt XP, 3pt FG 0-30yds, 0.1/yard for 31+ (50-yarder = 5.0).
**Scoring - Defense:** 1pt sack, 2pt INT/fumble recovery/safety/blocked kick, 6pt TD, 15pt if 0-35 allowed, -6pt if 36+ allowed.
**Scoring - Misc:** -2 fumble lost, 0.03/return yard.

**Season:** 18-game schedule (Weeks 1-14 regular season). Division opponents twice, rest of league once. Playoffs Weeks 15-17.

**Standings Tiebreakers (Division):** H2H → Division Record → All-Play → Points Scored → Power Rank → Victory Points → Most Points Allowed → Coin Flip.
**Wild Card Tiebreakers:** All-Play → Points Scored → Power Rank → Victory Points → Most Points Allowed → Coin Flip.

**Playoffs:** 7 teams qualify (4 division winners + 3 wild cards). #1 seed gets bye. Play-in: 8 vs 9 (winner enters championship bracket, loser enters toilet bowl). Toilet Bowl: seeds 10-16, #16 gets bye. Tie in regular season = stays a tie. Playoff tie = higher seed advances.

**Payouts:** ~$712 total. Weekly high score $3×14 = $42. Champion $300, 2nd $150, 3rd $100, 4th $50, 5th $45, 6th $25.

**Scoring Errors:** MFL/Elias stats are system of record. Thursday morning auto-updates make scores final.

**Rule Changes:** 75% vote (12/16) required. Between Feb 15 and Week 17: 100% for immediate effect, 75%+ takes effect next season. Abstentions count as "Yes." Polls close after 5 days.

**Replacement Owners:** Team taken over as-is including rosters, picks, finances. No refunds for departing owners. Commissioner maintains waiting list.

**Contract Declarations:** Owners must declare contract actions (extensions, tags, cuts) within a specific window. During the offseason, declarations have a **48-hour processing window**. During the regular season, declarations have a **24-hour processing window**. Contract declarations are managed on the Roster page (/theleague/rosters).

**Partial Lineups:** Partial lineups are not allowed — you must fill all 9 starting spots. However, you CAN start players who are on their bye week or who may not play due to injury. "Partial lineup" means having empty roster spots, not starting players who happen to be inactive. Set your lineup every week.

**Divisions:** Northwest (Pacific Pigskins, Da Dangsters, Computer Jocks, Vitside Mafia), Southwest (Dead Cap Walking, The Music City Mafia, Midwestside Connection, Gridiron Geeks), Central (Maverick, The Mariachi Ninjas, Bring the Pain, Cowboy Up), Eastern (Fire Ready Aim, Wascawy Wabbits, Dark Magicians of Chaos, Running Down The Dream).`;

async function callHaiku(question: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    temperature: 0.7,
    system: SYSTEM_PROMPT,
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
