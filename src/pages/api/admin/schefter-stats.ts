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
import leagueConfig from '../../../data/theleague.config.json';
import { parseAssets } from '../../../utils/trade-asset-parsing';
import { getPlayerMap } from '../../../utils/player-map';
import { getCurrentLeagueYear } from '../../../utils/league-year';

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
const OFFER_ARCHIVE_KEY = 'schefter:trade_offers:archive';
const OFFER_ROLLS_KEY = 'schefter:trade_offers:rolls';
const OFFER_EXPOSURE_KEY = 'schefter:trade_offers:exposure';
const OFFER_LINGERING_THRESHOLD_MS = 48 * 60 * 60 * 1000;

type RedisClient = {
  llen: (key: string) => Promise<number>;
  zcard: (key: string) => Promise<number>;
  scard: (key: string) => Promise<number>;
  hlen: (key: string) => Promise<number>;
  hgetall: <T = Record<string, unknown>>(key: string) => Promise<T | null>;
  get: <T = unknown>(key: string) => Promise<T | null>;
  lrange: <T = string>(key: string, start: number, stop: number) => Promise<T[]>;
  zrange: <T = string>(key: string, min: number, max: number, opts?: { rev?: boolean }) => Promise<T[]>;
  smembers: <T = string>(key: string) => Promise<T[]>;
};

// Imported from the scanner's shared lib so the admin preview matches the
// scanner's bucket selection exactly. Both consumers must agree.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — .mjs via allowJs
import {
  buildTopicBuckets,
  bucketPriorityScore,
  rankBuckets,
  isBucketStale,
  bucketStreakLength,
} from '../../../../scripts/lib/schefter-bucket-logic.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — .mjs via allowJs
import { isoWeekLabel } from '../../../../scripts/lib/schefter-recurrence-ledger.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — .mjs via allowJs
import { buildTipsterContext } from '../../../../scripts/lib/schefter-tipster-context.mjs';
// Static JSON import — the scanner commits this file each run, and Vercel
// redeploys on push, so the admin preview lags by at most one scanner cycle.
// That's acceptable: the staleness flag is informational, not a gate.
import recurrenceLedger from '../../../../data/schefter/topic-recurrence.json';
// Reuse the listener's exact mention regex so the admin's "schefterDetected"
// flag matches what the live scanner would have done with the same text.
// Native-reply detection isn't reproducible here (it requires the bot-message
// id cache), so reply-routed pickups may show as "no match" — that's a
// deliberate, conservative undercount.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — .mjs via allowJs
import { detectMention } from '../../../../scripts/schefter-groupme-listen.mjs';

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

// Module-level team lookup (franchiseId → {name, abbrev, nameShort}). Same
// shape the live trades endpoint exposes — we're rendering the same kind
// of card, just for offers MFL no longer lists.
const teamLookup = new Map<string, { name: string; abbrev: string; nameShort: string }>();
for (const team of (leagueConfig as { teams?: Array<{ franchiseId: string; name?: string; abbrev?: string; nameShort?: string }> }).teams ?? []) {
  if (team.franchiseId) {
    teamLookup.set(team.franchiseId, {
      name: team.name || '',
      abbrev: team.abbrev || '',
      nameShort: team.nameShort || '',
    });
  }
}

type ResolvedArchiveAsset = { type: 'player' | 'pick' | 'bbid'; label: string; position?: string };

/**
 * Resolve a raw MFL asset string into human-readable labels for the admin
 * archive view. Mirrors the live-trades endpoint's resolver but trimmed:
 * we only need the label + position, not full ESPN/headshot wiring.
 */
function resolveArchiveAssets(
  assetString: string,
  playerMap: Map<string, { name: string; position: string; team: string }>,
): ResolvedArchiveAsset[] {
  const { playerIds, draftPicks, blindBid } = parseAssets(assetString);
  const resolved: ResolvedArchiveAsset[] = [];
  for (const id of playerIds) {
    const p = playerMap.get(id);
    if (p) resolved.push({ type: 'player', label: p.name, position: p.position });
    else resolved.push({ type: 'player', label: `Unknown Player (${id})` });
  }
  for (const code of draftPicks) {
    if (code.startsWith('FP_')) {
      const parts = code.split('_');
      const franchise = parts[1];
      const yr = parts[2];
      const round = parts[3];
      const team = teamLookup.get(franchise);
      const via = team ? ` (via ${team.abbrev || team.nameShort})` : '';
      resolved.push({ type: 'pick', label: `${yr} Rd ${round}${via}` });
    } else if (code.startsWith('DP_')) {
      const round = parseInt(code.split('_')[1], 10) + 1;
      resolved.push({ type: 'pick', label: `Current Rd ${round}` });
    }
  }
  if (blindBid !== null) {
    const formatted = blindBid >= 1_000_000
      ? `$${(blindBid / 1_000_000).toFixed(1)}M`
      : `$${Math.round(blindBid / 1_000).toLocaleString()}K`;
    resolved.push({ type: 'bbid', label: `${formatted} BBID` });
  }
  return resolved;
}

/**
 * Build offerId → {postId, postTimestamp} index from the static feed JSON.
 * Trade-offer rumors carry tip ids of the form `to_<offerId>` (set by
 * `scripts/lib/redact-trade-offer.mjs`) — when the scanner promotes a tip
 * to a published post the original tipId rides through into `post.tipIds`.
 */
function buildOfferToPostIndex(): Map<string, { postId: string; postTimestamp: string }> {
  const index = new Map<string, { postId: string; postTimestamp: string }>();
  const posts = (feedData as { posts?: Array<{ id?: unknown; timestamp?: unknown; tipIds?: unknown }> }).posts ?? [];
  for (const post of posts) {
    if (!post || typeof post !== 'object') continue;
    const tipIds = Array.isArray(post.tipIds) ? post.tipIds : [];
    for (const raw of tipIds) {
      if (typeof raw !== 'string' || !raw.startsWith('to_')) continue;
      const offerId = raw.slice(3);
      if (!offerId || index.has(offerId)) continue;
      index.set(offerId, {
        postId: typeof post.id === 'string' ? post.id : '',
        postTimestamp: typeof post.timestamp === 'string' ? post.timestamp : '',
      });
    }
  }
  return index;
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
  tipIds?: string[];
};

export type ChannelKey = 'groupme' | 'web' | 'trade';

export type ChannelCounts = { groupme: number; web: number; trade: number; total: number };

function emptyChannelCounts(): ChannelCounts {
  return { groupme: 0, web: 0, trade: 0, total: 0 };
}

/**
 * Infer the byline channel for a published feed post. Returns null for posts
 * that are NOT Schefter byline content (wire/external/ESPN syndication and
 * completed-trade announcements that aren't proposal-driven). Those posts
 * don't belong in the "what feeds Schefter's GroupMe posts?" rollup —
 * including them swamps the meaningful signal with ESPN noise.
 *
 * Tip-ID prefixes (set by their respective producers):
 *   `gm_<msgId>`  — GroupMe listener (`scripts/schefter-groupme-listen.mjs`)
 *   `to_<offerId>`— Trade-offer detector (`scripts/lib/redact-trade-offer.mjs`)
 *   UUID          — Anonymous web tip form (`/api/schefter-tip`)
 *
 * A `rumor_mill` post is keyed by the FIRST identifying prefix in its
 * tipIds array, in priority order: trade > groupme > web. That priority
 * matters for multi-source posts (a rumor synthesized from a trade-offer
 * tip + a web tip should count as Trade — the trade signal is the more
 * load-bearing one).
 */
function inferChannel(p: FeedPost): ChannelKey | null {
  const sub = p.transactionSubType;
  const tipIds = Array.isArray(p.tipIds) ? p.tipIds : [];
  const hasTradeOffer = tipIds.some((id) => typeof id === 'string' && id.startsWith('to_'));
  const hasGm = tipIds.some((id) => typeof id === 'string' && id.startsWith('gm_'));
  if (sub === 'rumor_mill') {
    if (hasTradeOffer) return 'trade';
    if (hasGm) return 'groupme';
    return 'web';
  }
  if (sub === 'TRADE_PENDING') return 'trade';
  return null;
}

/**
 * Map a queue tip's `source` to a byline channel for the "Coming Next"
 * preview. `trade_offer` is the only real-proposal source — `trade_bait`
 * (player-listed-as-available rumors) is gossip-grade and lumps with web.
 */
function inferTipChannel(source: unknown): ChannelKey {
  if (source === 'groupme') return 'groupme';
  if (source === 'trade_offer') return 'trade';
  return 'web';
}

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

  const channelMix7d = emptyChannelCounts();
  const channelMixAllTime = emptyChannelCounts();
  const lastPostByChannel: Record<ChannelKey, number | null> = {
    groupme: null, web: null, trade: null,
  };
  // Map: GroupMe message id (without `gm_` prefix) → published post id.
  // Used by the admin client to flip GroupMe stream pills to "posted".
  const postedGmIdToPostId: Record<string, string> = {};

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

    const channel = inferChannel(p);
    if (channel) {
      channelMixAllTime[channel] += 1;
      channelMixAllTime.total += 1;
      if (ageMs <= 7 * day) {
        channelMix7d[channel] += 1;
        channelMix7d.total += 1;
      }
      if (ts && (lastPostByChannel[channel] === null || ts > (lastPostByChannel[channel] as number))) {
        lastPostByChannel[channel] = ts;
      }
    }

    if (Array.isArray(p.tipIds)) {
      for (const tid of p.tipIds) {
        if (typeof tid === 'string' && tid.startsWith('gm_')) {
          const msgId = tid.slice(3);
          // First wins on collision. The posts array is iterated in file
          // order — we don't sort by timestamp — so the "first" post is
          // whichever happens to come first in the JSON. Either match is
          // truthful (the message did become a post); the user-visible
          // effect of a collision is just which post the link goes to.
          if (msgId && !postedGmIdToPostId[msgId]) postedGmIdToPostId[msgId] = p.id;
        }
      }
    }
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
    channelMix: {
      windows: { '7d': channelMix7d, allTime: channelMixAllTime },
      lastPostByChannel,
    },
    postedGmIdToPostId,
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
    tradeOffersPostedMembers,
    tradeOffersArchiveMap,
    tradeOffersRollsMap,
    tradeOffersExposureMap,
    ownerReportsMap,
    pendingTipsRaw,
    recentGroupMeRaw,
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
    redis.smembers<string>(OFFER_POSTED_KEY).catch(() => [] as string[]),
    redis.hgetall<Record<string, string>>(OFFER_ARCHIVE_KEY).catch(() => null),
    redis.hgetall<Record<string, string>>(OFFER_ROLLS_KEY).catch(() => null),
    redis.hgetall<Record<string, string>>(OFFER_EXPOSURE_KEY).catch(() => null),
    redis.hgetall<Record<string, unknown>>(OFFER_OWNER_REPORTS_KEY).catch(() => null),
    // Pull the actual queue contents (not just LLEN) so the admin page can
    // render a "what's next to post" list. Cap at 50 — the queue rarely
    // grows past a handful, and 50 is a safe upper bound for payload size.
    redis.lrange<string>(TIPS_QUEUE_KEY, 0, 49).catch(() => [] as string[]),
    // Pull the recent GroupMe message cache so the admin can see every
    // message that came through the chat — both the ones Schefter detected
    // and the ones he ignored. Cap at 50; the cache itself holds 500.
    redis.zrange<string>(GROUPME_MESSAGES_KEY, 0, 49, { rev: true }).catch(() => [] as string[]),
  ]);

  // Parse the queue snapshot into admin-safe tip objects. We strip the
  // hashedOwnerId — admins should never see that field; it's a stable
  // identifier across tips and would let the commish de-anonymize a web
  // tipster across a session. Everything else (text, source, author,
  // submittedAt, attackOnSchefter, etc.) is fine to surface.
  //
  // We also keep a SERVER-ONLY copy of the tips with their hashedOwnerIds
  // intact so we can compute the tipsterContext used by the priority
  // preview below — bucketPriorityScore needs the hashes to apply the
  // feature-1 recency weighting. The hashes never leave this handler; only
  // the priorityScore integer ends up in the response.
  const pendingTips: Array<Record<string, unknown>> = [];
  const pendingTipsWithHashes: Array<Record<string, unknown>> = [];
  for (const raw of pendingTipsRaw ?? []) {
    try {
      const tip = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (tip && typeof tip === 'object') {
        const rec = tip as Record<string, unknown>;
        pendingTipsWithHashes.push(rec);
        const { hashedOwnerId: _hid, ...safe } = rec;
        pendingTips.push(safe);
      }
    } catch {
      // Skip unparseable entries — shouldn't happen but degrade gracefully.
    }
  }
  // Order oldest-first (next to post — they've marinated longest).
  pendingTips.sort((a, b) => {
    const ax = typeof a.submittedAt === 'number' ? a.submittedAt : 0;
    const bx = typeof b.submittedAt === 'number' ? b.submittedAt : 0;
    return ax - bx;
  });

  // Queue composition by byline channel — what's actually feeding the next
  // post(s). This is the most operationally important number on the page:
  // a Schefter byline post is forming any moment, and the commish wants to
  // know which lane is supplying it. `trade_offer` is the only "real
  // proposal" source; `trade_bait` (player-listed-as-available) is gossip
  // and folds into the web lane.
  const queueChannelMix: ChannelCounts = emptyChannelCounts();
  for (const tip of pendingTips) {
    const ch = inferTipChannel((tip as { source?: unknown }).source);
    queueChannelMix[ch] += 1;
    queueChannelMix.total += 1;
  }

  // Recent GroupMe messages — latest 50, newest first. Surface as-is so the
  // admin can scan the chat stream and see which messages Schefter picked
  // up vs. ignored. We cross-reference against pendingTips below so the
  // page can mark messages already enqueued as tips. We also re-run the
  // listener's mention regex here so each cached message gets a
  // `schefterDetected` flag — that's how the client distinguishes "expired"
  // (was eligible, aged out) from "no match" (regex never fired).
  const recentGroupMe: Array<Record<string, unknown>> = [];
  for (const raw of recentGroupMeRaw ?? []) {
    try {
      const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (msg && typeof msg === 'object') {
        const text = typeof (msg as { text?: unknown }).text === 'string' ? (msg as { text: string }).text : '';
        let schefterDetected = false;
        try {
          const det = detectMention(text);
          schefterDetected = !!(det && det.match);
        } catch {
          // Defensive — never let a regex error break the admin endpoint.
        }
        recentGroupMe.push({ ...(msg as Record<string, unknown>), schefterDetected });
      }
    } catch {
      // Skip unparseable entries.
    }
  }

  // Predicted post order — runs the same bucket logic the scanner uses,
  // so the admin sees an honest preview of the next post(s). Trade buckets
  // win first (always), then gossip buckets sorted by descending
  // priorityScore (size + age boost + tipster-context delta). The first
  // entry is what the next scanner cycle would pick if marinate + cap
  // gates pass.
  //
  // Feature 1 wiring: build the same tipsterContext the scanner uses, off
  // the server-only `pendingTipsWithHashes` copy. Without this, the admin
  // priority preview would silently disagree with the scanner once a
  // first-time voice or burst regular hits the queue — that drift
  // confused real ops debugging in the pre-feature-1 era.
  //
  // Each entry also carries staleStreakWeeks + isStale so the admin can
  // see which buckets the scanner is deferring to Friday's mailbag. A
  // streak of 3+ weeks (isStale === true) means "old news" — the scanner
  // skips it from the normal lane until a quiet week breaks the run.
  const previewNow = new Date();
  const currentIsoWeek = isoWeekLabel(previewNow);
  let tipsterContext: Map<string, unknown> = new Map();
  try {
    tipsterContext = await buildTipsterContext(pendingTipsWithHashes, redis);
  } catch (err) {
    console.warn('[admin/schefter-stats] tipster context build failed:', err);
    tipsterContext = new Map();
  }
  // Topic buckets need the hashedOwnerIds for the tipster delta to apply,
  // but the buckets array itself never crosses the response boundary —
  // it's iterated in place and only the projected fields below ship.
  const previewBuckets = buildTopicBuckets(pendingTipsWithHashes);
  const ranked = rankBuckets(previewBuckets, previewNow, tipsterContext);
  const predictedPostOrder = ranked.map((b: { key: string; kind: string; tips: unknown[]; oldestSubmittedAt: number }) => ({
    key: b.key,
    kind: b.kind,
    tipCount: b.tips.length,
    tipIds: (b.tips as Array<{ id?: unknown }>).map((t) => (typeof t.id === 'string' ? t.id : null)).filter((x): x is string => !!x),
    oldestSubmittedAt: b.oldestSubmittedAt,
    priorityScore: bucketPriorityScore(b, previewNow, tipsterContext),
    staleStreakWeeks: bucketStreakLength(b, recurrenceLedger, currentIsoWeek),
    isStale: isBucketStale(b, recurrenceLedger, currentIsoWeek),
  }));

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

  // Bucket in-flight offers by fresh vs lingering (≥48h since first_seen).
  // Also build a per-offer list so the admin can SEE which offerIds are
  // tracked. Without the list, a stat like "5 in-flight, 9.8d oldest age"
  // is impossible to reconcile against the live MFL pendingTrades feed —
  // the commish can't tell which ones are stale (no longer open in MFL).
  const now = Date.now();
  let offersFresh = 0;
  let offersLingering = 0;
  let oldestOfferAgeMs: number | null = null;
  const postedSet = new Set(Array.isArray(tradeOffersPostedMembers) ? tradeOffersPostedMembers.map(String) : []);
  const tradeOffersInFlightList: Array<{
    offerId: string;
    firstSeenMs: number;
    ageMs: number;
    lingering: boolean;
    posted: boolean;
  }> = [];
  if (tradeOffersFirstSeenMap && typeof tradeOffersFirstSeenMap === 'object') {
    for (const [offerId, v] of Object.entries(tradeOffersFirstSeenMap)) {
      const ts = Number(v);
      if (!Number.isFinite(ts) || ts <= 0) continue;
      const age = now - ts;
      const lingering = age >= OFFER_LINGERING_THRESHOLD_MS;
      if (lingering) offersLingering += 1;
      else offersFresh += 1;
      if (oldestOfferAgeMs === null || age > oldestOfferAgeMs) oldestOfferAgeMs = age;
      tradeOffersInFlightList.push({
        offerId,
        firstSeenMs: ts,
        ageMs: age,
        lingering,
        posted: postedSet.has(offerId),
      });
    }
  }
  // Oldest first — that's what the commish wants to see (stalest entries
  // are the ones most likely to be stale-and-stuck).
  tradeOffersInFlightList.sort((a, b) => b.ageMs - a.ageMs);

  // Trade Offers Archive — running history of every offer ever ingested.
  // Joins three Redis hashes + the static feed JSON:
  //   archive[offerId] → metadata (owners + raw asset strings + first-seen)
  //   rolls[offerId]   → counter of dice-roll opportunities while in-flight
  //   posted SET       → which offerIds have been promoted to a Schefter post
  //   feed.posts       → the actual post (id + timestamp) when one exists
  // Entries that exist only in `first_seen` (not yet migrated to archive,
  // i.e. captured before this commit landed) get a placeholder record so
  // the running total stays honest — they're shown with offerId only.
  const offerToPostIndex = buildOfferToPostIndex();
  const playerMap = (() => {
    try {
      const identityMap = getPlayerMap(getCurrentLeagueYear());
      const m = new Map<string, { name: string; position: string; team: string }>();
      for (const [id, identity] of identityMap) {
        m.set(id, { name: identity.name, position: identity.position, team: identity.nflTeam });
      }
      return m;
    } catch (err) {
      console.warn('[admin/schefter-stats] player map load failed:', err);
      return new Map<string, { name: string; position: string; team: string }>();
    }
  })();

  type ArchiveAssets = { willGiveUp: ResolvedArchiveAsset[]; willReceive: ResolvedArchiveAsset[] };
  type ArchiveEntry = {
    offerId: string;
    offeringFid: string;
    offeringName: string;
    partnerFid: string;
    partnerName: string;
    firstSeenMs: number;
    rollCount: number;
    /**
     * Graduated-disclosure signal count for this offer — number of Schefter
     * posts that have shipped about it. 0 = never posted, 1 = team named once,
     * 2 = team + marquee player, 3+ = team + multiple players.
     */
    exposureCount: number;
    posted: boolean;
    postId: string | null;
    postTimestamp: string | null;
    legacyBackfill: boolean;
    assets: ArchiveAssets;
    comments: string;
  };

  const tradeOffersArchive: ArchiveEntry[] = [];
  const archiveSeen = new Set<string>();
  const rollsLookup = new Map<string, number>();
  if (tradeOffersRollsMap && typeof tradeOffersRollsMap === 'object') {
    for (const [k, v] of Object.entries(tradeOffersRollsMap)) {
      const n = Number(v);
      if (Number.isFinite(n)) rollsLookup.set(k, n);
    }
  }
  const exposureLookup = new Map<string, number>();
  if (tradeOffersExposureMap && typeof tradeOffersExposureMap === 'object') {
    for (const [k, v] of Object.entries(tradeOffersExposureMap)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) exposureLookup.set(k, n);
    }
  }
  // Resolve a unified exposure count: prefer the new counter, fall back to
  // "is in OFFER_POSTED_KEY → 1" for pre-2026-05 offers that haven't had a
  // new post yet under the graduated-disclosure model.
  function resolveExposure(offerId: string): number {
    const fresh = exposureLookup.get(offerId);
    if (fresh && fresh > 0) return fresh;
    return postedSet.has(offerId) ? 1 : 0;
  }

  function teamName(fid: string): string {
    if (!fid) return '';
    return teamLookup.get(fid)?.name || `Team ${fid}`;
  }

  if (tradeOffersArchiveMap && typeof tradeOffersArchiveMap === 'object') {
    for (const [offerId, raw] of Object.entries(tradeOffersArchiveMap)) {
      const parsed = typeof raw === 'string' ? safeParse(raw) : raw;
      if (!parsed || typeof parsed !== 'object') continue;
      const m = parsed as {
        offeringFid?: unknown;
        partnerFid?: unknown;
        willGiveUp?: unknown;
        willReceive?: unknown;
        comments?: unknown;
        firstSeenMs?: unknown;
      };
      const offeringFid = String(m.offeringFid ?? '');
      const partnerFid = String(m.partnerFid ?? '');
      const firstSeenMs = Number(m.firstSeenMs ?? 0) || 0;
      const link = offerToPostIndex.get(offerId);
      tradeOffersArchive.push({
        offerId,
        offeringFid,
        offeringName: teamName(offeringFid),
        partnerFid,
        partnerName: teamName(partnerFid),
        firstSeenMs,
        rollCount: rollsLookup.get(offerId) ?? 0,
        exposureCount: resolveExposure(offerId),
        posted: postedSet.has(offerId),
        postId: link?.postId || null,
        postTimestamp: link?.postTimestamp || null,
        legacyBackfill: false,
        assets: {
          willGiveUp: resolveArchiveAssets(typeof m.willGiveUp === 'string' ? m.willGiveUp : '', playerMap),
          willReceive: resolveArchiveAssets(typeof m.willReceive === 'string' ? m.willReceive : '', playerMap),
        },
        comments: typeof m.comments === 'string' ? m.comments : '',
      });
      archiveSeen.add(offerId);
    }
  }

  // Backfill: any offerId that exists in first_seen but doesn't have an
  // archive entry yet (captured before this commit landed) gets a stub so
  // it still shows up in the running total. Owners + assets are unknown
  // for these; the UI labels them as legacy entries.
  if (tradeOffersFirstSeenMap && typeof tradeOffersFirstSeenMap === 'object') {
    for (const [offerId, ts] of Object.entries(tradeOffersFirstSeenMap)) {
      if (archiveSeen.has(offerId)) continue;
      const firstSeenMs = Number(ts);
      if (!Number.isFinite(firstSeenMs) || firstSeenMs <= 0) continue;
      const link = offerToPostIndex.get(offerId);
      tradeOffersArchive.push({
        offerId,
        offeringFid: '',
        offeringName: '',
        partnerFid: '',
        partnerName: '',
        firstSeenMs,
        rollCount: rollsLookup.get(offerId) ?? 0,
        exposureCount: resolveExposure(offerId),
        posted: postedSet.has(offerId),
        postId: link?.postId || null,
        postTimestamp: link?.postTimestamp || null,
        legacyBackfill: true,
        assets: { willGiveUp: [], willReceive: [] },
        comments: '',
      });
    }
  }

  // Newest first — running history reads naturally with the latest at top.
  tradeOffersArchive.sort((a, b) => b.firstSeenMs - a.firstSeenMs);
  const tradeOffersArchiveTotal = tradeOffersArchive.length;

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
    tradeOffersInFlightList,
    tradeOffersArchive,
    tradeOffersArchiveTotal,
    ownerReportsCount,
    ownerReportsLastSeenTs,
    ownerReportsDistinctReporters,
    tipsterLeaderboardSize,
    tipSourceBreakdown,
    tipSampleSize,
    seasonYear,
    pendingTips,
    recentGroupMe,
    predictedPostOrder,
    queueChannelMix,
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
