/**
 * POST /api/schefter/tip
 *
 * Anonymous tip submission to the Schefter Rumor Mill.
 *
 * - Requires auth (franchiseId must resolve from session)
 * - Validates body (text 1–500, topic enum, optional franchiseHint)
 * - Rate-limits to 3 tips per hashed owner per 24h
 * - Pushes a Tip object onto Redis list `schefter:tips:queue` (LPUSH)
 * - Anchors the "marinate" timer via SET NX of `schefter:tips:first_tip_ts`
 *   when the queue transitions from empty, so the scanner waits at least 1h
 *   after the first tip of a batch before posting.
 *
 * Identity handling: the user's id is never persisted. Instead we store
 * `hashedOwnerId = sha256(userId + SCHEFTER_TIPSTER_SALT)` so tips remain
 * anonymous in Redis and in the eventual rumor post, while still supporting
 * per-owner rate limits.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { hashTipsterId } from '../../../utils/schefter-tipster-hash';
import { detectAttackOnSchefter } from '../../../utils/schefter-attack-detection';
import { assignCodename } from '../../../utils/schefter-codenames';
import { getCurrentLeagueYear } from '../../../utils/league-year';
import theLeagueConfig from '../../../data/theleague.config.json';
import {
  TIP_TOPICS,
  TIP_TEXT_MIN,
  TIP_TEXT_MAX,
  LEAGUE_WIDE_HINT,
  COMMISH_HINT,
  WHISPER_BACK_MAX_AGE_MS,
  isFranchiseOnlyTopic,
  type Tip,
  type TipTopic,
} from '../../../types/schefter-tips';
import feedData from '../../../data/theleague/schefter-feed.json';
import type { SchefterFeed } from '../../../types/schefter';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const TIPS_QUEUE_KEY = 'schefter:tips:queue';
const FIRST_TIP_TS_KEY = 'schefter:tips:first_tip_ts';
const RATE_LIMIT_PREFIX = 'schefter:tips:ratelimit:';
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_TTL_SEC = 24 * 60 * 60;

// Anon Style Book keys. Named (GroupMe) attackers live under
// `schefter:style_book:{authorKey}` keyed on the public display name. Anon
// web tippers live here keyed on the tipster hash so the two leaderboards
// never mix and de-anonymization is impossible through the leaderboard.
const STYLE_BOOK_ANON_LIFETIME_PREFIX = 'schefter:style_book:anon:';
const STYLE_BOOK_ANON_SEASON_PREFIX = 'schefter:style_book:anon:season:';
const STYLE_BOOK_ANON_LAST_SHOT_PREFIX = 'schefter:style_book:anon:last_shot_at:';
const STYLE_BOOK_ANON_LEADERBOARD_PREFIX = 'schefter:style_book:anon_leaderboard:';

// Off-topic tip timeline — rolling-window ZSET of "Beef" (commish-scope) tip
// submissions per tipster. The A=C barometer reads the count of entries in
// the last OFF_TOPIC_WINDOW_MS; older entries age out so good behavior (not
// sending mean tips) naturally improves the reading over time.
//
// Powers HARD RULE 16's escalation ladder: first-time / recently-quiet
// tippers get the lighter hissy-fit framing; recent repeat offenders earn
// the "every accusation is a confession" twist. Keyed on hashedOwnerId;
// the rolling count is surfaced to the LLM as offTopicCount.
const OFF_TOPIC_TIMELINE_PREFIX = 'schefter:off_topic:timeline:';
const OFF_TOPIC_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days
const OFF_TOPIC_TIMELINE_TTL_SEC = 90 * 24 * 60 * 60;   // 90d belt-and-suspenders TTL

type RedisClient = {
  lpush: (key: string, ...values: unknown[]) => Promise<number>;
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
  set: (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => Promise<unknown>;
  llen: (key: string) => Promise<number>;
  get: <T>(key: string) => Promise<T | null>;
  zadd: (key: string, entry: { score: number; member: string }) => Promise<unknown>;
  zincrby: (key: string, increment: number, member: string) => Promise<number | string>;
  zremrangebyscore: (key: string, min: number | string, max: number | string) => Promise<unknown>;
  zcard: (key: string) => Promise<number>;
  sadd: (key: string, ...members: string[]) => Promise<number>;
  srem: (key: string, ...members: string[]) => Promise<number>;
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
    console.warn('[schefter/tip] Redis unavailable:', err);
    _redis = null;
    return null;
  }
}

function errorResponse(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: JSON_HEADERS,
  });
}

function resolveDivision(franchiseId: string): string | undefined {
  const teams = (theLeagueConfig as { teams?: Array<{ franchiseId: string; division?: string }> }).teams ?? [];
  const team = teams.find((t) => t.franchiseId === franchiseId);
  return team?.division;
}

function isValidFranchiseId(franchiseId: string): boolean {
  const teams = (theLeagueConfig as { teams?: Array<{ franchiseId: string }> }).teams ?? [];
  return teams.some((t) => t.franchiseId === franchiseId);
}

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
    return errorResponse('unauthorized', 'Authentication required.', 401);
  }
  if (!user.franchiseId) {
    return errorResponse('no_franchise', 'No franchise associated with your account.', 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('bad_json', 'Invalid JSON body.', 400);
  }

  const { text, topic, franchiseHint, repliesToPostId } = (body ?? {}) as {
    text?: unknown;
    topic?: unknown;
    franchiseHint?: unknown;
    repliesToPostId?: unknown;
  };

  if (typeof text !== 'string') {
    return errorResponse('bad_text', 'Tip text is required.', 400);
  }
  const trimmedText = text.trim();
  if (trimmedText.length < TIP_TEXT_MIN) {
    return errorResponse('text_too_short', 'Tip cannot be empty.', 400);
  }
  if (trimmedText.length > TIP_TEXT_MAX) {
    return errorResponse(
      'text_too_long',
      `Tip must be ${TIP_TEXT_MAX} characters or fewer.`,
      400,
    );
  }

  if (typeof topic !== 'string' || !(TIP_TOPICS as readonly string[]).includes(topic)) {
    return errorResponse(
      'bad_topic',
      `Topic must be one of: ${TIP_TOPICS.join(', ')}.`,
      400,
    );
  }

  let normalizedHint: string | undefined;
  let division: string | undefined;
  if (franchiseHint !== undefined && franchiseHint !== null && franchiseHint !== '') {
    if (typeof franchiseHint !== 'string') {
      return errorResponse('bad_hint', 'franchiseHint must be a string.', 400);
    }
    if (franchiseHint === LEAGUE_WIDE_HINT) {
      normalizedHint = LEAGUE_WIDE_HINT;
    } else if (franchiseHint === COMMISH_HINT) {
      if (isFranchiseOnlyTopic(topic)) {
        return errorResponse(
          'bad_hint',
          'The commissioner is not a valid target for trade, draft, or extension tips.',
          400,
        );
      }
      normalizedHint = COMMISH_HINT;
    } else if (isValidFranchiseId(franchiseHint)) {
      normalizedHint = franchiseHint;
      division = resolveDivision(franchiseHint);
    } else {
      return errorResponse('bad_hint', 'Unknown franchise.', 400);
    }
  }

  // Phase 7 — validate whisper-back parent (if supplied). Must be an existing
  // rumor_mill post ≤14 days old. Anything else is rejected early so we don't
  // enqueue orphan tips the scanner would have to drop later.
  let validatedRepliesToPostId: string | undefined;
  if (repliesToPostId !== undefined && repliesToPostId !== null && repliesToPostId !== '') {
    if (typeof repliesToPostId !== 'string') {
      return errorResponse('bad_reply', 'repliesToPostId must be a string.', 400);
    }
    const feed = feedData as SchefterFeed;
    const parent = feed.posts.find((p) => p.id === repliesToPostId);
    if (!parent) {
      return errorResponse('reply_not_found', 'That rumor is not in the feed.', 404);
    }
    if (parent.transactionSubType !== 'rumor_mill') {
      return errorResponse('reply_not_rumor', 'You can only whisper back on rumor posts.', 400);
    }
    const ageMs = Date.now() - new Date(parent.timestamp).getTime();
    if (!Number.isFinite(ageMs) || ageMs > WHISPER_BACK_MAX_AGE_MS) {
      return errorResponse('reply_too_old', 'That rumor is too old to whisper back on.', 400);
    }
    validatedRepliesToPostId = repliesToPostId;
  }

  // Hash identity (throws if salt unset)
  let hashedOwnerId: string;
  try {
    hashedOwnerId = hashTipsterId(user.id);
  } catch (err) {
    console.error('[schefter/tip] Hash error:', err);
    return errorResponse(
      'server_misconfigured',
      'Tip system is not configured. Please notify the commissioner.',
      500,
    );
  }

  const redis = await getRedis();
  if (!redis) {
    return errorResponse(
      'redis_unavailable',
      'Tip system is temporarily unavailable. Try again shortly.',
      503,
    );
  }

  // Rate limit: 3 tips per hashedOwnerId per 24h — applies to everyone,
  // including commissioners/admins. Any surface that exposes a "tips used
  // today" count would otherwise become a de-anonymization oracle for the
  // exempt user (see engagement plan P0).
  const rateKey = `${RATE_LIMIT_PREFIX}${hashedOwnerId}`;
  try {
    const count = await redis.incr(rateKey);
    if (count === 1) {
      await redis.expire(rateKey, RATE_LIMIT_TTL_SEC);
    }
    if (count > RATE_LIMIT_MAX) {
      return errorResponse(
        'rate_limited',
        "You've hit the 3-tips-per-24h cap. Try again tomorrow.",
        429,
      );
    }
  } catch (err) {
    console.error('[schefter/tip] Rate limit error:', err);
    return errorResponse(
      'redis_unavailable',
      'Tip system is temporarily unavailable. Try again shortly.',
      503,
    );
  }

  const tipsterDivision = resolveDivision(user.franchiseId);

  // Style Book — anonymous web-tip path. If the tip text attacks Schefter,
  // bump the anon-leaderboard counters keyed on the hashed owner id. Named
  // GroupMe attackers and anon web attackers live in separate leaderboards
  // (different keyspaces, different Redis ZSETs) so they compete against
  // their own pools. Codenames are resolved at leaderboard-read time via
  // `schefter:tipster:codename:{hash}` so the raw hash never surfaces in any
  // response.
  //
  // Best-effort — a failure here must not block tip enqueue. We null-check
  // `styleBookCount` when stamping the tip so the LLM path degrades gracefully.
  const attackCheck = detectAttackOnSchefter(trimmedText);
  let styleBookCount: number | null = null;
  let tipsterCodename: string | null = null;
  if (attackCheck.attack) {
    try {
      const year = getCurrentLeagueYear();
      const lifetimeKey = `${STYLE_BOOK_ANON_LIFETIME_PREFIX}${hashedOwnerId}`;
      const seasonKey = `${STYLE_BOOK_ANON_SEASON_PREFIX}${year}:${hashedOwnerId}`;
      const lastShotKey = `${STYLE_BOOK_ANON_LAST_SHOT_PREFIX}${hashedOwnerId}`;
      const leaderboardKey = `${STYLE_BOOK_ANON_LEADERBOARD_PREFIX}${year}`;

      await redis.incr(lifetimeKey);
      const seasonRaw = await redis.incr(seasonKey);
      await redis.set(lastShotKey, Date.now());
      // Leaderboard ZSET stores the HASH as member (never surfaced). The
      // response layer resolves to codename via schefter:tipster:codename:{hash}.
      await redis.zincrby(leaderboardKey, 1, hashedOwnerId);

      styleBookCount = typeof seasonRaw === 'number'
        ? seasonRaw
        : parseInt(String(seasonRaw ?? '0'), 10) || 1;

      // Resolve / assign a codename so the LLM has a stable handle to use
      // when referring to this anonymous attacker in posts. assignCodename
      // is idempotent — returns the existing codename if one's already set.
      try {
        tipsterCodename = await assignCodename(redis, hashedOwnerId);
      } catch (err) {
        console.warn('[schefter/tip] codename assign (style-book) failed:', err);
      }
    } catch (err) {
      console.warn('[schefter/tip] anon style-book bump failed:', err);
    }
  }

  // A=C barometer — rolling-window count of "Beef" (commish-scope) tips
  // from this tipster in the last OFF_TOPIC_WINDOW_MS. Older entries age out,
  // so an owner who stops sending mean tips sees their barometer reading
  // naturally drop over 30 days — the dial is controlled by recent behavior,
  // not cumulative lifetime history.
  //
  // Best-effort — Redis failure never blocks enqueue; offTopicCount just
  // stays null and the LLM falls back to rule 16's default (hissy fit only).
  let offTopicCount: number | null = null;
  if (topic === 'commish') {
    try {
      const nowMs = Date.now();
      const timelineKey = `${OFF_TOPIC_TIMELINE_PREFIX}${hashedOwnerId}`;
      const tipMarker = crypto.randomUUID();

      // Add this tip to the timeline + prune anything outside the window +
      // refresh TTL. The TTL is a safety net — if a tipster stops sending
      // entirely, their timeline disappears after 90 days without intervention.
      await redis.zadd(timelineKey, { score: nowMs, member: tipMarker });
      await redis.zremrangebyscore(timelineKey, 0, nowMs - OFF_TOPIC_WINDOW_MS);
      await redis.expire(timelineKey, OFF_TOPIC_TIMELINE_TTL_SEC);

      // The current barometer reading = entries remaining after the prune.
      // ZCOUNT is cheap; we could read from the zadd return but this is
      // more resilient to client-version differences in what zadd returns.
      const cardRaw = await redis.zcard(timelineKey);
      offTopicCount = typeof cardRaw === 'number'
        ? Math.max(1, cardRaw)
        : Math.max(1, parseInt(String(cardRaw ?? '1'), 10) || 1);
    } catch (err) {
      console.warn('[schefter/tip] off-topic timeline bump failed:', err);
    }
  }

  const tip: Tip = {
    id: crypto.randomUUID(),
    hashedOwnerId,
    franchiseHint: normalizedHint,
    division,
    ...(tipsterDivision ? { tipsterDivision } : {}),
    topic: topic as TipTopic,
    text: trimmedText,
    submittedAt: Date.now(),
    source: 'web',
    ...(validatedRepliesToPostId ? { repliesToPostId: validatedRepliesToPostId } : {}),
    ...(offTopicCount !== null ? { offTopicCount } : {}),
    ...(attackCheck.attack
      ? {
          attackOnSchefter: true,
          ...(styleBookCount !== null ? { styleBookCount } : {}),
          ...(tipsterCodename ? { tipsterCodename } : {}),
        }
      : {}),
  };

  try {
    // Check current queue depth BEFORE push so we can anchor the marinate timer
    // only when the queue transitions from empty to non-empty.
    const prevLen = await redis.llen(TIPS_QUEUE_KEY);

    await redis.lpush(TIPS_QUEUE_KEY, JSON.stringify(tip));

    if (prevLen === 0) {
      // First tip of a new batch — start the 1-hour marinate clock. SET NX so
      // a racing request doesn't clobber the anchor if it's already set.
      await redis.set(FIRST_TIP_TS_KEY, Date.now(), { nx: true });
    }

    // Phase 9 — topic timeline. One ZSET per topic, member = tip id (anonymous),
    // score = submit timestamp. Hot-topics endpoint ZCOUNTs over the last 7d.
    // Also prune entries older than 30 days so the sets stay bounded.
    try {
      const timelineKey = `schefter:topic_timeline:${tip.topic}`;
      await redis.zadd(timelineKey, { score: tip.submittedAt, member: tip.id });
      await redis.zremrangebyscore(timelineKey, 0, tip.submittedAt - 30 * 24 * 60 * 60 * 1000);
    } catch (err) {
      console.warn('[schefter/tip] topic timeline write failed:', err);
      // Non-fatal — the tip is already queued.
    }
  } catch (err) {
    console.error('[schefter/tip] Queue write error:', err);
    return errorResponse(
      'redis_unavailable',
      'Tip system is temporarily unavailable. Try again shortly.',
      503,
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: JSON_HEADERS,
  });
};
