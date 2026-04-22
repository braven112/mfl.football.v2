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
const OFFER_FIRST_SEEN_KEY = 'schefter:trade_offers:first_seen';
const OFFER_POSTED_KEY = 'schefter:trade_offers:posted';
const OFFER_OWNER_REPORTS_KEY = 'schefter:trade_offers:owner_reports';
const OFFER_LINGERING_THRESHOLD_MS = 48 * 60 * 60 * 1000;

type RedisClient = {
  llen: (key: string) => Promise<number>;
  zcard: (key: string) => Promise<number>;
  scard: (key: string) => Promise<number>;
  hlen: (key: string) => Promise<number>;
  hgetall: <T = Record<string, unknown>>(key: string) => Promise<T | null>;
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

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
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
    tradeOffersInFlight,
    tradeOffersPosted,
    tradeOffersFirstSeenMap,
    ownerReportsMap,
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
    redis.hlen(OFFER_FIRST_SEEN_KEY).catch(() => 0),
    redis.scard(OFFER_POSTED_KEY).catch(() => 0),
    redis.hgetall<Record<string, string>>(OFFER_FIRST_SEEN_KEY).catch(() => null),
    redis.hgetall<Record<string, unknown>>(OFFER_OWNER_REPORTS_KEY).catch(() => null),
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

  // Bucket in-flight offers by fresh vs lingering (≥48h since first_seen)
  const now = Date.now();
  let offersFresh = 0;
  let offersLingering = 0;
  let oldestOfferAgeMs: number | null = null;
  if (tradeOffersFirstSeenMap && typeof tradeOffersFirstSeenMap === 'object') {
    for (const v of Object.values(tradeOffersFirstSeenMap)) {
      const ts = Number(v);
      if (!Number.isFinite(ts) || ts <= 0) continue;
      const age = now - ts;
      if (age >= OFFER_LINGERING_THRESHOLD_MS) offersLingering += 1;
      else offersFresh += 1;
      if (oldestOfferAgeMs === null || age > oldestOfferAgeMs) oldestOfferAgeMs = age;
    }
  }

  // Owner-sourced reports: count unique offerIds and find the most recent report
  let ownerReportsCount = 0;
  let ownerReportsLastSeenTs: number | null = null;
  let ownerReportsDistinctReporters = 0;
  if (ownerReportsMap && typeof ownerReportsMap === 'object') {
    const reporters = new Set<string>();
    for (const entry of Object.values(ownerReportsMap)) {
      ownerReportsCount += 1;
      const parsed = typeof entry === 'string' ? safeParse(entry) : entry;
      if (!parsed || typeof parsed !== 'object') continue;
      const lastSeen = Number((parsed as { lastSeenAt?: unknown }).lastSeenAt);
      if (Number.isFinite(lastSeen) && (ownerReportsLastSeenTs === null || lastSeen > ownerReportsLastSeenTs)) {
        ownerReportsLastSeenTs = lastSeen;
      }
      const reportedBy = (parsed as { reportedBy?: unknown }).reportedBy;
      if (Array.isArray(reportedBy)) {
        for (const fid of reportedBy) reporters.add(String(fid));
      }
    }
    ownerReportsDistinctReporters = reporters.size;
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
    tradeOffersInFlight,
    tradeOffersPosted,
    tradeOffersFresh: offersFresh,
    tradeOffersLingering: offersLingering,
    tradeOffersOldestAgeMs: oldestOfferAgeMs,
    ownerReportsCount,
    ownerReportsLastSeenTs,
    ownerReportsDistinctReporters,
    tipsterLeaderboardSize,
    tipSourceBreakdown,
    tipSampleSize,
    seasonYear,
  };
}

// ---------------------------------------------------------------------------
// GitHub Actions validation
// ---------------------------------------------------------------------------
// The rumor-mill scanners run in GitHub Actions, not Vercel. To confirm their
// env is wired up we hit the GitHub REST API with a fine-grained PAT scoped to
// Actions:Read + Variables:Read + Secrets:Read on this repo only. Token name
// falls back across the common conventions so either a dedicated admin token
// or a shared GH_TOKEN works.

const GH_REPO = 'braven112/mfl.football.v2';
const GH_VARIABLES_TO_CHECK = [
  'SCHEFTER_RUMOR_MILL_ENABLED',
  'SCHEFTER_TRADE_OFFER_RUMORS_ENABLED',
  'SCHEFTER_TRADE_OFFER_RUMORS_DETECTION_ONLY',
];
const GH_SECRETS_TO_CHECK = [
  'GROUPME_SCHEFTER_BOT_ID',
  'ANTHROPIC_API_KEY',
  'SCHEFTER_TIPSTER_SALT',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'DEPLOY_KEY',
];
const GH_WORKFLOWS_TO_CHECK: Array<{ file: string; label: string }> = [
  { file: 'schefter-rumor-scan.yml', label: 'Rumor Mill Scanner' },
  { file: 'schefter-scan.yml', label: 'Transaction Scanner' },
];

function getGitHubToken(): string | null {
  return (
    process.env.GITHUB_ADMIN_TOKEN ||
    process.env.GH_ADMIN_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    null
  );
}

async function ghFetch(path: string, token: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mfl-admin-dashboard',
    },
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* empty body is fine for 404 */
  }
  return { status: res.status, body };
}

async function checkVariable(name: string, token: string) {
  try {
    const { status, body } = await ghFetch(
      `/repos/${GH_REPO}/actions/variables/${encodeURIComponent(name)}`,
      token,
    );
    if (status === 200) {
      // Value is returned in plaintext for variables (unlike secrets). Mask
      // anything longer than a single token so we don't leak IDs — surface just
      // the first char + length, enough to tell it's not empty.
      const value = typeof body?.value === 'string' ? body.value : '';
      return {
        exists: true,
        preview: value.length <= 8 ? value : `${value.slice(0, 2)}… (${value.length} chars)`,
      };
    }
    if (status === 404) return { exists: false };
    return { error: `HTTP ${status}` };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

async function checkSecret(name: string, token: string) {
  try {
    const { status } = await ghFetch(
      `/repos/${GH_REPO}/actions/secrets/${encodeURIComponent(name)}`,
      token,
    );
    if (status === 200) return { exists: true };
    if (status === 404) return { exists: false };
    if (status === 403) return { error: 'token lacks secrets:read scope' };
    return { error: `HTTP ${status}` };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

async function checkWorkflow(file: string, token: string) {
  try {
    const { status, body } = await ghFetch(
      `/repos/${GH_REPO}/actions/workflows/${encodeURIComponent(file)}/runs?per_page=1`,
      token,
    );
    if (status !== 200) return { error: `HTTP ${status}` };
    const run = body?.workflow_runs?.[0];
    if (!run) return { found: false };
    return {
      found: true,
      runId: run.id,
      conclusion: run.conclusion,
      status: run.status,
      createdAt: run.created_at,
      runStartedAt: run.run_started_at,
      htmlUrl: run.html_url,
      event: run.event,
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

async function readGitHubStats() {
  const token = getGitHubToken();
  if (!token) {
    return {
      tokenConfigured: false,
      hint:
        'Set a fine-grained PAT on Vercel as GITHUB_ADMIN_TOKEN with permissions Actions:Read + Variables:Read + Secrets:Read scoped to this repo.',
    };
  }

  const [variables, secrets, workflows] = await Promise.all([
    Promise.all(
      GH_VARIABLES_TO_CHECK.map(async (name) => [name, await checkVariable(name, token)] as const),
    ),
    Promise.all(
      GH_SECRETS_TO_CHECK.map(async (name) => [name, await checkSecret(name, token)] as const),
    ),
    Promise.all(
      GH_WORKFLOWS_TO_CHECK.map(async (wf) => ({
        ...wf,
        run: await checkWorkflow(wf.file, token),
      })),
    ),
  ]);

  return {
    tokenConfigured: true,
    repo: GH_REPO,
    variables: Object.fromEntries(variables),
    secrets: Object.fromEntries(secrets),
    workflows,
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

  const vercelEnv = {
    groupmeTokenConfigured: !!process.env.GROUPME_SERVICE_TOKEN,
    anthropicKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
    tipsterSaltConfigured: !!process.env.SCHEFTER_TIPSTER_SALT,
    upstashConfigured:
      !!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
      !!(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN),
  };

  const github = await readGitHubStats().catch((err) => {
    console.error('[admin/schefter-stats] GitHub read error:', err);
    return { tokenConfigured: false, error: (err as Error).message };
  });

  return json({
    generatedAt: Date.now(),
    redis: redisStats,
    redisAvailable: !!redis,
    feed: feedStats,
    vercelEnv,
    github,
  });
};
