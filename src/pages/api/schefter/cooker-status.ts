/**
 * GET /api/schefter/cooker-status
 *
 * Public (no auth) read of the rumor-mill cook state — used by the tip page
 * to render a "Schefter is marinating 2 tips. Next rumor drops around 8:42pm."
 * countdown card (Phase 8).
 *
 * Body:
 *   {
 *     queueDepth: number,
 *     marinateStartedAt: number | null,
 *     nextEarliestPostAt: number | null,
 *     postsToday: number,
 *     dailyCap: number,
 *     dailyCapHit: boolean,
 *     marinateWindowMs: number,
 *     heat: 'quiet' | 'simmer' | 'rolling' | 'boil' | 'overflow',
 *     backloggedHint: boolean
 *   }
 *
 * `heat` is the soft popularity signal — a tier derived from queueDepth that
 * the tip page renders as a badge so owners can see Schefter heating up
 * without exposing exact counts as the only signal. Thresholds align with
 * the scanner's own pressure points so the public copy stays in sync with
 * the scanner's internal escalation:
 *   - 0           quiet     — empty queue
 *   - 1–3         simmer    — normal trickle
 *   - 4–5         rolling   — secondary-gossip-post pressure (SECONDARY_GOSSIP_POST_PRESSURE)
 *   - 6–9         boil      — gossip cap auto-bumps to 2/day (GOSSIP_BOOST_QUEUE_DEPTH)
 *   - 10+         overflow  — exceeds MAX_TIPS_PER_BATCH; leftovers will roll to next cycle
 *
 * `backloggedHint` is true when heat ∈ {boil, overflow} — the tip page uses
 * it to append a "your tip may marinate longer than usual" note so owners
 * self-throttle without us hard-rejecting on submit.
 *
 * No identity signal — returns counts only. Queue contents are NEVER returned.
 */

import type { APIRoute } from 'astro';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const TIPS_QUEUE_KEY = 'schefter:tips:queue';
const FIRST_TIP_TS_KEY = 'schefter:tips:first_tip_ts';
const RUMOR_POSTS_TODAY_KEY = 'schefter:rumor:posts_today';

const MARINATE_WINDOW_MS = 60 * 60 * 1000;
const DAILY_CAP = 3;

// Heat tier thresholds — kept in sync with the scanner's escalation in
// scripts/schefter-rumor-scan.mjs. Both endpoints read the same Redis list,
// so when scanner-side constants change these MUST move with them.
export const HEAT_SIMMER_MIN = 1;     // 1-3 tips
export const HEAT_ROLLING_MIN = 4;    // SECONDARY_GOSSIP_POST_PRESSURE
export const HEAT_BOIL_MIN = 6;       // GOSSIP_BOOST_QUEUE_DEPTH
export const HEAT_OVERFLOW_MIN = 10;  // MAX_TIPS_PER_BATCH

export type Heat = 'quiet' | 'simmer' | 'rolling' | 'boil' | 'overflow';

export function classifyHeat(queueDepth: number): Heat {
  if (queueDepth >= HEAT_OVERFLOW_MIN) return 'overflow';
  if (queueDepth >= HEAT_BOIL_MIN) return 'boil';
  if (queueDepth >= HEAT_ROLLING_MIN) return 'rolling';
  if (queueDepth >= HEAT_SIMMER_MIN) return 'simmer';
  return 'quiet';
}

// In-process cache. The client polls /api/schefter/cooker-status every 60s
// per open tab; under any concurrency at all we rack up Redis commands fast
// (3 per request: LLEN + 2× GET). Cooker state changes slowly enough that a
// 15-second staleness window is imperceptible to users, and it bounds the
// per-minute Redis cost at 4 reads × 3 commands = 12 commands regardless of
// how many concurrent viewers we have.
const CACHE_TTL_MS = 15_000;
type CookerSnapshot = {
  queueDepth: number;
  marinateStartedAt: number | null;
  nextEarliestPostAt: number | null;
  postsToday: number;
  dailyCap: number;
  dailyCapHit: boolean;
  marinateWindowMs: number;
  heat: Heat;
  backloggedHint: boolean;
};
let _cache: { data: CookerSnapshot; expiresAt: number } | null = null;

type RedisClient = {
  llen: (key: string) => Promise<number>;
  get: <T>(key: string) => Promise<T | null>;
};

let _redis: RedisClient | null | undefined;

async function getRedis(): Promise<RedisClient | null> {
  if (_redis !== undefined) return _redis;
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.STORAGE_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.STORAGE_REST_API_TOKEN;
  if (!url || !token) {
    _redis = null;
    return null;
  }
  try {
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({ url, token }) as unknown as RedisClient;
    return _redis;
  } catch (err) {
    console.warn('[cooker-status] Redis unavailable:', err);
    _redis = null;
    return null;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function coerce(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}

/** Expose cache reset for tests — not wired to anything in production. */
export function _resetCookerCacheForTests(): void {
  _cache = null;
}

export const GET: APIRoute = async () => {
  // Serve from in-process cache when fresh — same-instance concurrent
  // callers share a single Redis read per CACHE_TTL_MS window.
  const now = Date.now();
  if (_cache && _cache.expiresAt > now) {
    return json(_cache.data);
  }

  const redis = await getRedis();
  if (!redis) {
    const empty: CookerSnapshot = {
      queueDepth: 0,
      marinateStartedAt: null,
      nextEarliestPostAt: null,
      postsToday: 0,
      dailyCap: DAILY_CAP,
      dailyCapHit: false,
      marinateWindowMs: MARINATE_WINDOW_MS,
      heat: 'quiet',
      backloggedHint: false,
    };
    // Cache the zero state too — prevents a hot-path of Redis-missing
    // requests from re-running the import every poll.
    _cache = { data: empty, expiresAt: now + CACHE_TTL_MS };
    return json(empty);
  }

  let queueDepth = 0;
  let marinateStartedAt: number | null = null;
  let postsToday = 0;

  try {
    const [len, first, today] = await Promise.all([
      redis.llen(TIPS_QUEUE_KEY),
      redis.get<string | number>(FIRST_TIP_TS_KEY),
      redis.get<string | number>(RUMOR_POSTS_TODAY_KEY),
    ]);
    queueDepth = Math.max(0, Number.isFinite(len) ? (len as number) : 0);
    marinateStartedAt = coerce(first);
    postsToday = Math.max(0, coerce(today) ?? 0);
  } catch (err) {
    console.error('[cooker-status] Read error:', err);
    return json({ error: 'redis_unavailable' }, 503);
  }

  const dailyCapHit = postsToday >= DAILY_CAP;
  const nextEarliestPostAt =
    marinateStartedAt !== null ? marinateStartedAt + MARINATE_WINDOW_MS : null;
  const heat = classifyHeat(queueDepth);
  const backloggedHint = heat === 'boil' || heat === 'overflow';

  const snapshot: CookerSnapshot = {
    queueDepth,
    marinateStartedAt,
    nextEarliestPostAt,
    postsToday,
    dailyCap: DAILY_CAP,
    dailyCapHit,
    marinateWindowMs: MARINATE_WINDOW_MS,
    heat,
    backloggedHint,
  };
  _cache = { data: snapshot, expiresAt: now + CACHE_TTL_MS };
  return json(snapshot);
};
