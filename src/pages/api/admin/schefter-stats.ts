/**
 * GET /api/admin/schefter-stats
 *
 * Commissioner-only read of every counter that proves the rumor mill is
 * working. Pulls live state from Redis (queue depth, posts-today, GroupMe
 * message cache, tipster leaderboards, trade-offer tracking) and derives
 * counts from the Schefter feed JSON (pending-trade announcements, rumor
 * posts by author, post totals).
 *
 * No mutations. Safe to poll.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../../utils/auth';
import feedData from '../../../data/theleague/schefter-feed.json';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const TIPS_QUEUE_KEY = 'schefter:tips:queue';
const TIPS_PROCESSED_KEY = 'schefter:tips:processed';
const FIRST_TIP_TS_KEY = 'schefter:tips:first_tip_ts';
const RUMOR_POSTS_TODAY_KEY = 'schefter:rumor:posts_today';
const RUMOR_LAST_POST_TS_KEY = 'schefter:rumor:last_post_ts';

const GROUPME_MESSAGES_KEY = 'groupme:messages';
const GROUPME_LAST_MESSAGE_ID_KEY = 'groupme:last_message_id';
const GROUPME_LAST_SYNC_KEY = 'groupme:last_sync_ts';

const OFFER_SEEN_KEY = 'schefter:trade_offers:seen';

type RedisClient = {
  llen: (key: string) => Promise<number>;
  zcard: (key: string) => Promise<number>;
  get: <T = unknown>(key: string) => Promise<T | null>;
  lrange: <T = string>(key: string, start: number, stop: number) => Promise<T[]>;
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
    console.warn('[admin/schefter-stats] Redis unavailable:', err);
    _redis = null;
    return null;
  }
}

function coerce(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

type FeedPost = {
  id: string;
  timestamp: string;
  type?: string;
  transactionSubType?: string;
  tier?: string;
  headline?: string;
  authorId?: string;
  franchiseIds?: string[];
  league?: string;
};

type FeedShape = {
  lastScanTimestamp?: string;
  lastProcessedMflTimestamp?: string;
  pendingTradeWatermark?: string[];
  posts?: FeedPost[];
};

function deriveFeedStats(feed: FeedShape) {
  const posts = Array.isArray(feed.posts) ? feed.posts : [];
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const postTs = (p: FeedPost) => {
    const t = Date.parse(p.timestamp);
    return Number.isFinite(t) ? t : 0;
  };

  const byAuthor: Record<string, number> = {};
  const bySubType: Record<string, number> = {};
  const byType: Record<string, number> = {};

  let rumorMillTotal = 0;
  let rumorMill7d = 0;
  let rumorMill24h = 0;
  let pendingTradeTotal = 0;
  let pendingTrade7d = 0;
  let tradeCompletedTotal = 0;
  let claudeAuthoredTotal = 0;

  for (const p of posts) {
    const ts = postTs(p);
    const ageMs = now - ts;
    if (p.authorId) byAuthor[p.authorId] = (byAuthor[p.authorId] || 0) + 1;
    if (p.type) byType[p.type] = (byType[p.type] || 0) + 1;
    if (p.transactionSubType) {
      bySubType[p.transactionSubType] = (bySubType[p.transactionSubType] || 0) + 1;
    }

    if (p.transactionSubType === 'rumor_mill') {
      rumorMillTotal += 1;
      if (ageMs <= 7 * day) rumorMill7d += 1;
      if (ageMs <= day) rumorMill24h += 1;
    }
    if (p.transactionSubType === 'TRADE_PENDING') {
      pendingTradeTotal += 1;
      if (ageMs <= 7 * day) pendingTrade7d += 1;
    }
    if (p.transactionSubType === 'TRADE') tradeCompletedTotal += 1;
    if (p.authorId === 'claude') claudeAuthoredTotal += 1;
  }

  const watermark = Array.isArray(feed.pendingTradeWatermark)
    ? feed.pendingTradeWatermark.length
    : 0;

  return {
    postsTotal: posts.length,
    byAuthor,
    bySubType,
    byType,
    rumorMillTotal,
    rumorMill7d,
    rumorMill24h,
    pendingTradeTotal,
    pendingTrade7d,
    tradeCompletedTotal,
    claudeAuthoredTotal,
    pendingTradeWatermarkSize: watermark,
    lastScanTimestamp: feed.lastScanTimestamp || null,
    lastProcessedMflTimestamp: feed.lastProcessedMflTimestamp || null,
  };
}

async function readRedisStats(redis: RedisClient) {
  const seasonYear = new Date().getUTCFullYear();

  const [
    queueDepth,
    processedArchive,
    marinateStartedAt,
    postsToday,
    lastRumorPostTs,
    groupmeMessages,
    groupmeLastMessageId,
    groupmeLastSync,
    tradeOffersSeen,
    tipsterLeaderboardSize,
  ] = await Promise.all([
    redis.llen(TIPS_QUEUE_KEY).catch(() => 0),
    redis.llen(TIPS_PROCESSED_KEY).catch(() => 0),
    redis.get<string | number>(FIRST_TIP_TS_KEY).catch(() => null),
    redis.get<string | number>(RUMOR_POSTS_TODAY_KEY).catch(() => null),
    redis.get<string | number>(RUMOR_LAST_POST_TS_KEY).catch(() => null),
    redis.zcard(GROUPME_MESSAGES_KEY).catch(() => 0),
    redis.get<string>(GROUPME_LAST_MESSAGE_ID_KEY).catch(() => null),
    redis.get<string | number>(GROUPME_LAST_SYNC_KEY).catch(() => null),
    redis.zcard(OFFER_SEEN_KEY).catch(() => 0),
    redis.zcard(`schefter:tipster:leaderboard:${seasonYear}`).catch(() => 0),
  ]);

  // Sample the processed archive to break down tip sources (web vs groupme vs trade_offer)
  let tipSourceBreakdown: Record<string, number> = { web: 0, groupme: 0, trade_offer: 0, unknown: 0 };
  let tipSampleSize = 0;
  try {
    const sample = await redis.lrange<string>(TIPS_PROCESSED_KEY, 0, 199);
    for (const raw of sample) {
      tipSampleSize += 1;
      try {
        const tip = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const src = tip?.source || 'unknown';
        tipSourceBreakdown[src] = (tipSourceBreakdown[src] || 0) + 1;
      } catch {
        tipSourceBreakdown.unknown += 1;
      }
    }
  } catch (err) {
    console.warn('[admin/schefter-stats] processed archive read failed:', err);
  }

  return {
    queueDepth,
    processedArchiveDepth: processedArchive,
    marinateStartedAt: coerce(marinateStartedAt),
    postsToday: Math.max(0, coerce(postsToday) ?? 0),
    lastRumorPostTs: coerce(lastRumorPostTs),
    groupmeMessagesCached: groupmeMessages,
    groupmeLastMessageId: groupmeLastMessageId || null,
    groupmeLastSyncTs: coerce(groupmeLastSync),
    tradeOffersSeen,
    tipsterLeaderboardSize,
    tipSourceBreakdown,
    tipSampleSize,
    seasonYear,
  };
}

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user || !isCommissionerOrAdmin(user)) {
    return json({ error: 'forbidden' }, 403);
  }

  const feedStats = deriveFeedStats(feedData as FeedShape);

  const redis = await getRedis();
  const redisStats = redis
    ? await readRedisStats(redis).catch((err) => {
        console.error('[admin/schefter-stats] Redis read error:', err);
        return null;
      })
    : null;

  const envFlags = {
    rumorMillEnabled: !!process.env.SCHEFTER_RUMOR_MILL_ENABLED,
    groupmeBotConfigured: !!process.env.GROUPME_SCHEFTER_BOT_ID,
    groupmeTokenConfigured: !!process.env.GROUPME_SERVICE_TOKEN,
    anthropicKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
    tipsterSaltConfigured: !!process.env.SCHEFTER_TIPSTER_SALT,
  };

  return json({
    generatedAt: Date.now(),
    redis: redisStats,
    redisAvailable: !!redis,
    feed: feedStats,
    env: envFlags,
  });
};
