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
import { incrementNamingTarget } from '../../../../scripts/lib/schefter-naming-rate-limit.mjs';
import {
  resolveSchefterLeague,
  getSchefterFeed,
  findLeagueTeam,
  leagueHasSchefterTips,
  schefterSeasonYear,
} from '../../../utils/schefter-league';
import {
  normalizeTopicId,
  getTopicIds,
  getTopicPolicy,
} from '../../../config/schefter-topics.mjs';
import {
  TIP_TEXT_MIN,
  TIP_TEXT_MAX,
  LEAGUE_WIDE_HINT,
  COMMISH_HINT,
  WHISPER_BACK_MAX_AGE_MS,
  type Tip,
  type TipTopic,
} from '../../../types/schefter-tips';
import { getRedis } from '../../../utils/redis-client';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../../utils/api-response';
import { schefterKey } from '../../../../scripts/lib/schefter-keys.mjs';

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_TTL_SEC = 24 * 60 * 60;

// Anon Style Book keys. Named (GroupMe) attackers live under
// `schefter:style_book:{authorKey}` keyed on the public display name. Anon
// web tippers live here keyed on the tipster hash so the two leaderboards
// never mix and de-anonymization is impossible through the leaderboard.
// (League-scoped via schefterKey(league.navSlug, …) inside the handler.)

// Off-topic tip timeline — rolling-window ZSET of "Beef" (commish-scope) tip
// submissions per tipster. The A=C barometer reads the count of entries in
// the last OFF_TOPIC_WINDOW_MS; older entries age out so good behavior (not
// sending mean tips) naturally improves the reading over time.
//
// Powers HARD RULE 16's escalation ladder: first-time / recently-quiet
// tippers get the lighter hissy-fit framing; recent repeat offenders earn
// the "every accusation is a confession" twist. Keyed on hashedOwnerId;
// the rolling count is surfaced to the LLM as offTopicCount.
const OFF_TOPIC_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days
const OFF_TOPIC_TIMELINE_TTL_SEC = 90 * 24 * 60 * 60;   // 90d belt-and-suspenders TTL

function errorResponse(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: JSON_HEADERS,
  });
}

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
    return errorResponse('unauthorized', 'Authentication required.', 401);
  }
  if (!user.franchiseId) {
    return errorResponse('no_franchise', 'No franchise associated with your account.', 403);
  }

  // League comes from the session JWT — an AFL session cannot write into
  // TheLeague's queue (and vice versa). No URL change for existing clients.
  const league = resolveSchefterLeague({ user, url: new URL(request.url) });
  if (!league) {
    return errorResponse('bad_league', 'Unknown league.', 400);
  }
  if (!leagueHasSchefterTips(league)) {
    return errorResponse('feature_disabled', 'The tip line is not open for this league.', 404);
  }
  const navSlug = league.navSlug;
  const k = (suffix: string) => schefterKey(navSlug, suffix);

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

  const normalizedTopic =
    typeof topic === 'string' ? normalizeTopicId(topic, navSlug) : null;
  if (!normalizedTopic) {
    return errorResponse(
      'bad_topic',
      `Topic must be one of: ${getTopicIds(navSlug).join(', ')}.`,
      400,
    );
  }
  const topicPolicy = getTopicPolicy(normalizedTopic, navSlug);

  let normalizedHint: string | undefined;
  let division: string | undefined;
  if (franchiseHint !== undefined && franchiseHint !== null && franchiseHint !== '') {
    if (typeof franchiseHint !== 'string') {
      return errorResponse('bad_hint', 'franchiseHint must be a string.', 400);
    }
    if (franchiseHint === LEAGUE_WIDE_HINT) {
      normalizedHint = LEAGUE_WIDE_HINT;
    } else if (franchiseHint === COMMISH_HINT) {
      if (!topicPolicy.commishTargetAllowed) {
        return errorResponse('bad_hint', 'The commissioner is not a valid target for this topic.', 400);
      }
      normalizedHint = COMMISH_HINT;
    } else if (findLeagueTeam(league, franchiseHint)) {
      normalizedHint = franchiseHint;
      division = findLeagueTeam(league, franchiseHint)?.division;
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
    const feed = getSchefterFeed(league);
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
  const rateKey = `${k('tips:ratelimit:')}${hashedOwnerId}`;
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

  const tipsterDivision = findLeagueTeam(league, user.franchiseId)?.division;

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
      const year = schefterSeasonYear(league);
      const lifetimeKey = `${k('style_book:anon:')}${hashedOwnerId}`;
      const seasonKey = `${k('style_book:anon:season:')}${year}:${hashedOwnerId}`;
      const lastShotKey = `${k('style_book:anon:last_shot_at:')}${hashedOwnerId}`;
      const leaderboardKey = `${k('style_book:anon_leaderboard:')}${year}`;

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
        tipsterCodename = await assignCodename(redis, hashedOwnerId, navSlug);
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
  // 'frontoffice' succeeded the legacy 'commish' ("Beef") topic — the
  // barometer keeps counting the same behavioral lane under the new id.
  if (normalizedTopic === 'frontoffice') {
    try {
      const nowMs = Date.now();
      const timelineKey = `${k('off_topic:timeline:')}${hashedOwnerId}`;
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

  // Naming rate limiter — when the tipster picked a real franchise from the
  // dropdown, increment the per-(tipster, target) counter that the scanner
  // uses to decide whether this tip unlocks direct naming (under cap) or
  // silently demotes to division-fuzz (over cap). Best-effort: a Redis
  // failure here must not block tip submission — the tip still queues, the
  // scanner just falls back to division-fuzz when it can't read the counter.
  if (
    normalizedHint &&
    normalizedHint !== LEAGUE_WIDE_HINT &&
    normalizedHint !== COMMISH_HINT
  ) {
    try {
      await incrementNamingTarget(hashedOwnerId, normalizedHint, redis, navSlug);
    } catch (err) {
      console.warn('[schefter/tip] naming rate-limit increment failed:', err);
    }
  }

  const tip: Tip = {
    id: crypto.randomUUID(),
    hashedOwnerId,
    franchiseHint: normalizedHint,
    division,
    ...(tipsterDivision ? { tipsterDivision } : {}),
    topic: normalizedTopic as TipTopic,
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
    const prevLen = await redis.llen(k('tips:queue'));

    await redis.lpush(k('tips:queue'), JSON.stringify(tip));

    if (prevLen === 0) {
      // First tip of a new batch — start the 1-hour marinate clock. SET NX so
      // a racing request doesn't clobber the anchor if it's already set.
      await redis.set(k('tips:first_tip_ts'), Date.now(), { nx: true });
    }

    // Phase 9 — topic timeline. One ZSET per topic, member = tip id (anonymous),
    // score = submit timestamp. Hot-topics endpoint ZCOUNTs over the last 7d.
    // Also prune entries older than 30 days so the sets stay bounded.
    try {
      const timelineKey = `${k('topic_timeline:')}${tip.topic}`;
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
