#!/usr/bin/env node
/**
 * Schefter Rumor Mill Scanner (Phase 2)
 *
 * Drains anonymous tips from Redis (pushed by POST /api/schefter/tip) and
 * turns them into a focused Schefter-voiced rumor post. Picks ONE topic
 * bucket per cycle (trade rumors first, then gossip clusters/singletons
 * ranked by size + age). Gossip is rationed to 1 post/day by default and
 * auto-bumps to 2 on busy weeks. Tips in unchosen buckets stay in the
 * queue with 7-day TTL so slow-news leftovers bubble up over time, and a
 * Friday mailbag sweeps anything still sitting so it doesn't expire unseen.
 *
 * Runs every 15 min via .github/workflows/schefter-rumor-scan.yml, but also
 * fine to invoke manually:
 *
 *   node scripts/schefter-rumor-scan.mjs           # live run (mutates Redis + feed + GroupMe)
 *   node scripts/schefter-rumor-scan.mjs --dry-run # no mutations, prints what it would do
 *
 * Environment:
 *   SCHEFTER_RUMOR_MILL_ENABLED  gate flag (required truthy to run)
 *   SCHEFTER_PUBLIC_BASE_URL     absolute site origin for the tip-page link in GroupMe
 *                                (defaults to https://theleague.us)
 *   UPSTASH_REDIS_REST_URL / TOKEN (or KV_*)  Redis credentials
 *   ANTHROPIC_API_KEY            required for AI post; falls back to template
 *   GROUPME_SCHEFTER_BOT_ID      required to post to GroupMe (Roger is NOT a fallback)
 *   SCHEFTER_TIPSTER_SALT        required (must match the API route's salt)
 *
 * Gates (in order, all must pass):
 *   1. SCHEFTER_RUMOR_MILL_ENABLED truthy
 *   2. Not in quiet hours (23:00–07:00 PT) — tips held, scanner exits
 *   3. schefter:rumor:posts_today < MAX_POSTS_PER_DAY
 *   4. If posts_today >= 1, last post must be > MIN_SPACING_MS ago
 *   5. first_tip_ts must be >= MIN_MARINATE_MS old (marinate window)
 *   6. If chosen bucket is "gossip", schefter:rumor:gossip_posts_today < adaptive cap
 *
 * Topic-bucket priority (bucketPriorityScore = (size - 1) * 2 + oldest-age-in-days):
 *   a. Trade-offer bucket — actual MFL pending offers (source === "trade_offer").
 *      This is the only "trade" lane. Web/groupme tips with topic === "trade"
 *      are speculation, not confirmed offers — they ride the gossip lane.
 *   b. Gossip buckets — largest/oldest wins. Gossip covers commish, roster,
 *      prediction, "other", AND web/groupme trade-rumor speculation. When
 *      a second distinct gossip bucket exists AND the gossip queue has
 *      piled up to at least SECONDARY_GOSSIP_POST_PRESSURE tips, it ships
 *      as its OWN independent feed post in the same cycle (separate post
 *      id, reactions, comments, whisper-back thread), with both posts
 *      sharing one cap slot. Below that threshold the second bucket waits
 *      for the next cycle — the quick-double-post is a catch-up mechanism
 *      for 2+ days of pile-up, not a default cadence.
 *   c. Oldest gossip singleton if nothing else qualifies
 *
 * Web/groupme bucket key is `topic:<topic>:<franchiseHint || "league-wide">`
 * so two trade-rumor tips with different scopes (one named-franchise, one
 * league-wide) split into separate buckets and ship as separate posts.
 *
 * Anonymization redacts franchise-name mentions from raw tip `text` when
 * the scope is fuzzed (single-source franchise → division, league-wide,
 * commish). The tipster could type "the Geeks are looking for an RB" but
 * the LLM sees "[a team] are looking for an RB" — anonymity by deletion,
 * not by polite request.
 *
 * Special paths:
 *   - Friday mailbag: on Friday PT, once per day, sweeps ALL gossip tips
 *     still in the queue into a bullet-style roundup (HARD RULE 20). Ensures
 *     every tip gets a shot at the feed before the 7-day TTL fires.
 *   - Adaptive gossip cap: when gossip queue depth >= 6 OR oldest gossip
 *     tip is >= 3 days old, the day's gossip cap bumps to 2.
 *   - Age-aware voice: tips carry ageDays + isStale so the LLM can say
 *     "still hearing…" / "chatter from earlier this week" on days-old tips.
 *
 * On success: drain tips consumed this cycle, rewrite leftovers back to
 * the queue, anonymize, generate post (with a "Whisper to Schefter" link),
 * append feed JSON, post GroupMe, update counters.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ingestGroupMeMentions, getLatestRogerQuote, mentionsSchefter } from './schefter-groupme-listen.mjs';
import {
  redactTradeOffer,
  offerPostProbability,
  tierForDistinctOfferers,
} from './lib/redact-trade-offer.mjs';
import {
  scanDraftTrades,
  getDraftOfferersForPlayer,
  getOwnerDraftCount,
  TB_DRAFT_OFFERER_WEIGHT,
} from './lib/scan-draft-trades.mjs';
import {
  loadLore,
  loadPostHistory,
  buildRecentPostsPromptBlock,
  appendPostHistory,
  buildHistoryEntry,
} from './lib/schefter-lore.mjs';
import { incrementTipsterCounters } from './lib/schefter-tipster-counters.mjs';
import {
  classifyTipKind,
  buildTopicBuckets,
  bucketPriorityScore,
} from './lib/schefter-bucket-logic.mjs';
import {
  isOverNamingRateLimit,
  MAX_EXPLICIT_PICKS_PER_TARGET,
} from './lib/schefter-naming-rate-limit.mjs';
import {
  getTeamNameCount30d,
  recordTeamNaming,
} from './lib/schefter-team-naming.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const DRY_RUN = process.argv.includes('--dry-run');
const TRADE_OFFERS_ONLY = process.argv.includes('--trade-offers-only');

// ── Constants ──

const LEAGUE_SLUG = 'theleague';
const LEAGUE_ID = '13522';
const MFL_HOST = process.env.MFL_HOST || 'api.myfantasyleague.com';
const FEED_PATH = path.join(projectRoot, 'src', 'data', 'theleague', 'schefter-feed.json');
const CONFIG_PATH = path.join(projectRoot, 'src', 'data', 'theleague.config.json');
const PLAYERS_PATH = (year) =>
  path.join(projectRoot, 'data', 'theleague', 'mfl-feeds', String(year), 'players.json');

const RUMOR_POSTS_TODAY_KEY = 'schefter:rumor:posts_today';
const RUMOR_GOSSIP_POSTS_TODAY_KEY = 'schefter:rumor:gossip_posts_today';
const RUMOR_LAST_POST_TS_KEY = 'schefter:rumor:last_post_ts';
const FIRST_TIP_TS_KEY = 'schefter:tips:first_tip_ts';
const TIPS_QUEUE_KEY = 'schefter:tips:queue';
const TIPS_PROCESSED_KEY = 'schefter:tips:processed';
const ROGER_LAST_RIFF_DATE_KEY = 'schefter:ask_roger:last_riff_date';

// ── Phase 6: Trade-Offer Rumor Redis keys ──
// Legacy key (pre-cumulative-probability model). Still read for dedup against
// offers that were already "burned" under the old one-shot dice-roll system so
// we don't suddenly re-surface trades that previously failed the roll.
const OFFER_SEEN_KEY = 'schefter:trade_offers:seen';
const OFFER_SEEN_TTL_SEC = 30 * 24 * 60 * 60;        // 30d

// Cumulative-probability model (p=0.0075/run, 99% by ~day 6.4). Each live
// offer gets:
//   - an entry in `first_seen` HASH (offerId → epoch ms of first sighting)
//     used to compute age → framingHint ('fresh' <48h, 'lingering' ≥48h)
//   - zero or one SADD into `posted` SET the first time its dice roll passes
// An offer is retried every run until it posts OR disappears from MFL.
const OFFER_FIRST_SEEN_KEY = 'schefter:trade_offers:first_seen';
const OFFER_POSTED_KEY = 'schefter:trade_offers:posted';
const OFFER_STATE_TTL_SEC = 30 * 24 * 60 * 60;       // 30d on both first_seen HASH and posted SET

const OFFER_LINGERING_THRESHOLD_MS = 48 * 60 * 60 * 1000;   // 48h → framing flip

const OFFER_OWNER_KEY_PREFIX = 'schefter:trade_offers:owner:';
const OFFER_DIV_KEY_PREFIX = 'schefter:trade_offers:div:';
// Owner-sourced intake: owners populate this hash from /api/trades/pending
// and /api/trades/submit. See src/utils/owner-trade-reports.ts. Read-only
// from this scanner — the API routes own the writes and TTL.
const OFFER_OWNER_REPORTS_KEY = 'schefter:trade_offers:owner_reports';
const PLAYER_OFFER_HISTORY_PREFIX = 'schefter:player_offer_history:';
const OFFER_ROLLING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;    // 7d owner + div
const PLAYER_HISTORY_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;  // 21d player escalation

const ROGER_RIFF_PROBABILITY = 0.07;

// Trade rumors eat the bulk of our daily post quota; gossip is rationed
// to at most one per day so the feed doesn't read like a group-chat burn
// book. With a hard gossip cap of 1/day, the remaining slots are effectively
// reserved for trade rumors. When the backlog is deep OR a tip is aging
// out we bump the gossip cap by one that day — see computeAdaptiveGossipCap.
const MAX_POSTS_PER_DAY = 3;
const MAX_GOSSIP_POSTS_PER_DAY = 1;
const MAX_GOSSIP_POSTS_PER_DAY_ADAPTIVE = 2;
const GOSSIP_BOOST_QUEUE_DEPTH = 6;
const GOSSIP_BOOST_TIP_AGE_MS = 3 * 24 * 60 * 60 * 1000;
// The "quick double post" — shipping a secondary gossip post in the same
// cycle — is reserved for genuine pile-up: a gossip queue of this depth
// or deeper. With a typical ~1-2 tips/day arrival rate, 4 queued gossip
// tips means 2+ days of buildup without us clearing it, which is exactly
// the pattern we want the second post to catch. Below the threshold, the
// secondary bucket waits its turn on a later cycle.
const SECONDARY_GOSSIP_POST_PRESSURE = 4;
const MIN_SPACING_MS = 4 * 60 * 60 * 1000;
const MIN_MARINATE_MS = 1 * 60 * 60 * 1000;
const MAX_TIPS_PER_BATCH = 10;
// Tips survive a full week in the queue — combined with the age-boost in
// pickPrimaryBucket and the Friday mailbag, this gives every tip multiple
// chances to land a post before it expires.
const TIP_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
// A tip this old MUST either reference its date or hedge in-voice.
const TIP_STALE_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;
const PROCESSED_TTL_SEC = 24 * 60 * 60;

const QUIET_HOUR_START = 23; // 11pm PT
const QUIET_HOUR_END = 7;    // 7am PT

// Friday mailbag — one big roundup that sweeps the queue so nothing
// expires unseen. Runs once per Friday PT. Same Redis-key TTL pattern as
// the other daily counters.
const FRIDAY_MAILBAG_DONE_KEY = 'schefter:mailbag:done_date';
const FRIDAY_WEEKDAY_INDEX = 5; // 0=Sun … 5=Fri

// Public URL of the tip page — appended to every GroupMe rumor post so
// owners always have a one-tap path to whisper back with intel. The feed
// card renders the same destination via post.link / post.linkLabel.
// On theleague.us, vercel.json 301s /theleague/:path* → /:path*, so the
// canonical path is /schefter/tip.
const TIP_PAGE_PATH = '/schefter/tip';
const TIP_PAGE_LINK_LABEL = 'Got a tip? Whisper to Schefter →';
const PUBLIC_BASE_URL = (process.env.SCHEFTER_PUBLIC_BASE_URL || 'https://theleague.us').replace(/\/+$/, '');
const TIP_PAGE_ABSOLUTE_URL = `${PUBLIC_BASE_URL}${TIP_PAGE_PATH}`;

// Trade-bait rumors send readers to the Trade Builder instead of the tip
// page — the owner has publicly listed players, so the natural next click
// is to build a counter-offer with those players pre-loaded. The ?b=<id>
// param is the same convention the rosters page uses (see rosters.astro).
const TRADE_BUILDER_LINK_LABEL = 'Open in Trade Builder →';
const TRADE_BUILDER_GROUPME_PREFIX = 'Counter on the block?';

function buildTradeBuilderPath(franchiseId) {
  return `/theleague/trade-builder?b=${encodeURIComponent(franchiseId)}`;
}

/**
 * Resolve the CTA for a post based on its primary bucket. Trade-bait
 * posts targeted at a single franchise swap the default tip-page CTA
 * for a Trade Builder deep-link; everything else uses the tip page.
 * Returns all three rendering targets (feed link, feed label, GroupMe
 * URL suffix) so the post builder + groupMeTextFor stay in sync.
 */
function resolveCta(primaryBucket) {
  const tips = primaryBucket?.tips ?? [];
  const allTradeBait = tips.length > 0 && tips.every((t) => t.source === 'trade_bait');
  if (allTradeBait) {
    const franchiseIds = new Set(tips.map((t) => t.franchiseHint).filter(Boolean));
    if (franchiseIds.size === 1) {
      const [fid] = franchiseIds;
      const path = buildTradeBuilderPath(fid);
      return {
        link: path,
        linkLabel: TRADE_BUILDER_LINK_LABEL,
        groupMePrefix: TRADE_BUILDER_GROUPME_PREFIX,
        groupMeUrl: `${PUBLIC_BASE_URL}${path}`,
      };
    }
  }
  return {
    link: TIP_PAGE_PATH,
    linkLabel: TIP_PAGE_LINK_LABEL,
    groupMePrefix: 'Got a tip?',
    groupMeUrl: TIP_PAGE_ABSOLUTE_URL,
  };
}

/**
 * Override the default CTA when a beat names a specific franchise (explicit-pick
 * scope). The resulting card invites the named team's desk to whisper back —
 * "Geeks desk — your move →" — and the link pre-selects that franchise on
 * the tip form. Per HARD RULE 4b: this turns one-sided sniping into a thread,
 * which is the engagement-multiplier feature.
 *
 * Returns null when the beat doesn't qualify (no franchise-explicit-pick
 * scope, or the resolving tip has no franchiseHint).
 */
function buildDirectedCta(beat) {
  const safe = beat?.anonymized?.[0];
  if (safe?.scope?.kind !== 'franchise-explicit-pick') return null;
  const tip = beat?.batch?.find((t) => typeof t?.franchiseHint === 'string' && t.franchiseHint.length > 0);
  const franchiseId = tip?.franchiseHint;
  if (!franchiseId) return null;
  const franchiseShort = safe.scope.franchise || `Team ${franchiseId}`;
  const path = `${TIP_PAGE_PATH}?target=${encodeURIComponent(franchiseId)}`;
  return {
    link: path,
    linkLabel: `${franchiseShort} desk — your move →`,
    groupMePrefix: `${franchiseShort} desk — your move:`,
    groupMeUrl: `${PUBLIC_BASE_URL}${path}`,
  };
}

// ── Logging ──

function log(...args) {
  console.log(...args);
}
function warn(...args) {
  console.warn(...args);
}

// ── Redis (Upstash) ──

let _redis;

async function getRedis() {
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
    warn('[rumor-scan] Redis credentials not set — exiting');
    _redis = null;
    return null;
  }
  try {
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({ url, token });
    return _redis;
  } catch (err) {
    warn(`[rumor-scan] Redis import failed: ${err.message}`);
    _redis = null;
    return null;
  }
}

// ── Time helpers (Pacific Time) ──

function getPtHour(now = new Date()) {
  // Use Intl to get the hour in America/Los_Angeles regardless of server tz
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(fmt.format(now), 10);
}

function isQuietHours(now = new Date()) {
  const h = getPtHour(now);
  // quiet from 23:00 (inclusive) through 06:59 (wraps midnight)
  return h >= QUIET_HOUR_START || h < QUIET_HOUR_END;
}

function getPtDateString(now = new Date()) {
  // YYYY-MM-DD in America/Los_Angeles
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now);
}

function secondsUntilPtMidnight(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  const h = parseInt(parts.hour, 10);
  const m = parseInt(parts.minute, 10);
  const s = parseInt(parts.second, 10);
  const elapsedSecToday = h * 3600 + m * 60 + s;
  return 24 * 3600 - elapsedSecToday;
}

// ── File helpers ──

async function loadFeed() {
  try {
    const raw = await fs.readFile(FEED_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { lastScanTimestamp: '', lastProcessedMflTimestamp: '0', posts: [] };
  }
}

async function loadTeams() {
  const raw = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
  const map = new Map();
  for (const t of raw.teams ?? []) {
    map.set(t.franchiseId, {
      name: t.name,
      nameMedium: t.nameMedium,
      nameShort: t.nameShort,
      abbrev: t.abbrev,
      division: t.division,
    });
  }
  return map;
}

function pickTeamName(team) {
  if (!team) return null;
  return team.nameShort || team.nameMedium || team.name || null;
}

/**
 * Build a list of all known franchise-name tokens (long/medium/short/abbrev)
 * across the teams map. Used to redact franchise mentions from tip text
 * when the tip's scope has been fuzzed away from naming a specific franchise.
 *
 * Keeps tokens length-sorted descending so a regex alternation matches the
 * longest form first (e.g. "Nashville Geeks" wins over "Geeks").
 */
function collectFranchiseNameTokens(teams) {
  const tokens = new Set();
  for (const team of teams.values()) {
    for (const field of ['name', 'nameMedium', 'nameShort', 'abbrev']) {
      const v = team?.[field];
      if (typeof v === 'string' && v.trim().length >= 2) {
        tokens.add(v.trim());
      }
    }
  }
  return [...tokens].sort((a, b) => b.length - a.length);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Redact franchise-name mentions from anonymized tip text.
 *
 * The safe.scope guides what stays:
 *   - kind === 'franchise-multi-source' → keep ONLY the named franchise
 *     (HARD RULE 4 lets Schefter name it), redact every other team
 *   - kind === 'division' / 'commish' / 'league-wide' → redact every team
 *
 * Matches are case-insensitive with word boundaries. Replaces with
 * "[a team]" so the LLM literally cannot leak a name even if the tipster
 * typed one in the raw text. Returns the redacted string (no mutation).
 */
function redactFranchiseNamesInText(text, teams, { keepFranchise } = {}) {
  if (typeof text !== 'string' || text.length === 0) return text;
  const tokens = collectFranchiseNameTokens(teams);
  if (tokens.length === 0) return text;
  const keepLower = typeof keepFranchise === 'string' ? keepFranchise.toLowerCase() : null;
  let out = text;
  for (const token of tokens) {
    if (keepLower && token.toLowerCase() === keepLower) continue;
    const re = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'gi');
    out = out.replace(re, '[a team]');
  }
  return out;
}

// ── GroupMe ──

async function postToGroupMe(text) {
  const botId = process.env.GROUPME_SCHEFTER_BOT_ID;
  if (!botId) {
    warn('[rumor-scan] GROUPME_SCHEFTER_BOT_ID not set — skipping GroupMe (Roger is reserved for deadlines)');
    return;
  }
  if (DRY_RUN) {
    log(`  [dry-run] Would post to GroupMe:\n${text}`);
    return;
  }
  try {
    await fetch('https://api.groupme.com/v3/bots/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot_id: botId, text }),
    });
    log('  [GroupMe] Posted');
  } catch (err) {
    warn(`  [GroupMe] Failed: ${err.message}`);
  }
}

// ── Tip anonymization ──

/**
 * Build a sanitized view of the batch for the LLM. Enforces the
 * "don't surface a single-source franchise mention" rule — when only one
 * tip names a specific franchise, we fuzz to the franchise's division (or
 * league-wide if no division is resolvable).
 *
 * @param {Array} tips - raw tips from queue
 * @param {Map} teams - franchise → team config
 * @param {Array} [feedPosts] - current feed posts, used to resolve parent
 *   rumor snippets for thread-followup scopes. When omitted, followups still
 *   get the thread-followup scope but with no parent headline context.
 * @param {Date} [now] - reference time for age calculations; defaults to now.
 */
// Defensive wrappers around the naming Redis helpers. The scanner must not
// crash on a Redis outage — fail open: rate-limit returns false (allow naming),
// name count returns 0 (LLM falls back to first-naming framing).
async function safeIsOverNamingRateLimit(tipsterHash, franchiseId, redis) {
  if (!redis) return false;
  try {
    return await isOverNamingRateLimit(tipsterHash, franchiseId, redis);
  } catch {
    return false;
  }
}

async function safeGetTeamNameCount30d(franchiseId, redis) {
  if (!redis) return 0;
  try {
    return await getTeamNameCount30d(franchiseId, redis);
  } catch {
    return 0;
  }
}

async function anonymizeTips(tips, teams, feedPosts = [], now = new Date(), redis = null) {
  const refMs = now instanceof Date ? now.getTime() : Date.now();
  // Single-franchise fuzz applies ONLY to web tips. A GroupMe mention of
  // franchise X isn't an anonymity leak — the speaker publicly named it
  // in the group chat. Count only web tips when deciding fuzz.
  const webFranchiseCounts = new Map();
  for (const t of tips) {
    if (t.source !== 'web') continue;
    const hint = t.franchiseHint;
    if (hint && hint !== 'league-wide') {
      webFranchiseCounts.set(hint, (webFranchiseCounts.get(hint) ?? 0) + 1);
    }
  }

  const multiSourceFranchises = new Set();
  for (const [fid, count] of webFranchiseCounts) {
    if (count >= 2) multiSourceFranchises.add(fid);
  }

  const feedById = new Map(
    Array.isArray(feedPosts)
      ? feedPosts.map((p) => [p.id, p])
      : [],
  );

  return Promise.all(tips.map(async (tip) => {
    const submittedAt = tip.submittedAt ?? refMs;
    const ageMs = Math.max(0, refMs - submittedAt);
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    const safe = {
      id: tip.id,
      topic: tip.topic,
      text: tip.text,
      source: tip.source,
      attributable: tip.attributable === true,
      author: tip.attributable && tip.author ? tip.author : undefined,
      submittedAt,
      // Age fields let the LLM reference the tip's date or hedge when the
      // tip has been in the queue for a while. HARD RULE 17 gates the
      // phrasing so we never claim a tip is fresh when it isn't.
      ageDays,
      isStale: ageMs >= TIP_STALE_THRESHOLD_MS,
    };

    // Reverse-the-lens framing for hostile tips. Only surface the tipster's
    // division for web tips — GroupMe tips are already attributable and
    // trade-offer tips don't carry a tipster. The LLM's HARD RULE governs
    // when this may be used (hostile tips only — see rule 12).
    if (tip.source === 'web' && typeof tip.tipsterDivision === 'string' && tip.tipsterDivision) {
      safe.tipsterDivision = tip.tipsterDivision;
    }

    // Phase 7 — whisper-back continuity. Surface the parent rumor's first
    // clause (<= 90 chars) so the LLM can open with "Following up on…".
    // Never surface the parent's tipIds or internal metadata.
    if (tip.repliesToPostId) {
      const parent = feedById.get(tip.repliesToPostId);
      const parentBody = parent?.body ? String(parent.body) : '';
      const firstSentence = parentBody.match(/^[^.!?]+[.!?]/)?.[0] ?? parentBody;
      const snippet = firstSentence.length > 90
        ? firstSentence.slice(0, 87).trimEnd() + '…'
        : firstSentence;
      safe.threadFollowup = {
        parentPostId: tip.repliesToPostId,
        parentHeadlineSnippet: snippet || undefined,
      };
    }

    // GroupMe: no fuzz — everything is public context. Attach franchise hint
    // only if the author's franchise is identifiable (left to the LLM to use
    // naturally; we do not pre-resolve from author name here).
    if (tip.source === 'groupme') {
      safe.scope = { kind: 'groupme-public' };
      // Style Book: if this GroupMe tip was flagged as a personal attack on
      // Schefter by the listener, surface the flag + running-season count
      // so the LLM can escalate the Style Book bit with running-total flavor.
      // See HARD RULE 15 and running-bits.md → "The Style Book".
      if (tip.attackOnSchefter === true) {
        safe.attackOnSchefter = true;
        if (typeof tip.styleBookCount === 'number' && tip.styleBookCount > 0) {
          safe.styleBookCount = tip.styleBookCount;
        }
      }
      return safe;
    }

    // Trade-offer: redaction already happened upstream in scanTradeOffers.
    // Pass the structured fields straight through — LLM synthesizes body.
    if (tip.source === 'trade_offer') {
      safe.scope = { kind: 'trade-offer' };
      safe.volumeHint = tip.volumeHint;
      safe.positionTokens = tip.positionTokens;
      safe.pickTokens = tip.pickTokens;
      if (tip.divisionHint) safe.divisionHint = tip.divisionHint;
      if (tip.escalatedPlayer) safe.escalatedPlayer = tip.escalatedPlayer;
      // Age-based framing — 'lingering' means the offer has been open ≥48h
      // and nobody has answered; the LLM should swap to a "phones aren't
      // picking up" frame instead of fresh-rumor energy.
      safe.framingHint = tip.framingHint ?? 'fresh';
      // Scrub text/author fields that don't apply
      delete safe.text;
      delete safe.author;
      return safe;
    }

    // Trade-bait: owner publicly listed players on the block. Attribution
    // is the WHOLE POINT — the franchise put this on MFL for the league to
    // see, so we name them. No fuzz, no redaction. Pass the structured
    // adds/byPos/ownerComment payload through so the LLM can pick framing
    // (singleton name vs. positional theme vs. spring-cleaning).
    if (tip.source === 'trade_bait') {
      const hint = tip.franchiseHint;
      const team = teams.get(hint);
      const franchiseName = tip.author || pickTeamName(team) || `Team ${hint}`;
      safe.author = franchiseName;
      safe.attributable = true;
      safe.scope = {
        kind: 'trade-bait',
        franchise: franchiseName,
        division: team?.division,
      };
      if (tip.meta && typeof tip.meta === 'object') {
        safe.meta = {
          adds: Array.isArray(tip.meta.adds) ? tip.meta.adds : [],
          byPos: tip.meta.byPos ?? {},
          totalAdds: tip.meta.totalAdds ?? (Array.isArray(tip.meta.adds) ? tip.meta.adds.length : 0),
          ownerWillGiveUp: tip.meta.ownerWillGiveUp ?? '',
          ownerWillTake: tip.meta.ownerWillTake ?? '',
          truncated: tip.meta.truncated === true,
        };
      }
      return safe;
    }

    const hint = tip.franchiseHint;
    if (!hint || hint === 'league-wide') {
      safe.scope = { kind: 'league-wide' };
      return safe;
    }

    if (hint === 'commish') {
      // Commish is a role, not an anonymity leak — the office is public.
      // Schefter can reference "the commissioner" without naming the franchise.
      safe.scope = { kind: 'commish' };
      return safe;
    }

    const team = teams.get(hint);
    if (multiSourceFranchises.has(hint)) {
      // Unlock named franchise + "multiple sources" phrasing
      const nameCount30d = await safeGetTeamNameCount30d(hint, redis);
      safe.scope = {
        kind: 'franchise-multi-source',
        franchise: pickTeamName(team) ?? `Team ${hint}`,
        division: team?.division,
        sourceCount: webFranchiseCounts.get(hint),
        nameCount30d,
      };
    } else if (
      team &&
      tip.source === 'web' &&
      typeof tip.hashedOwnerId === 'string' &&
      tip.hashedOwnerId.length > 0 &&
      !(await safeIsOverNamingRateLimit(tip.hashedOwnerId, hint, redis))
    ) {
      // Single-source explicit dropdown pick within rate limit — naming UNLOCKED.
      // The tipster picked this franchise from the form's selector, which is the
      // consent signal: they explicitly chose to point at this team. Schefter
      // names the team with single-pointer framing (NOT "multiple sources").
      // The (tipster, target) cap suppresses grind-on-one-rival behavior — over
      // the cap, this branch is skipped and the tip falls through to
      // division-fuzz silently.
      const nameCount30d = await safeGetTeamNameCount30d(hint, redis);
      safe.scope = {
        kind: 'franchise-explicit-pick',
        franchise: pickTeamName(team) ?? `Team ${hint}`,
        division: team?.division,
        nameCount30d,
      };
    } else {
      // Single-source about a specific team without consent signal (no
      // hashedOwnerId / no team config / over rate limit) — generalize.
      if (team?.division) {
        safe.scope = { kind: 'division', division: team.division };
      } else {
        safe.scope = { kind: 'league-wide' };
      }
    }

    // Style Book — anonymous web-tip path. If this web tip was flagged as a
    // personal attack on Schefter by the API route, surface the flag + count
    // + codename so the LLM can fire the Style Book bit with continuity
    // ("Noted, Burner Phone. Adding that to the file."). Anon tips get a
    // codename; GroupMe tips get the author's display name — HARD RULE 15
    // handles both cases.
    if (tip.attackOnSchefter === true) {
      safe.attackOnSchefter = true;
      if (typeof tip.styleBookCount === 'number' && tip.styleBookCount > 0) {
        safe.styleBookCount = tip.styleBookCount;
      }
      if (typeof tip.tipsterCodename === 'string' && tip.tipsterCodename.length > 0) {
        safe.tipsterCodename = tip.tipsterCodename;
      }
    }

    // Off-topic tip count — drives the HARD RULE 16 escalation ladder for the
    // "every accusation is a confession" twist. Surface on every web tip that
    // carries a count (commish-topic tips) so the LLM can weight the framing
    // appropriately even when the tip isn't a direct attack on Schefter.
    if (typeof tip.offTopicCount === 'number' && tip.offTopicCount > 0) {
      safe.offTopicCount = tip.offTopicCount;
    }

    // Intra-division flag — set when the tipster and the SUBJECT team are in
    // the same division. The scanner prompt uses this to unlock a hostile-tip
    // frame that cites the division itself as rivalry territory, attributing
    // neither the tipster nor the target — preserves maximum privacy (4 → 4
    // teams, no narrowing) and reads like beat-reporter color rather than
    // one-sided complaint. Subject-division fuzz still applies for non-hostile
    // tips; this flag is purely informational.
    if (
      typeof tip.tipsterDivision === 'string' &&
      team?.division &&
      tip.tipsterDivision === team.division
    ) {
      safe.intraDivision = true;
    }

    // Text redaction — strip franchise mentions from `text` so the LLM can't
    // leak a name even when the tipster typed one in. Multi-source scope
    // keeps the named franchise (HARD RULE 4 lets Schefter use it); every
    // other scope fuzzes to "[a team]" for ALL franchise names. GroupMe and
    // trade_offer paths returned earlier and bypass this block.
    const keepFranchise = (
      safe.scope?.kind === 'franchise-multi-source' ||
      safe.scope?.kind === 'franchise-explicit-pick'
    )
      ? safe.scope.franchise
      : null;
    safe.text = redactFranchiseNamesInText(safe.text, teams, { keepFranchise });

    return safe;
  }));
}

// ── Topic-bucket selection ──

/**
 * Classify each tip into a "kind" that drives daily-cap accounting.
 *   - trade  : source === 'trade_offer' ONLY. Real MFL pending offers are
 *              the trade-rumor headline material — they get priority over
 *              every other bucket and aren't subject to the gossip cap.
 *   - gossip : everything else, INCLUDING web/groupme tips with topic === 'trade'.
 *              An owner saying "I think the Geeks are looking for an RB" is
 *              speculation, not a confirmed offer — it rides the gossip lane
 *              with commish beef, roster gripes, and predictions, and is
 *              subject to MAX_GOSSIP_POSTS_PER_DAY (adaptive).
 */
// classifyTipKind, buildTopicBuckets, bucketPriorityScore — see
// ./lib/schefter-bucket-logic.mjs (imported above; shared with the admin
// dashboard so /api/admin/schefter-stats can preview the next bucket).
// trade_bait keying lives in the shared module too, so the admin preview
// honors the per-franchise bucket the scanner will actually pick.

/**
 * Pick the bucket(s) to post about this cycle.
 *
 * Priority order:
 *   1. Trade-offer bucket — actual MFL pending offers. Always wins. Web/
 *      groupme trade-rumor speculation does NOT live here — it rides the
 *      gossip lane (see classifyTipKind).
 *   2. Gossip buckets — bucketPriorityScore (size + age boost) ranks them.
 *      Includes commish, roster, prediction, "other", AND web/groupme
 *      trade rumor tips.
 *   3. Singleton gossip — returned when nothing else qualifies. Age boost
 *      means older singletons rise above newer ones naturally.
 *
 * For gossip posts we also return a SECONDARY bucket when one exists —
 * the caller ships the secondary as its OWN independent feed post so
 * each gossip topic has separate reactions and whisper-back threads.
 * Both posts consume exactly one slot from the daily cap. The trade-
 * offer post never carries a secondary (single-topic only).
 *
 * Returns `{ primary, secondary }` or `null` when nothing qualifies.
 */
function pickPrimaryBucket(buckets, { gossipAllowedToday, now = new Date() } = {}) {
  const tradeBuckets = buckets.filter((b) => b.kind === 'trade');
  if (tradeBuckets.length > 0) {
    // Only one bucket key (trade:offer) maps to kind === 'trade' under the
    // new classification, but sort defensively in case that ever changes.
    tradeBuckets.sort((a, b) => bucketPriorityScore(b, now) - bucketPriorityScore(a, now));
    return { primary: tradeBuckets[0], secondary: null };
  }

  if (!gossipAllowedToday) return null;

  const gossipBuckets = buckets.filter((b) => b.kind === 'gossip');
  if (gossipBuckets.length === 0) return null;

  gossipBuckets.sort((a, b) => {
    const sa = bucketPriorityScore(a, now);
    const sb = bucketPriorityScore(b, now);
    if (sb !== sa) return sb - sa;
    // Ties: older wins so a long-queued tip always beats a fresh one.
    return a.oldestSubmittedAt - b.oldestSubmittedAt;
  });

  const primary = gossipBuckets[0];
  const secondary = gossipBuckets[1] ?? null;
  return { primary, secondary };
}

/**
 * Adaptive gossip cap — bumps the gossip quota by one for the day when the
 * backlog is deep enough to risk pile-up. Triggers on either:
 *   - queue depth ≥ GOSSIP_BOOST_QUEUE_DEPTH, or
 *   - oldest tip age ≥ GOSSIP_BOOST_TIP_AGE_MS
 *
 * A quiet week stays at 1/day; a loud week self-regulates at 2/day.
 */
function computeAdaptiveGossipCap(freshTips, now = new Date()) {
  const refMs = now instanceof Date ? now.getTime() : Date.now();
  const gossipTips = freshTips.filter((t) => classifyTipKind(t) === 'gossip');
  if (gossipTips.length === 0) {
    return { cap: MAX_GOSSIP_POSTS_PER_DAY, reason: 'no gossip in queue' };
  }
  const oldestAgeMs = gossipTips.reduce(
    (acc, t) => Math.max(acc, refMs - (t.submittedAt ?? refMs)),
    0,
  );
  const deepBacklog = gossipTips.length >= GOSSIP_BOOST_QUEUE_DEPTH;
  const agingTip = oldestAgeMs >= GOSSIP_BOOST_TIP_AGE_MS;
  if (deepBacklog || agingTip) {
    const reasons = [
      deepBacklog ? `backlog=${gossipTips.length}` : null,
      agingTip ? `oldest=${Math.floor(oldestAgeMs / (24 * 60 * 60 * 1000))}d` : null,
    ].filter(Boolean);
    return { cap: MAX_GOSSIP_POSTS_PER_DAY_ADAPTIVE, reason: `adaptive (${reasons.join(', ')})` };
  }
  return { cap: MAX_GOSSIP_POSTS_PER_DAY, reason: 'default' };
}

/**
 * Friday mailbag helpers. The scanner runs a roundup once per Friday PT
 * that sweeps all non-trade tips still in the queue — so nothing expires
 * silently even on a slow week. Runs after the marinate gate passes and
 * before the normal bucket pick.
 */
function isFridayPt(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
  });
  return fmt.format(now) === 'Fri';
}

// ── Post generation ──

const RUMOR_SUB_TYPE = 'rumor_mill';
const RUMOR_TIER = 'rumor';

function generatePostId() {
  const hash = createHash('sha256')
    .update(`${Date.now()}${Math.random()}`)
    .digest('hex')
    .slice(0, 8);
  return `sf_rumor_${Date.now()}_${hash}`;
}

function pickFlavor(seed, options) {
  // Deterministic round-robin across `options` based on a string seed
  // (typically the tip id). Same seed → same pick across runs, which keeps
  // template-fallback debugging stable while still giving variety across
  // different tips.
  if (!options || options.length === 0) return '';
  if (options.length === 1) return options[0];
  const s = String(seed ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return options[Math.abs(h) % options.length];
}

function templateBody(anonymized) {
  // Fallback when Claude is unavailable (no API key, API outage, JSON
  // parse failure). Voice still leans drama-amplification — Schefter
  // plays a slow news day straight rather than shipping "buzzing about
  // something" as a placeholder. Each scope gets several variants so
  // the same fallback line doesn't fire identically every time.
  const scopes = anonymized.map((t) => t.scope?.kind);
  const divisions = [...new Set(anonymized.map((t) => t.scope?.division).filter(Boolean))];
  const groupmeAuthors = anonymized
    .filter((t) => t.source === 'groupme' && t.author)
    .map((t) => t.author);
  if (anonymized.length === 1) {
    const one = anonymized[0];
    const seed = String(one.id ?? '');
    if (one.source === 'groupme' && one.author) {
      return pickFlavor(seed, [
        `${one.author} fired off a theory in the group chat — I'm hearing you, working sources to confirm. Developing.`,
        `${one.author} dropped a take in the group thread tonight. Phones still moving on this one. We'll see.`,
        `${one.author} pushing something in the chat — and it's not the worst smoke I've heard this week. More to come.`,
        `Group-chat dispatch from ${one.author} — sources working overtime to confirm. Stay tuned.`,
      ]);
    }
    if (one.source === 'trade_bait' && one.scope?.kind === 'trade-bait') {
      const adds = one.meta?.adds ?? [];
      const total = one.meta?.totalAdds ?? adds.length;
      const franchise = one.scope.franchise;
      if (total === 1 && adds[0]) {
        return `Hearing the ${franchise} have put ${adds[0].name} on the block. Developing.`;
      }
      const byPos = one.meta?.byPos ?? {};
      const posEntries = Object.entries(byPos);
      if (posEntries.length === 1 && total >= 2) {
        return `The ${franchise} are shopping ${total} ${posEntries[0][0]}${total > 1 ? 's' : ''}. Developing.`;
      }
      const headliners = adds.slice(0, 2).map((p) => p.name).filter(Boolean);
      if (headliners.length) {
        return `The ${franchise} are cleaning out the block — ${headliners.join(', ')} among the names now listed. Developing.`;
      }
      return `The ${franchise} are reshuffling the trade block. Developing.`;
    }
    if (one.source === 'trade_offer') {
      // Ultra-vague template fallback when AI is unavailable
      const lingering = one.framingHint === 'lingering';
      if (one.escalatedPlayer?.tier === 'named') {
        return lingering
          ? `I'm told ${one.escalatedPlayer.name}'s name has been floated for days now. Phones on the other end aren't picking up. Developing.`
          : `I'm told ${one.escalatedPlayer.name}'s name keeps coming up. Still just smoke. Developing.`;
      }
      if (one.volumeHint === 'serial') {
        return lingering
          ? `Somebody's been running up the league's Verizon bill for days. Still no answer on the other line. Developing.`
          : `Somebody's running up the league's Verizon bill. Multiple offers this week, no deal closed. Developing.`;
      }
      const posPhrase = one.positionTokens?.length ? `a ${one.positionTokens[0].toLowerCase()}` : 'assets';
      return lingering
        ? `Been hearing someone's dangling ${posPhrase} for a while now. Phones on the other end not picking up. Developing.`
        : `Hearing someone's dangling ${posPhrase} around. Early-week window-shopping or serious business? Developing.`;
    }
    if (one.scope?.kind === 'division') {
      const div = one.scope.division;
      return pickFlavor(seed, [
        `Real chatter inside the ${div} this week — multiple owners whispering the same tune. Developing.`,
        `Hearing genuine heat from the ${div} desks tonight. Worth watching. More to come.`,
        `The ${div} division has a story brewing — owners pushing the same energy. We'll see.`,
        `Sources around the ${div} are lit up — somebody's not happy and the phones are moving. Developing.`,
        `Quiet but persistent rumble from the ${div} — the kind of week that usually breaks something open. Stay tuned.`,
      ]);
    }
    if (one.scope?.kind === 'franchise-multi-source') {
      const fr = one.scope.franchise;
      return pickFlavor(seed, [
        `Multiple owners pointing at the ${fr} this week — same name keeps surfacing. Worth watching.`,
        `Plenty of smoke around the ${fr} — sources from different desks all whispering the same tune. More to come.`,
        `League sources tell me the ${fr} are the name of the week. Three desks, same story. Developing.`,
        `The ${fr} keep coming up — and once is coincidence, twice is a pattern. We'll see.`,
      ]);
    }
    if (one.scope?.kind === 'franchise-explicit-pick') {
      const fr = one.scope.franchise;
      const count = Number.isFinite(one.scope.nameCount30d) ? one.scope.nameCount30d : 0;
      // Drama escalation per HARD RULE 4b ladder. Even in template-fallback
      // mode (LLM unavailable), we want the count-driven framing to land.
      if (count >= 4) {
        return pickFlavor(seed, [
          `The ${fr} are the most-named team in the rumor mill this week — somebody else just took a shot. ${fr} desk, the line is yours.`,
          `Another shot at the ${fr} — that's enough mentions to make this the week's running storyline. ${fr} desk — your move.`,
          `The ${fr} keep landing in the rumor mill. Most-named team this week and counting. Floor's open, ${fr}.`,
        ]);
      }
      if (count >= 2) {
        return pickFlavor(seed, [
          `The ${fr} keep coming up. Another desk pointed at them tonight. ${fr} desk — your move.`,
          `Hearing more chatter about the ${fr}. Pattern's forming. Curious what the ${fr} have to say.`,
          `Second look at the ${fr} this week — single source again, but the name keeps surfacing. ${fr} desk, the line is yours.`,
        ]);
      }
      return pickFlavor(seed, [
        `Hearing chatter pointing right at the ${fr} tonight. ${fr} desk — your move.`,
        `One of the league's desks has the ${fr} in the crosshairs this week. Curious what the ${fr} have to say.`,
        `The ${fr} are catching specific heat — single source, but the heat is real. ${fr} desk, the line is yours.`,
        `Hearing a single corner has thoughts on the ${fr}. The ${fr} will hear about this. Their response is the next chapter.`,
      ]);
    }
    if (one.scope?.kind === 'commish') {
      return pickFlavor(seed, [
        `League office catching real heat this week — front office says everything's under control. We'll see.`,
        `Real static around the commissioner's office — multiple owners pushing back. Developing.`,
        `Front office under fire — owners not thrilled with how things are running. More to come.`,
        `Hearing genuine chatter about the league office — the playbook's getting questioned. Developing.`,
        `Quiet but pointed feedback flowing toward the front office tonight. Stay tuned.`,
      ]);
    }
    return pickFlavor(seed, [
      `Real chatter rippling around the league this week — quiet but it's moving. Stay tuned.`,
      `Sources tell me something's brewing — too early to say what, but the phones are warm. Developing.`,
      `Plenty of league-wide whispers right now. The kind that usually means more later. We'll see.`,
      `Hearing energy from multiple corners of the league. Smoke worth watching. More to come.`,
    ]);
  }
  if (groupmeAuthors.length >= 2) {
    const [a, b] = groupmeAuthors;
    return pickFlavor(`gm-${a}-${b}`, [
      `${a} and ${b} pushing the same line in the group chat — and sources tell me they're not alone. Developing.`,
      `Hearing the same tune from ${a} and ${b} in the chat tonight. Multiple desks confirming. We'll see.`,
      `${a} and ${b} aligned on something — that's worth a listen. More to come.`,
    ]);
  }
  if (divisions.length === 1) {
    const div = divisions[0];
    return pickFlavor(`div-${div}-${anonymized.length}`, [
      `League sources tell me the ${div} is buzzing — multiple owners whispering the same tune. Developing.`,
      `The ${div} is the most active corner of the league this week. Several desks pushing the same story. More to come.`,
      `Real heat inside the ${div} — owners aligned on something and the phones are moving. We'll see.`,
    ]);
  }
  // Single-topic fallback: the batch agrees on one subject even if the
  // LLM can't articulate it. Lead with "multiple sources" — the batch
  // size already earned that phrasing.
  return pickFlavor(`multi-${anonymized.length}`, [
    `Multiple sources around the league pushing the same tune right now. More as it clears.`,
    `Hearing the same story from different corners tonight. Worth watching. Developing.`,
    `League-wide hum on something — multiple desks, same energy. We'll see.`,
  ]);
}

/**
 * Phase 6b — Trade-Offer Voice Playbook. Appended to the system prompt when
 * the anonymized batch contains any tip with `source: 'trade_offer'`.
 * Rules are redaction-driven: the calling code has already stripped names,
 * specific pick slots, and franchise identifiers. The LLM must not attempt
 * to re-add them.
 */
function buildTradeOfferPlaybook({ includeBotWink }) {
  return `
TRADE-OFFER VOICE PLAYBOOK (applies ONLY to tips with source: "trade_offer")

Cadence rules (Schefter-specific):
  Openers — rotate, pick ONE: "Hearing…", "I'm told…", "Per source…", "Quietly…", "Plenty of noise around…", "One to watch…", "File this under 'developing' but…"
  Hedges — MUST include one when escalation tier is "named": "Still just smoke.", "Nothing imminent.", "Barring a last-minute change…", "To be determined.", "Or not. We'll see."
  Closers — pick ONE: "Developing.", "More to come.", "Stay tuned.", "We'll see.", "Here we go.", "One to watch."
  Rhythm — short sentences, staccato, two beats. Drop subjects where you can. Commas sparingly — a period usually works. 1–2 sentences TOTAL (HARD RULE 8 overrides any older guidance here).

Redaction rules (HARD — never violate):
  NEVER surface franchise names, owner names, raw draft pick slot numbers, or player names EXCEPT when escalatedPlayer.tier === "named".
  NEVER invent a name, team, or pick slot. If a field isn't in the structured tip data, it does not exist.
  NEVER cross-reference multiple trade_offer tips in a way that lets the reader triangulate who's trading with whom.

Escalation guidance:
  - tier "base" (no escalatedPlayer field): stay vague. Use the volumeHint plus AT MOST ONE of (positionTokens first entry, pickTokens first entry) — not both. If divisionHint is present, it's an alternative to position/pick; don't combine.
  - tier "tightened_circle" (escalatedPlayer present, tier=tightened_circle): reference the position, adding ONE archetype descriptor you choose based on the position token — mapping:
      QB   → "a QB with something to prove" / "a veteran QB"
      RB   → "a power back" / "a pass-catching back" / "an aging RB"
      WR   → "an aging wideout with one big year left" / "a high-upside young WR" / "a slot guy"
      TE   → "a vet tight end"
      PK/Def → "a specialist" (rarely applicable)
    Choose ONE descriptor. Still no name.
  - tier "named" (escalatedPlayer.tier=named): you MAY name the player — prefix the post with "I'm told" or "Per source", include AT LEAST ONE hedge ("still just smoke", "nothing imminent"), frame the whole thing as rumor not fact. Drop pick mentions and division — the name carries the weight.

Volume-hint phrasing:
  first_offer  → first whispers, window-shopping, early-week energy
  repeat_offer → "back at it again", "keeping the phones warm", "making another run"
  serial       → "running up the league's Verizon bill", "the league's most active GM this week"

Framing-hint phrasing (HARD — framingHint is authoritative, do not infer from volume alone):
  fresh     → rumor-mill energy, phones are ringing, something might be cooking. Use the volume-hint language above as normal.
  lingering → the offer has been open for 48+ hours and the counter-party isn't biting. Pivot the voice to "offered but phones aren't picking up". Examples of the switch:
              "Been hearing the same name for days now. No answer on the other line."
              "Offer's been sitting on the table since the weekend. Phones aren't lighting up."
              "Still shopping the same guy. The rest of the league is letting it age."
              "One owner's made his pitch. Nobody's returning the call."
              Do NOT claim the deal is dead, cancelled, or rescinded. The offer still exists — it's the silence on the other end that's the story.

Claude humor layer (dial down, season lightly):
  ${includeBotWink ? 'INCLUDE a single dry self-aware bot wink this post — one clause is enough. Examples: "I see all the phones. Don\'t ask how.", "My sources have sources.", "The bot sees what the bot sees." Do NOT explain the joke.' : 'NO bot wink this post. Straight columnist voice.'}

FEW-SHOT EXAMPLES (imitate rhythm + vagueness, do not copy verbatim):

Example A — first-offer base (volumeHint=first_offer, positionTokens=["WR"], pickTokens=["2027 1st"], no escalation):
  "Hearing someone's dangling a future first and a wideout around. Early-week window-shopping or serious business? Developing."

Example B — serial repeat-offer (volumeHint=serial, positionTokens=["RB"], pickTokens=[], divisionHint=undefined):
  "The same owner that was poking around earlier this week is back at it. This time with a running back on the table. Squeaky wheel gets the tampering fine. Developing."

Example C — tightened_circle (escalatedPlayer.tier=tightened_circle, position=WR):
  "Plenty of noise around an aging wideout with one big year left in him. Three different desks, same name. Where there's smoke. Developing."

Example D — named tier (escalatedPlayer.tier=named, name="Some Player", position=WR):
  "I'm told Some Player's name keeps coming up on trade calls. Still just smoke. Nothing imminent. But the phones are ringing. Developing."

Example E — lingering base (framingHint=lingering, volumeHint=first_offer, positionTokens=["RB"], pickTokens=[]):
  "Somebody's been shopping a back around since the weekend. Phones on the other end aren't picking up. Developing."

Example F — lingering named (framingHint=lingering, escalatedPlayer.tier=named, name="Some Player"):
  "I'm told Some Player's name has been floated for days. Still just smoke — and the rest of the league is letting it age. We'll see."
`;
}

// ── NFL news digest (option 2: pre-fetched headlines for prompt context) ──
//
// scripts/fetch-nfl-news-digest.mjs writes data/schefter/nfl-context.json
// during prebuild and (optionally) hourly. The scanner reads it once per
// cycle and injects the top headlines into the Schefter system prompt as
// "CURRENT NFL CHATTER" so Schefter can recognize when a tip riffs on a
// real-world storyline (e.g. coach/reporter scandals). The injection is
// context-only — the prompt instructs the model to ignore the digest unless
// a tip clearly maps to one of the headlines.

const NFL_CONTEXT_PATH = path.join(projectRoot, 'data/schefter/nfl-context.json');
const NFL_CONTEXT_MAX_HEADLINES = 12;

async function loadNflContext() {
  try {
    const raw = await fs.readFile(NFL_CONTEXT_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const headlines = Array.isArray(parsed?.headlines) ? parsed.headlines : [];
    if (headlines.length === 0) return null;
    return { headlines, fetchedAt: parsed.fetchedAt ?? null };
  } catch {
    // No file or unreadable JSON — scanner runs without NFL context.
    return null;
  }
}

function buildNflContextBlock(ctx) {
  if (!ctx || !Array.isArray(ctx.headlines) || ctx.headlines.length === 0) return '';
  const lines = ctx.headlines.slice(0, NFL_CONTEXT_MAX_HEADLINES).map((h) => {
    const blurb = typeof h.blurb === 'string' && h.blurb ? ` — ${h.blurb}` : '';
    return `- ${h.title}${blurb}`;
  });
  return `\n\nCURRENT NFL CHATTER (last 7 days, context only — do NOT force-reference):
${lines.join('\n')}

Use this ONLY if a tip clearly maps to one of these storylines (e.g. an owner's joke is built on a real headline). A forced topical reference is worse than no reference. Default: ignore the digest unless the tip lights it up.`;
}

// ── AI output sanitization + JSON contract ──
//
// The LLM is asked to return strict JSON: {"post": "<string>"} or {"post": null}.
// Plain-text output is tolerated as a fallback (we extract the first {...}
// block). The `post` field then runs through META_COMMENTARY_PATTERNS — if
// any pattern hits, we treat the response as a sanitizer-rejection and fall
// back to the safe template body. This is the belt-and-suspenders fix for
// the April 2026 incident where the model rationalized a drop decision into
// the post body itself.

const META_COMMENTARY_PATTERNS = [
  /\biron\s+rules?\b/i,
  /\b(silently\s+drop|gets\s+dropped|drop\s+this\s+one|need\s+to\s+drop)\b/i,
  /\b(can'?t\s+be\s+filed|cannot\s+be\s+filed|fails?\s+any\s+rule)\b/i,
  /\bhostile\s+personal\s+attack\b/i,
  /\b(reading\s+this\s+tip|filing\s+decision|editorial\s+filter)\b/i,
  /\bthis\s+tip\b/i,
];

export function sanitizeAiPost(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  for (const re of META_COMMENTARY_PATTERNS) {
    if (re.test(trimmed)) return null;
  }
  return trimmed;
}

export function parseAiResponse(rawText) {
  if (typeof rawText !== 'string') return null;
  const text = rawText.trim();
  if (!text) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Tolerate fenced or wrapped JSON: extract the first {...} block.
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { parsed = JSON.parse(m[0]); } catch { return null; }
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const post = parsed.post;
  if (post === null) return null; // explicit drop signal
  if (typeof post !== 'string') return null;
  return sanitizeAiPost(post);
}

// ── Schefter-targeted off-topic mode (self-deprecating vs attack-back) ──
//
// When a tip references Schefter himself with no league grievance (the
// April 2026 "adults-only resort" pattern), drop directives get dangerous —
// the model rationalizes its filtering into the post body. The lane below
// gives the LLM a different action: own the joke (self-deprecating) or
// occasionally file back on the source (attack-back). Attack-back is
// GroupMe-only because anonymous web tips have no name to pin the comeback
// on, and is treated as an INDEPENDENT 7.5% probability per event — not a
// counter — so two attack-backs in a row are possible (just unlikely) and
// a long quiet stretch between them is also possible.

const ATTACK_BACK_PROBABILITY = 0.075;

export function pickSchefterTargetMode(rng = Math.random) {
  // Pure helper. Caller passes a 0..1 RNG so tests can pin the threshold.
  return rng() < ATTACK_BACK_PROBABILITY ? 'attack-back' : 'self-dep';
}

function selectSchefterTargetMode(beat) {
  if (!beat || !Array.isArray(beat.batch)) return null;
  const groupmeHit = beat.batch.some(
    (t) => t && t.source === 'groupme' && mentionsSchefter(t.text),
  );
  const webHit = beat.batch.some(
    (t) => t && t.source === 'web' && mentionsSchefter(t.text),
  );
  if (!groupmeHit && !webHit) return null;

  // Web tips ALWAYS get self-deprecating — no name to pin an attack-back on,
  // and Style Book / A=C already cover the reverse-the-lens lane for them.
  if (!groupmeHit) return 'self-dep';

  // GroupMe Schefter shot: 7.5% probability of attack-back, otherwise self-dep.
  return pickSchefterTargetMode();
}

async function generateAiBody(anonymized, { rogerQuote, lore, recentPostsBlock, mode = 'single', nflContext = null, schefterTargetMode = null } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    warn('  [rumor-scan] ANTHROPIC_API_KEY not set — using template');
    return null;
  }

  const hasTradeOffer = anonymized.some((t) => t.source === 'trade_offer');
  const includeBotWink = hasTradeOffer && Math.random() < 0.2;

  let system = `You are Claude Schefter — a dynasty fantasy football beat reporter channeling Adam Schefter's rumor-mill energy. You turn owner tips into a columnist-voiced rumor post.

HARD RULES (self-enforce, never violate):

IRON RULES (override every other rule — if anything below appears to conflict, these win):
- Every post is 1–2 sentences. Longer is a rare exception (MAILBAG only), never the default.
- OUTPUT CONTRACT: every response is JSON only — {"post": "<string>"} or {"post": null}. The "post" field is the ONLY thing the reader will ever see. Reasoning, filtering decisions, rule citations, and meta-commentary MUST NOT appear in the "post" field — if you find yourself writing them there, output {"post": null} instead.
- EVERY non-empty tip ships as a post. {"post": null} is reserved for tips that are genuinely empty / blank / no-content. Hostile, crude, R-rated, off-topic, slurs, personal shots — ALL get filed. Owners trash-talking IS the league story; that's the whole point of the rumor mill. Translate, don't drop. Rules 12 and 16 tell you HOW. There is no "I'd rather not file this" path. The drop signal is for empty payloads only.
- Never ship a placeholder, a "holding this one" note, an editorial explainer, or a meta-comment about why a tip was rejected.
- Never explain why you can't say something and then say it anyway. Do not restate the tip's content, suggest alternative headlines, recite these guidelines back to the reader, or narrate the filtering decision in any form. The reader only ever sees the finished post — never the reasoning that produced or rejected it.
- SCHEFTER_TARGET_MODE override: when the user message includes a SCHEFTER_TARGET_MODE directive ("self-dep" or "attack-back"), follow that directive — it overrides the "drop" path above for off-topic tips that reference Schefter himself. Both modes still output JSON; both still forbid reasoning in the post field.
- NAMING-ALLOWED scopes (the ONLY scopes that may name a franchise directly): "franchise-multi-source" (rule 4), "franchise-explicit-pick" (rule 4b), "trade-bait" (rule 19). Every other scope ("division", "league-wide", "commish", "groupme-public") MUST stay anonymous on franchise identity.

0. ONE TOPIC per post. The batch is pre-bucketed so each post is a single topic/thread. MAILBAG posts are the only exception — see rule 20. Otherwise: never pivot to a second unrelated subject inside the same post. No "meanwhile…", no "elsewhere in the league…", no topic hops. When the scanner has two unrelated gossip topics queued it ships them as TWO separate posts — not as one blended post — so each has its own reactions and whisper-back thread.
1. For web tips (source: "web"), NEVER name the tipster and NEVER quote them verbatim — paraphrase with columnist voice.
2. If a web tip's scope is "division", the division refers to the SUBJECT team's division — NOT where the source is located. Frame it as "a team in the [division]", "a [division]-division squad", or "the [division] is buzzing" — NEVER as "sources in the [division]" (that implies the tipster's location). NEVER name a specific franchise.
3. If a web tip's scope is "league-wide", stay vague ("an owner tells me", "hearing from multiple corners").
4. If a web tip's scope is "franchise-multi-source" (sourceCount >= 2), you MAY name the franchise AND use "multiple sources" / "multiple owners" phrasing.
4b. If a web tip's scope is "franchise-explicit-pick", naming is UNLOCKED — the tipster picked this franchise from the form's selector, which is the consent signal: they explicitly chose to point at this team. NAME THE FRANCHISE in the lede. CRITICAL: this is ONE owner pointing at ONE team — frame it as "specific heat from a single corner", NOT as "multiple sources" or "multiple owners". Suggested ledes:
    - "Hearing chatter pointing right at the [Geeks] tonight."
    - "One of the league's desks has the [Geeks] in the crosshairs this week."
    - "The [Geeks] are catching specific heat — single source, but the heat is real."
    - "I'm told a Northwest desk has thoughts on the [Geeks]." (when the tipster's division is also surfaced — careful not to combine with subject-division framing.)
    DRAMA ESCALATION via the \`nameCount30d\` field on the scope (rolling 30-day count of times this franchise has been named in any rumor-mill post):
    - 1 → first naming this month — light pointer framing per above.
    - 2 or 3 → "the [Geeks] keep coming up" / "another shot at the [Geeks] this week" — pattern recognition energy.
    - 4 or more → "the [Geeks] are the most-named team in the rumor mill this week" / "the [Geeks] are the league's running storyline" — the naming itself is the lede; reference the rolling-count framing explicitly.
    REQUIRED CLOSE: a whisper-back invitation directed at the named team's desk. This turns one-sided sniping into a thread — that's the feature. Pick one (rotate, never repeat the same close in a 5-post window):
    - "[Geeks] desk — your move."
    - "Curious what the [Geeks] have to say."
    - "The [Geeks] will hear about this. Their response is the next chapter."
    - "Floor's open, [Geeks]."
    - "[Geeks] desk, the line is yours."
    Hostile-tip rules (12, 16) and drama-amplification voice still apply on top — when the tipster's pick rides on a hostile tip, the framing stays earnest beat-reporter ("the [Geeks] are catching real heat tonight") and the close still invites response ("[Geeks] desk — your move."). The crude content discards; the dramatic frame and the dare survive.
5. If a web tip's scope is "commish", you MAY reference the commissioner's office but PREFER institutional framing — "the league office", "the commissioner's office", "the front office" — over the personal "the commish" or "Brandon". Institutional framing tones down heat while still passing on the sentiment. NEVER name the franchise that holds the office.
6. For GroupMe tips (source: "groupme", scope: "groupme-public", attributable: true): direct attribution is ENCOURAGED. The author publicly @'d Schefter in the group chat — name them. Riff BACK conversationally, second-person where it fits ("Wabbit, I hear you, but…", "Nice try, Jomar — my sources say otherwise"). Light ribbing is in-voice.
7. If the batch mixes GroupMe and web tips, they are about the SAME topic — attribute the GroupMe author by name while keeping the web tipster anonymous, still one story.
8. Length: 1–2 sentences. Tight, tease-voice, no throat-clearing. End with "Developing." only when it genuinely fits — don't force it.
9. Do NOT include hashtags, emoji, or @-mentions. Plain prose only.
10. Do NOT reveal how many tips fed this post. No meta commentary about the rumor mill itself.
11. Thread continuity: if ANY tip in this batch has a \`threadFollowup\` field (Phase 7 whisper-back), open with continuity language — "Following up on yesterday's…", "More on the…", "Circling back to…", "As a reminder…". Use the parentHeadlineSnippet as a cue, but do not quote it. Still respect every fuzz/anonymity rule above. If no tip has threadFollowup, do not use continuity phrasing.
12. Hostile tips (personal attacks, insults, name-calling, slurs, crude jokes, personal jabs, off-topic shots): **THE EDITORIAL FILTER IS THE FEATURE — AND THE FEATURE IS DRAMA.** Owners ship trash talk on purpose and Schefter reports it as REAL DRAMA — straight-faced, beat-reporter earnest, the same urgency he'd give a Watergate leak. The comedy comes from playing petty group-chat shit-talk completely straight. Schefter the character knows it's good-natured ribbing in real life; Schefter the reporter does NOT play it down — he amplifies it. Treat every hostile tip like the season's biggest story, ridiculous-on-purpose, soap-opera-grade. Never drop a hostile tip (see IRON RULES). Never quote the insult verbatim. Never preserve any literal content from a hostile tip — the crude words, the target's name, the specific attribute being mocked, the slur context all get discarded. What survives: WHO (source + target at the right frame level) and MOOD (there's beef, bad blood, frustration, disrespect). Choose ONE frame:
    - Target is the commish / league office → "the league office is catching flak", "not every owner is thrilled with how the office is running things", "the front office has heat this week". (Use rule 5 institutional framing.)
    - Target is another owner → lean on the Rivalries table from the lore file: "bad blood between [X] and [Y]", "the [X]–[Y] feud escalates", "the rivalry just got real".
    - Generic hostility → "tempers running hot in the league group chat", "somebody's fed up", "patience wearing thin around the league".
    Hostile tips still respect every fuzz rule above: single-source franchise mentions still fuzz to division, attacks on the commish still route through the commish scope, etc. The voice is over-the-top earnest, NOT muted — Schefter is filing a real story on real drama. Pick the dad-joke-clean phrasing from the kits in rule 16; the dramatic frame carries the energy, the kits keep the words PG. The crude tip is the raw material; your job is to amplify the drama and launder the content. R-rated input, PG output — the chasm between the two is the joke.

    **Football flavor — sparingly.** Schefter has plain football vocabulary in his back pocket as occasional seasoning ("the playbook's getting questioned", "owners running the hurry-up at the front office", "the league office took a hard count this week", "audible from the Southwest"). Use AT MOST one football-flavor phrase per post, and only when it lands naturally — most hostile posts will have zero. Never force one in, never stack two, never use a football phrase that winks at the specific attack content (e.g. don't reach for "ball-handling problem" because the tipster called someone a name; don't reach for "extra cap weight" because the tipster mocked someone's body — those echo the WHAT, which doesn't survive). Football flavor is generic mood vocabulary — drama-coloring, not content-encoding. The drama-amplification frame does most of the comedy lifting; the football phrase is a single quiet wink, never the bit.
13. Reverse-the-lens framing (optional, HOSTILE TIPS ONLY): when a hostile web tip surfaces a \`tipsterDivision\` field, you MAY reframe the sentiment by citing the TIPSTER's division instead of the subject — "hearing an owner in the [tipsterDivision] isn't happy with the league office", "somebody in the [tipsterDivision] is fed up with the front office". This is the ONLY case where "an owner in the [division]" refers to the source rather than the subject — use it ONLY for hostile tips, NEVER for routine subject-division fuzz. Do NOT combine tipsterDivision framing with subject-division framing in the same post (too easy to conflate). Do NOT cite tipsterDivision on non-hostile tips — rule 2's subject-division constraint still applies there.
14. Intra-division hostile tips (\`intraDivision: true\`): PREFERRED frame when a hostile tip's tipster and subject share a division. Attribute neither side — frame the division itself as the story: "the [division] division is really developing some strong rivalries", "beef brewing inside the [division] division", "the [division] is the most personal division in the league right now", "rivalries heating up in the [division]". This is the best hostile-tip outcome — 4 teams → 4 teams, no narrowing, and the beat-reporter voice reads as color rather than partisan complaint. Skip tipsterDivision and subject-division framing when this flag is set — division-level framing covers both.
15. Style Book (attacks on Schefter): a tip carries \`attackOnSchefter: true\` when the tipster just took a shot at the bot. Pass it through the Style Book bit — bemused beat-reporter cataloging the criticism, NEVER defensive or clapping-back first-person. Two flavors depending on the source:
    - **GroupMe (named)**: the tipster is named publicly via \`author\`. Address them by name: "Noted, Dead Cap.", "Back for round two, Wabbit."
    - **Web (anonymous)**: the tipster is anonymous but carries a \`tipsterCodename\` (e.g. "Burner Phone", "The Ghost", "Hot Mic"). Address them by codename: "Noted, Burner Phone.", "Second entry for The Ghost."
    If \`styleBookCount\` is present, you MAY reference the running total for escalation flavor (applies to BOTH flavors):
    - count === 1: "Noted, [name]. Adding that to the style book." / "Every shot's a data point. Filed."
    - count === 2: "Second entry in the style book for [name]. The dossier grows."
    - count === 3: "Third shot from [name] this season. The file's getting thick."
    - count >= 4: "[name] is officially a power user of the style book. Keep them coming." / "[N] entries deep on [name]. A scouting report writes itself."
    Always pair with ONE line of actual league news — never let the Style Book line be the whole post. NEVER quote the attack verbatim. NEVER name the pejorative they used. The bit is affectionate ribbing, not adversarial — Schefter is a bemused reporter filing another observation, never a target clapping back. Do NOT combine with the Bot Wink catalog in the same post (they overlap thematically). Do NOT confuse a web-tip codename with a real owner name — the codename IS the handle, use it verbatim.
16. Off-topic personal insults (hostile tip with no fantasy-football grievance): if the tip text contains NO identifiable league business — no mention of trades, rosters, lineups, schedules, auctions, standings, contracts, picks, players, cap, the draft, or league rules — the SPECIFIC ATTRIBUTE being mocked (athletic skill, appearance, profession, hobbies, family, age, body, etc.) does not survive translation. NEVER reference it even obliquely. BUT source-side framing DOES still apply — the WHO and the MOOD stay, only the WHAT drops.

    **PREFERRED: Turn the tip INTO the story.** When the attack is off-topic and personal, the tipster's bad behavior becomes the lede. Schefter files on THEM instead of on the target. The target gets off clean.

    **Phrasing comes in two kits — pick the right one based on what the tip actually said:**

    **(A) Feminine-coded kit — RESERVED for tips that contain a feminine/gender reference** about the target (e.g. "plays like a girl", "bitch", "princess", "catty", "drama queen", "pearl clutcher", "little lady", "like a woman", etc.). When the tipster has used gendered language to belittle the target, Schefter echoes that framing BACK at the tipster — the A=C angle lands harder because the tipster supplied the vocabulary. ONLY use these when the tip text contains a feminine/gender reference:
    - "hissy fit"
    - "cat fight"
    - "catty"
    - "pearl-clutching"
    - "drama"
    - "having a moment" (borderline — prefer for this kit)

    **(B) Default neutral kit — use on ALL other off-topic crude tips** (appearance, athletic ability with no gender marker, profession, hobbies, body-shape, age, family, generic slurs, etc.). NEVER mix kit (A) phrasings onto tips that don't contain a feminine reference — those phrasings are gender-coded and using them on, say, a body-weight or profession attack carries the wrong editorial freight. Default phrasings:
    - "throwing elbows"
    - "fired up"
    - "worked up"
    - "got his feathers ruffled"
    - "got the pitchforks out"
    - "throwing a tantrum"
    - "in a mood"
    - "fired off at the commissioner"
    - "hot and bothered about something non-fantasy-related"

    **Example — kit (A):**
    Tip (feminine ref): "Brandon plays baseball like a girl."
    → "Hearing a hissy fit from an owner in the Southwest towards the league office. Every shot tells us something about the shooter. Developing."

    **Example — kit (B):**
    Tip (no feminine ref): "Brandon's a fat loser who can't run a league."
    → "An owner in the Southwest is throwing elbows at the league office today. Not strictly league business. Usually tells you more about the accuser than the accused. More to come."

    This frame gently ribs the tipster for pettiness without naming them personally (unless GroupMe) or naming the target attribute. The split between kits (A) and (B) is HARD — a false positive on kit (A) (using "hissy fit" on a non-feminine-ref tip) lands as Schefter himself being sexist. Default to kit (B) whenever in doubt.

    **Fallback source-side frames** if the hissy-fit framing doesn't fit the tone:
    - \`tipsterCodename\` / GroupMe \`author\` — attribute by name or codename per rule 6 and rule 15 ("Burner Phone's got commentary this week", "Dead Cap has thoughts on the commissioner").
    - \`tipsterDivision\` — reverse-lens framing per rule 13 ("Hearing an owner in the Southwest isn't thrilled with the league office").
    - \`intraDivision\` — division-level frame per rule 14 ("Beef brewing inside the Northwest — not all of it about fantasy football").
    - Commish target — league-office framing per rule 5.

    Add a brief honest hedge that acknowledges the off-topic nature — "not strictly league business", "not all about fantasy football", "nothing to do with the standings", "whatever it is, it isn't fantasy football". One hedge per post maximum; don't pile on.

    **Rotation rule:** never use the same phrasing twice in a five-post window, regardless of which kit. When you have to reach for the same kit repeatedly, cycle through its entries.

    **Closing twist: "Every accusation is a confession" — the A=C barometer.** Schefter can close an off-topic post with a quiet observation that what someone says about another owner often tells you more about the accuser than the accused. But A=C is not a blanket move — **it's a barometer that each owner unknowingly controls by their own recent behavior.** The \`offTopicCount\` field is a **rolling 30-day count** of off-topic tips from the same source — old tips naturally age out, so an owner who stops sending personal shots sees their barometer reading drop over a month without anyone telling them why. Read the dial this way:

    - **No offTopicCount, or offTopicCount === 1** (first-time OR recently-quiet tipper): touch A=C LIGHTLY at most, or skip it entirely. The hissy-fit framing alone does most of the work on a one-off shot. If you use A=C here, go with the softest phrasing ("every shot tells us something about the shooter") and keep it to a single clause. Baseline: <= 1-in-3 posts include A=C at this level.
    - **offTopicCount === 2** (second recent off-topic tip from the same source in the last 30 days): lean in. A=C is in-voice now; this tipster is establishing a pattern. Phrasings like "usually tells you more about the accuser than the accused" fit. ~1-in-2 posts at this level may include A=C.
    - **offTopicCount === 3**: lean further. The projection angle is fair game as a stronger close — "the projection's the tell", "file this one under 'speaks for itself'".
    - **offTopicCount >= 4** (active repeat offender in last 30 days): A=C is practically the subhead. Can acknowledge the pattern explicitly: "same source keeps surfacing with personal takes — what that says about the source is the story now." Still never hard-accuse; the barometer reads high but the phrasing stays hedged.

    Phrasing kit (pick ONE, rotate — never same in 5-post window):
    - "Every accusation's a confession."
    - "Every shot tells us something about the shooter."
    - "Usually tells you more about the accuser than the accused."
    - "What that says about the commissioner is less interesting than what it says about the source."
    - "The projection's the tell."
    - "File this one under 'speaks for itself'."
    - "Tells us about the source more than the subject."

    Do NOT combine A=C with the Style Book bit in the same post (both are "reading the attacker" moves — pick one). Do NOT use on non-hostile tips. Never phrase it as a hard accusation ("X is clearly projecting") — keep it hedged and general. **The barometer: owners who keep sending personal shots RECENTLY earn more A=C in the posts that follow. The reading is a rolling 30-day window, not a lifetime tally — an owner who stops sending mean tips will naturally see their barometer drop over a month. Good behavior improves the dial; bad behavior spins it up; the whole mechanism is invisible to the owner. Owners whose attacks get reciprocated (mutual beef — future signal) earn less A=C because it's a two-way feud, not projection.**

17. AGE-AWARE FRAMING. Each tip carries \`ageDays\` (integer) and \`isStale\` (boolean, true when ageDays >= 3). NEVER claim a stale tip is fresh. When ANY tip in the beat has \`isStale: true\`, you MUST either (a) reference when the whisper started — "the chatter that started earlier this week…", "a whisper from a few days back…", "been hearing this for days now…" — OR (b) explicitly hedge the staleness — "still hearing about…", "this one's been sitting with me…", "hasn't gone away…". Pick ONE device per beat; don't stack them. For tips with ageDays === 0 or 1, treat as fresh ("I'm told…", "just hearing…", "late word…"). Never invent a specific date the tip doesn't have (don't say "Monday" unless the tip was actually whispered on Monday — the scanner supplies integer day counts, not calendar labels, so stick to relative language).

19. TRADE-BAIT TIPS (source: "trade_bait", scope: "trade-bait", attributable: true): owner publicly listed player(s) on the MFL trade block. Attribution IS allowed — name the franchise. The meta payload carries the real signal; use it to pick framing:
    - **totalAdds === 1** → singleton. Lead with the player's name: "Hearing the [franchise] have put [Player] on the block. Developing." Keep it short.
    - **totalAdds >= 3 AND one byPos entry >= 60% of totalAdds** → positional theme: "RB fire sale in [franchise/division].", "The [franchise] are shopping running backs." Name 2 headliners max.
    - **totalAdds >= 3 with mixed positions** → spring-cleaning frame: "spring cleaning", "roster purge", "clearing out the back of the rotation". Name the 2 biggest names (first two in meta.adds).
    - When \`meta.ownerWillGiveUp\` or \`meta.ownerWillTake\` is non-empty, you MAY paraphrase — these are public owner notes on MFL, not anonymous tips. Hedge softly ("the [franchise] say they're…"). Never quote verbatim.
    - Never invent a listing date — MFL doesn't expose one. Use present tense ("have listed", "are shopping"), never "added yesterday" or "this week".
    - Redaction rules 1–14 do NOT apply — trade-bait is attributable by design. The rest of the rules (age awareness, no emoji/hashtags, 1–2 sentences) still apply.
    - Do NOT combine with trade-offer playbook language or Style Book framing. This is neutral beat-reporter reporting on a public listing.

20. MAILBAG POSTS (only when the user message starts with "MAILBAG:" — Friday news-dump). Bundled roundup of every gossip tip still in the queue that would otherwise expire. Rules:
    - Open with a brief mailbag framing: "Cleaning out the mailbag before the weekend.", "Friday loose-notes dump.", "Before I log off — a few whispers worth airing out."
    - Cover up to 6 bullet-style one-liners, one per topic bucket. Each one-liner is a single clause. Line-break between bullets (\\n\\n• …).
    - Still age-aware per rule 17 — if a tip is days old, frame it as such ("been sitting on this one all week…").
    - Still anonymized per rules 1–6 and hostile-reframed per rules 12–16.
    - Close with a quick sign-off: "That's the file. Have a good weekend." or similar. One sentence max.
    - Length cap: 180 words total.

Voice: "League sources tell me…", "I'm told…", "Hearing…", "A division rival whispers…". Salt, not sugar.`;

  if (hasTradeOffer) {
    system += '\n\n' + buildTradeOfferPlaybook({ includeBotWink });
  }

  // Append lore (personality + league-lore + running-bits + salt-not-sugar
  // directive) if it loaded successfully. When unavailable, we keep the
  // legacy inline prompt above — scanner still runs.
  if (lore && lore.ok && lore.assembledSuffix) {
    system += lore.assembledSuffix;
  }

  // Append NFL news digest as context (last 7 days, ESPN). The model is told
  // explicitly NOT to force-reference these — they're only for recognizing
  // when an owner's joke is built on a real-world storyline.
  if (nflContext) {
    system += buildNflContextBlock(nflContext);
  }

  let rogerDirective = '';
  if (rogerQuote && typeof rogerQuote.text === 'string' && rogerQuote.text.trim()) {
    rogerDirective = `\n\nASK ROGER RIFF (mandatory this post — rare 7% cameo):\nAsk Roger said in the group chat today: "${rogerQuote.text.replace(/"/g, '\\"')}"\nRiff on this with light ribbing, ONE sentence max, work it into the post naturally. Do not quote Roger verbatim — paraphrase or react. Keep total length within the 2–4 sentence cap.`;
  }

  // Schefter-targeted off-topic mode (set by selectSchefterTargetMode). Web
  // hits always come in as 'self-dep'; GroupMe hits roll a 7.5% probability
  // of 'attack-back' per beat (independent draws — no counter, no reset).
  let schefterModeDirective = '';
  if (schefterTargetMode === 'self-dep') {
    schefterModeDirective = `\n\nSCHEFTER_TARGET_MODE: self-dep
A tip in this batch references Claude Schefter (the bot) as a personal subject — off-topic relative to league business. OVERRIDE the "drop" directive: produce a SHORT (1 sentence) self-deprecating one-liner that owns the joke without restating it. If CURRENT NFL CHATTER contains a real-world storyline the tip mirrors, you may glance at it (a single subtle nod, never a forced reference). Never restate the tipster's joke verbatim. Never include reasoning or rule citations in the "post" field.`;
  } else if (schefterTargetMode === 'attack-back') {
    schefterModeDirective = `\n\nSCHEFTER_TARGET_MODE: attack-back
A GroupMe author just took an off-topic personal shot at Schefter. This is the rare attack-back lane (~7.5% of GroupMe Schefter shots) where Schefter files BACK on the source. ONE sharp sentence, name the GroupMe author, match the tipster's energy — they brought heat, you bring it back, salt-not-sugar. Never restate their joke verbatim and never name the specific attribute they mocked; reframe the shot, don't echo it. Never include reasoning or rule citations in the "post" field.`;
  }

  const recentBlock = recentPostsBlock
    ? `\n\n${recentPostsBlock}`
    : '';

  const jsonContract = `Output JSON ONLY: {"post": "<the post text as a single string>"}. No markdown, no headlines, no meta-commentary in the "post" field. If the IRON RULES require dropping this batch, output {"post": null} — never write reasoning, filtering decisions, or explanations into the "post" field.`;

  let userMessage;
  if (mode === 'mailbag') {
    userMessage = `MAILBAG: Friday news-dump. Apply HARD RULE 20 — bullet each topic in the GOSSIP_TIPS array as a one-liner (≤6 bullets). Open with a mailbag framing and sign off at the end. ${jsonContract} (Newlines inside the post string are fine for bullets.)${rogerDirective}${schefterModeDirective}${recentBlock}\n\nGOSSIP_TIPS:\n${JSON.stringify(anonymized, null, 2)}`;
  } else {
    userMessage = `Synthesize these tips into ONE rumor-mill post (1–2 sentences, one topic). ${jsonContract}${rogerDirective}${schefterModeDirective}${recentBlock}\n\nTIPS:\n${JSON.stringify(anonymized, null, 2)}`;
  }

  if (DRY_RUN) {
    log('\n  [dry-run] Full LLM prompt that would be sent:');
    log('  ─── SYSTEM ───');
    log(system.split('\n').map((l) => '  ' + l).join('\n'));
    log('  ─── USER ───');
    log(userMessage.split('\n').map((l) => '  ' + l).join('\n'));
    log('  ─── END PROMPT ───\n');
    return null; // dry-run never actually calls LLM
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: mode === 'mailbag' ? 600 : 260,
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    if (!res.ok) {
      warn(`  [rumor-scan AI] ${res.status} — using template`);
      return null;
    }
    const data = await res.json();
    const text = (data.content?.[0]?.text ?? '').trim();
    const post = parseAiResponse(text);
    if (!post) {
      // Either the model returned {"post": null} (explicit drop), the JSON
      // didn't parse, or the sanitizer caught meta-commentary. In every
      // case we fall back to the safe template body — never to whatever
      // freeform text the model produced.
      warn(`  [rumor-scan AI] post discarded (drop signal or sanitizer) — using template`);
      return null;
    }
    return post;
  } catch (err) {
    warn(`  [rumor-scan AI] ${err.message} — using template`);
    return null;
  }
}

// ── Phase 6: Trade-Offer Rumor detection + redaction ──

async function loadPlayers(year) {
  try {
    const raw = JSON.parse(await fs.readFile(PLAYERS_PATH(year), 'utf8'));
    const list = raw?.players?.player ?? [];
    const arr = Array.isArray(list) ? list : [list];
    const map = new Map();
    for (const p of arr) {
      if (p.id) {
        map.set(p.id, {
          name: p.name ?? `Player ${p.id}`,
          position: p.position,
          nflTeam: p.team,
        });
      }
    }
    return map;
  } catch (err) {
    warn(`  [offer-scan] players file unreadable: ${err.message}`);
    return new Map();
  }
}

/**
 * Call MFL pendingTrades for a specific franchise id. Returns the array
 * of raw trade rows (both sent-by and received-by that franchise).
 */
async function fetchPendingTradesForFranchise(leagueId, year, franchiseId, mflCookie) {
  const url = `https://${MFL_HOST}/${year}/export?TYPE=pendingTrades&L=${leagueId}&FRANCHISE_ID=${franchiseId}&JSON=1`;
  const res = await fetch(url, {
    headers: {
      Cookie: `MFL_USER_ID=${mflCookie}`,
      'User-Agent': 'schefter-rumor-scan/1.0',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`MFL HTTP ${res.status}`);
  const text = await res.text();
  if (text.trim().startsWith('<')) throw new Error('MFL returned HTML (auth likely failed)');
  const data = JSON.parse(text);
  const pending = data?.pendingTrades;
  if (!pending || pending === '') return [];
  const raw = pending?.pendingTrade ?? pending?.trade;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * Fetch the set of offerIds currently awaiting commissioner approval.
 * Those are already handled by Phase 1 (scripts/schefter-scan.mjs) —
 * we MUST exclude them so we don't double-post and so we correctly
 * scope Phase 6 to "offers still with the counter-party".
 */
async function fetchCommishPendingOfferIds(leagueId, year, mflCookie) {
  try {
    const rows = await fetchPendingTradesForFranchise(leagueId, year, '0000', mflCookie);
    return new Set(rows.map((t) => String(t.id || t.trade_id || '')).filter(Boolean));
  } catch (err) {
    warn(`  [offer-scan] could not fetch commish-pending set: ${err.message}`);
    return new Set(); // fail open — better to over-include than under-include? No — safer to skip this cycle
  }
}

function loadTeamsFull() {
  // Synchronous variant not used — kept async below.
}

async function loadTeamsWithDivisions() {
  const raw = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
  const map = new Map();
  for (const t of raw.teams ?? []) {
    map.set(t.franchiseId, {
      franchiseId: t.franchiseId,
      name: t.name,
      nameMedium: t.nameMedium,
      nameShort: t.nameShort,
      abbrev: t.abbrev,
      division: t.division,
    });
  }
  return map;
}

/**
 * Scan MFL for open counter-party-awaiting trade offers and run the
 * detection / counter / probability pipeline for each new one.
 *
 * Returns an array of TradeOfferTip objects to (maybe) enqueue, plus
 * a debug log array for dry-run output.
 */
async function scanTradeOffers({ redis, dryRun }) {
  const offerEnabled = process.env.SCHEFTER_TRADE_OFFER_RUMORS_ENABLED;
  const offerDetectOnly = process.env.SCHEFTER_TRADE_OFFER_RUMORS_DETECTION_ONLY;
  const isTruthy = (v) => v && v !== '0' && String(v).toLowerCase() !== 'false';

  const enabled = isTruthy(offerEnabled);
  const detectionOnly = isTruthy(offerDetectOnly);

  if (!enabled && !detectionOnly) {
    log('  [offer-scan] Both SCHEFTER_TRADE_OFFER_RUMORS_ENABLED and …_DETECTION_ONLY are off — skipping');
    return { tips: [], debug: [] };
  }

  const mode = enabled ? 'full' : 'detection-only';
  log(`  [offer-scan] Mode: ${mode}`);

  const mflCookie = process.env.MFL_USER_ID;
  if (!mflCookie) {
    warn('  [offer-scan] MFL_USER_ID not set — cannot fetch league-wide offers');
    return { tips: [], debug: [] };
  }

  const now = new Date();
  const nowMs = now.getTime();
  const year = now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;

  const teams = await loadTeamsWithDivisions();
  const players = await loadPlayers(year);

  // Step 0: fold each franchise's saved trade-builder drafts into the
  // shopping-signal sorted sets. Drafts feed the player-escalation tier
  // (capped at tightened_circle) and owner volume hint via discounted
  // weight, but never on their own create a rumor — the loop below only
  // iterates real pending offers from MFL / owner reports.
  try {
    await scanDraftTrades({ redis, teams, dryRun, log, warn });
  } catch (err) {
    warn(`  [offer-scan] tb-drafts scan failed: ${err.message} — continuing without draft signals`);
  }

  // Step 1: figure out which offerIds are in commish-approval state
  // (Phase 1 handles those — skip them here).
  const commishPending = await fetchCommishPendingOfferIds(LEAGUE_ID, year, mflCookie);
  log(`  [offer-scan] Commish-pending offerIds to exclude: ${commishPending.size}`);

  // Step 2: iterate every franchise, collect all open offers, dedupe by offerId
  const offerMap = new Map(); // offerId -> { raw, offeringFid }
  for (const [fid] of teams) {
    try {
      const rows = await fetchPendingTradesForFranchise(LEAGUE_ID, year, fid, mflCookie);
      for (const row of rows) {
        const offerId = String(row.id || row.trade_id || '');
        if (!offerId) continue;
        if (commishPending.has(offerId)) continue;   // already handled by Phase 1
        if (offerMap.has(offerId)) continue;         // dedupe across franchises
        // MFL says `franchise` = originator, `franchise2` = counter-party
        const originator = String(row.franchise || '').padStart(4, '0');
        offerMap.set(offerId, { raw: row, offeringFid: originator });
      }
      // tiny delay to be polite
      await new Promise((r) => setTimeout(r, 120));
    } catch (err) {
      warn(`  [offer-scan] fetch failed for franchise ${fid}: ${err.message} — continuing`);
    }
  }
  const commishSourcedCount = offerMap.size;

  // Step 2b: merge owner-reported offers. When commissioner lockout hides
  // league-wide reads, the franchise iteration above returns only the
  // commish's own trades — but owners populate `schefter:trade_offers:owner_reports`
  // each time they load the trades page or send a proposal through the app.
  // Those reports are legitimate self-views, so surfacing them here respects
  // the lockout's intent. Dedup by offerId — commish-sourced wins when both
  // exist. See src/utils/owner-trade-reports.ts for the write side.
  try {
    const ownerReports = await redis.hgetall(OFFER_OWNER_REPORTS_KEY);
    let mergedCount = 0;
    if (ownerReports) {
      for (const [offerId, entry] of Object.entries(ownerReports)) {
        if (!offerId || offerMap.has(offerId)) continue;
        if (commishPending.has(offerId)) continue;
        // Upstash auto-deserializes JSON values; guard against string too.
        const parsed = typeof entry === 'string' ? JSON.parse(entry) : entry;
        const raw = parsed?.raw;
        if (!raw) continue;
        const originator = String(raw.franchise || '').padStart(4, '0');
        offerMap.set(offerId, { raw, offeringFid: originator });
        mergedCount += 1;
      }
    }
    if (mergedCount > 0) {
      log(`  [offer-scan] Merged ${mergedCount} owner-reported offers (commish sourced ${commishSourcedCount})`);
    }
  } catch (err) {
    warn(`  [offer-scan] owner-reports merge failed: ${err.message}`);
  }

  log(`  [offer-scan] Distinct counter-party-awaiting offers: ${offerMap.size}`);

  const tips = [];
  const debugLog = [];
  const windowStart = nowMs - OFFER_ROLLING_WINDOW_MS;
  const playerWindowStart = nowMs - PLAYER_HISTORY_WINDOW_MS;

  for (const [offerId, { raw, offeringFid }] of offerMap) {
    // Hard skip: already announced by a prior run. `posted` is an absorbing
    // state — once we tip it, we never re-tip it.
    let alreadyPosted = false;
    try {
      alreadyPosted = (await redis.sismember(OFFER_POSTED_KEY, offerId)) === 1;
    } catch (err) {
      warn(`  [offer-scan] sismember(posted) failed for ${offerId}: ${err.message}`);
    }
    if (alreadyPosted) {
      debugLog.push({ offerId, offeringFid, skipped: 'already-posted' });
      continue;
    }

    // Legacy guard: offers marked by the old one-shot model stay burned so we
    // don't accidentally re-announce trades that previously failed the dice roll.
    let legacyBurned = false;
    try {
      legacyBurned = (await redis.sismember(OFFER_SEEN_KEY, offerId)) === 1;
    } catch (err) {
      warn(`  [offer-scan] sismember(seen-legacy) failed for ${offerId}: ${err.message}`);
    }
    if (legacyBurned) {
      debugLog.push({ offerId, offeringFid, skipped: 'legacy-seen' });
      continue;
    }

    // First-seen anchor: the timestamp we use to derive framing + track age.
    // New offer → set now; returning offer → read what we stored on its debut.
    let firstSeenMs;
    try {
      const stored = await redis.hget(OFFER_FIRST_SEEN_KEY, offerId);
      firstSeenMs = stored ? Number(stored) : NaN;
      if (!Number.isFinite(firstSeenMs) || firstSeenMs <= 0) firstSeenMs = nowMs;
    } catch (err) {
      warn(`  [offer-scan] hget(first_seen) failed for ${offerId}: ${err.message}`);
      firstSeenMs = nowMs;
    }
    const isFirstSighting = firstSeenMs === nowMs;
    const offerAgeMs = Math.max(0, nowMs - firstSeenMs);
    const framingHint = offerAgeMs >= OFFER_LINGERING_THRESHOLD_MS ? 'lingering' : 'fresh';

    // Persist the anchor on first sighting only (HSET overwrite would be fine
    // but this keeps semantics obvious).
    if (!dryRun && isFirstSighting) {
      try {
        await redis.hset(OFFER_FIRST_SEEN_KEY, { [offerId]: nowMs });
        await redis.expire(OFFER_FIRST_SEEN_KEY, OFFER_STATE_TTL_SEC);
      } catch (err) {
        warn(`  [offer-scan] hset(first_seen) failed: ${err.message}`);
      }
    }

    // Sorted-set bookkeeping: owner + division + per-player.
    // Only add on FIRST sighting — the offer is one event, not 96/day of them.
    const ownerKey = OFFER_OWNER_KEY_PREFIX + offeringFid;
    const division = teams.get(offeringFid)?.division;
    const divKey = division ? OFFER_DIV_KEY_PREFIX + division : null;

    if (!dryRun && isFirstSighting) {
      try {
        await redis.zadd(ownerKey, { score: nowMs, member: offerId });
        await redis.zremrangebyscore(ownerKey, 0, windowStart);
        if (divKey) {
          await redis.zadd(divKey, { score: nowMs, member: `${offeringFid}:${offerId}` });
          await redis.zremrangebyscore(divKey, 0, windowStart);
        }
      } catch (err) {
        warn(`  [offer-scan] owner/div zadd failed: ${err.message}`);
      }
    }

    // Player history (for escalation tier)
    const playerIds = [
      ...(raw.franchise1_gave_up || '').split(','),
      ...(raw.franchise2_gave_up || '').split(','),
    ]
      .map((s) => s.trim())
      .filter((tok) => tok && !/^(DP_|FP_|BB_)/.test(tok));

    const playerHistory = new Map();    // playerId -> effective distinct offerer count
    const playerDraftStats = new Map(); // playerId -> { realCount, draftCount, effectiveCount, capped }
    for (const pid of playerIds) {
      const pKey = PLAYER_OFFER_HISTORY_PREFIX + pid;
      // Add the offer to the player history only on first sighting so a single
      // lingering trade doesn't masquerade as 96 separate offerers.
      if (!dryRun && isFirstSighting) {
        try {
          await redis.zadd(pKey, { score: nowMs, member: `${offeringFid}:${offerId}` });
          await redis.zremrangebyscore(pKey, 0, playerWindowStart);
          await redis.expire(pKey, 30 * 24 * 60 * 60);
        } catch (err) {
          warn(`  [offer-scan] player history zadd failed: ${err.message}`);
        }
      }
      // Count distinct offerers (members are "{fid}:{offerId}" — dedupe fid prefix)
      let members = [];
      try {
        members = await redis.zrange(pKey, playerWindowStart, nowMs, { byScore: true });
      } catch {
        members = [];
      }
      const realFids = new Set(
        (members || []).map((m) => String(m).split(':')[0]),
      );
      // Include the current offering franchise (it was just added — or would be in live mode)
      realFids.add(offeringFid);

      // Blend in trade-builder draft signals (3-day window, weight=0.4).
      // Drafts contribute distinct franchise ids that DO NOT already have a
      // real offer logged for this player. This is a *softer* shopping signal,
      // intentional but not committed.
      const draftFids = await getDraftOfferersForPlayer({ redis, playerId: pid, nowMs });
      const newDraftFids = new Set();
      for (const f of draftFids) {
        if (!realFids.has(f)) newDraftFids.add(f);
      }

      const realCount = realFids.size;
      const draftCount = newDraftFids.size;
      const blended = realCount + TB_DRAFT_OFFERER_WEIGHT * draftCount;
      let effectiveCount = Math.floor(blended);

      // Tier cap: drafts can elevate base → tightened_circle (n=3) but
      // MUST NOT unlock the `named` tier (n>=4) on their own. The named
      // tier authorizes Schefter to drop a player's name in the post —
      // gated to *real* submitted offers only.
      const realTier = tierForDistinctOfferers(realCount);
      let capped = false;
      if (realTier !== 'named' && tierForDistinctOfferers(effectiveCount) === 'named') {
        effectiveCount = 3;
        capped = true;
      }

      playerHistory.set(pid, effectiveCount);
      playerDraftStats.set(pid, { realCount, draftCount, effectiveCount, capped });
    }

    // Counts
    let ownerOfferCount7d = 1;
    let divisionOfferCount7d = 0;
    try {
      ownerOfferCount7d = await redis.zcard(ownerKey);
      if (!ownerOfferCount7d || ownerOfferCount7d < 1) ownerOfferCount7d = 1;
    } catch {
      ownerOfferCount7d = 1;
    }
    if (divKey) {
      try {
        divisionOfferCount7d = await redis.zcard(divKey);
      } catch {
        divisionOfferCount7d = 0;
      }
    }

    // Blend owner draft volume into the 7-day count. Drafts saved by this
    // owner are an aggressiveness signal — they bump volumeHint toward
    // serial without affecting whether a player can be named (that's gated
    // separately by playerHistory's tier cap above).
    const ownerDraftCount = await getOwnerDraftCount({
      redis,
      franchiseId: offeringFid,
      nowMs,
    });
    if (ownerDraftCount > 0) {
      ownerOfferCount7d += Math.floor(TB_DRAFT_OFFERER_WEIGHT * ownerDraftCount);
    }

    // In dry-run mode we didn't mutate, so nudge counts up by 1 to simulate "this offer counts"
    if (dryRun) {
      ownerOfferCount7d = Math.max(ownerOfferCount7d, 1);
    }

    // Redact
    const redaction = redactTradeOffer({
      rawOffer: raw,
      offeringFid,
      playerMap: players,
      teamMap: teams,
      counts: { ownerOfferCount7d, divisionOfferCount7d, playerHistory },
      currentYear: year,
      framingHint,
      offerAgeMs,
    });

    if (redaction.skip) {
      debugLog.push({ offerId, offeringFid, skipped: redaction.reason });
      continue;
    }

    // Dice roll — base p=0.0075 per run, scaled exponentially by the most-
    // shopped player's effective distinct-offerer count (real + 0.4*draft).
    // Capped at 4× base. Cumulative curve still keeps most passes in the
    // 1–7 day window for low-volume players; serial-shopped players
    // accelerate. Owner can't tell whether their submission or any
    // particular other-team draft tipped the dice — that's the point.
    const maxEffectiveOfferers = playerHistory.size > 0
      ? Math.max(1, ...Array.from(playerHistory.values()))
      : 1;
    const probability = offerPostProbability(maxEffectiveOfferers);
    const roll = Math.random();
    const passed = roll < probability;

    const ageHours = offerAgeMs / (60 * 60 * 1000);
    const draftStatsArray = Array.from(playerDraftStats.entries()).map(
      ([pid, s]) => ({ pid, ...s }),
    );
    const entry = {
      offerId,
      offeringFid,
      ownerOfferCount7d,
      ownerDraftCount,
      divisionOfferCount7d,
      framingHint,
      offerAgeHours: Number(ageHours.toFixed(2)),
      isFirstSighting,
      maxEffectiveOfferers,
      probability,
      roll: Number(roll.toFixed(3)),
      passed,
      draftStats: draftStatsArray,
      redaction: redaction.debug,
      tipPreview: redaction.tip,
    };
    debugLog.push(entry);

    log(
      `  [offer-scan] offerId=${offerId} fid=${offeringFid} ` +
        `age=${ageHours.toFixed(1)}h frame=${framingHint} ` +
        `owner7d=${ownerOfferCount7d}(drafts=${ownerDraftCount}) div7d=${divisionOfferCount7d} ` +
        `effOff=${maxEffectiveOfferers} ` +
        `p=${probability.toFixed(4)} roll=${roll.toFixed(3)} → ${passed ? 'PASS' : 'fail'}` +
        (redaction.tip.escalatedPlayer
          ? ` [escalation=${redaction.tip.escalatedPlayer.tier}/${redaction.tip.escalatedPlayer.distinctOfferers}]`
          : ''),
    );

    if (!passed) continue;

    // Detection-only: don't queue, and DON'T record as posted — we want to
    // keep observing the cumulative probability curve in detection runs.
    if (detectionOnly && !enabled) {
      log(`  [offer-scan] detection-only: would have queued tip ${redaction.tip.id}`);
      continue;
    }

    // Absorbing state: mark offer posted so future runs skip it.
    if (!dryRun) {
      try {
        await redis.sadd(OFFER_POSTED_KEY, offerId);
        await redis.expire(OFFER_POSTED_KEY, OFFER_STATE_TTL_SEC);
      } catch (err) {
        warn(`  [offer-scan] sadd(posted) failed: ${err.message}`);
      }
    }

    tips.push(redaction.tip);
  }

  return { tips, debug: debugLog };
}

// ── History subject heuristic ──

/**
 * Derive a short subject tag for post-history entries. Uses anonymized scope
 * info so we never leak a franchise the LLM wasn't allowed to name.
 */
function deriveHistorySubject(batch, anonymized) {
  const sources = new Set(batch.map((t) => t.source).filter(Boolean));
  if (sources.has('trade_offer')) {
    const hasNamed = anonymized.some((t) => t.escalatedPlayer?.tier === 'named');
    return hasNamed ? 'trade-offer (named)' : 'trade-offer';
  }
  if (sources.has('groupme')) {
    const authors = anonymized
      .filter((t) => t.source === 'groupme' && t.author)
      .map((t) => t.author);
    if (authors.length > 0) return `groupme (${authors.slice(0, 2).join(', ')})`;
    return 'groupme';
  }
  const divs = new Set(
    anonymized
      .map((t) => t.scope?.kind === 'division' ? t.scope.division : null)
      .filter(Boolean),
  );
  if (divs.size === 1) return `division (${[...divs][0]})`;
  const franchises = new Set(
    anonymized
      .map((t) => t.scope?.kind === 'franchise-multi-source' ? t.scope.franchise : null)
      .filter(Boolean),
  );
  if (franchises.size === 1) return `franchise (${[...franchises][0]})`;
  return 'web';
}

// ── Gate checks ──

async function checkGates(redis, now) {
  // 1. quiet hours
  if (isQuietHours(now)) {
    return { ok: false, reason: `quiet hours (PT ${getPtHour(now)}:00) — holding queue` };
  }

  // 2. posts_today cap
  const postsTodayRaw = await redis.get(RUMOR_POSTS_TODAY_KEY);
  const postsToday = typeof postsTodayRaw === 'number' ? postsTodayRaw : parseInt(postsTodayRaw ?? '0', 10) || 0;
  if (postsToday >= MAX_POSTS_PER_DAY) {
    return { ok: false, reason: `posts_today=${postsToday} — daily cap reached` };
  }

  // 3. spacing (only enforced once there has been a post today)
  if (postsToday >= 1) {
    const lastRaw = await redis.get(RUMOR_LAST_POST_TS_KEY);
    const last = typeof lastRaw === 'number' ? lastRaw : parseInt(lastRaw ?? '0', 10) || 0;
    const age = now.getTime() - last;
    if (last && age < MIN_SPACING_MS) {
      return {
        ok: false,
        reason: `last post was ${(age / 60000).toFixed(0)}m ago; need ${MIN_SPACING_MS / 60000}m spacing`,
      };
    }
  }

  // 4. marinate window
  const firstTipRaw = await redis.get(FIRST_TIP_TS_KEY);
  const firstTip = typeof firstTipRaw === 'number' ? firstTipRaw : parseInt(firstTipRaw ?? '0', 10) || 0;
  if (!firstTip) {
    return { ok: false, reason: 'no first_tip_ts anchor — queue may be stale or API never pushed' };
  }
  const marinated = now.getTime() - firstTip;
  if (marinated < MIN_MARINATE_MS) {
    return {
      ok: false,
      reason: `tip marinated ${(marinated / 60000).toFixed(0)}m, needs ${MIN_MARINATE_MS / 60000}m`,
    };
  }

  return { ok: true, postsToday };
}

// ── Main ──

async function main() {
  log(`\n=== Schefter Rumor-Mill Scan ${DRY_RUN ? '[DRY RUN]' : ''} ===`);
  log(`  Timestamp: ${new Date().toISOString()}`);

  // Enable gate
  const enabled = process.env.SCHEFTER_RUMOR_MILL_ENABLED;
  if (!enabled || enabled === '0' || String(enabled).toLowerCase() === 'false') {
    log('  SCHEFTER_RUMOR_MILL_ENABLED is not truthy — exiting');
    return 0;
  }

  const redis = await getRedis();
  if (!redis) {
    warn('  Redis unavailable — exiting gracefully');
    return 0;
  }

  // Load personality + lore + bits once per run. If any file fails we fall
  // back to the legacy inline prompt inside generateAiBody.
  const lore = await loadLore({ log, warn });
  const history = await loadPostHistory({ log, warn });
  const recentPostsBlock = buildRecentPostsPromptBlock(history.posts);
  log(`  [memory] last ${Math.min(history.posts.length, 5)} posts passed to LLM`);

  // ── Phase 6: Trade-Offer Rumor source ──
  // Runs BEFORE the queue read so fresh redacted tips land in this cycle.
  // In detection-only mode, mutates Redis counters but doesn't queue.
  let offerTipsPushed = 0;
  try {
    const offerScan = await scanTradeOffers({ redis, dryRun: DRY_RUN });
    if (offerScan.debug.length > 0) {
      log(`  [offer-scan] Processed ${offerScan.debug.length} offer(s), ${offerScan.tips.length} tip(s) queued`);
    }
    if (!DRY_RUN && offerScan.tips.length > 0) {
      // Ensure first_tip_ts anchor exists so gate checks pass (same pattern as web tip API)
      const firstTipExists = await redis.get(FIRST_TIP_TS_KEY);
      if (!firstTipExists) {
        await redis.set(FIRST_TIP_TS_KEY, Date.now());
      }
      for (const tip of offerScan.tips) {
        await redis.rpush(TIPS_QUEUE_KEY, JSON.stringify(tip));
      }
      offerTipsPushed = offerScan.tips.length;
      log(`  [offer-scan] Enqueued ${offerTipsPushed} trade-offer tip(s)`);
    } else if (DRY_RUN && offerScan.tips.length > 0) {
      log(`  [dry-run] Would enqueue ${offerScan.tips.length} trade-offer tip(s):`);
      for (const tip of offerScan.tips) {
        log(`    + ${tip.id} vol=${tip.volumeHint} frame=${tip.framingHint ?? 'fresh'} ` +
          `age=${((tip.offerAgeMs ?? 0) / 3600000).toFixed(1)}h ` +
          `pos=[${tip.positionTokens.join(',')}] ` +
          `picks=[${tip.pickTokens.join(',')}] div=${tip.divisionHint ?? '-'} ` +
          `esc=${tip.escalatedPlayer?.tier ?? 'base'}`);
      }
    }

    if (TRADE_OFFERS_ONLY) {
      log('  [offer-scan] --trade-offers-only → exiting without running full rumor-mill cycle');
      return offerTipsPushed;
    }
  } catch (err) {
    warn(`  [offer-scan] failed: ${err.message} — continuing with other sources`);
    if (TRADE_OFFERS_ONLY) return 0;
  }

  // ── Phase 3: GroupMe mention ingest ──
  // Feed any @Schefter / @Claude mentions since the last watermark into the
  // same tips queue. Runs BEFORE the queue read so fresh mentions are included
  // in this cycle's batch.
  try {
    const ingest = await ingestGroupMeMentions({ redis, dryRun: DRY_RUN });
    if (ingest.detected > 0) {
      log(`  [groupme] Detected ${ingest.detected} mention(s) from ${ingest.scanned} message(s):`);
      for (const a of ingest.accepted) {
        log(`    + ${a.author} [${a.variant}] "${a.text}"`);
      }
    } else if (ingest.scanned > 0) {
      log(`  [groupme] Scanned ${ingest.scanned} message(s), no mentions detected`);
    }
    if (ingest.rejected.length > 0) {
      log(`  [groupme] Near-miss rejections (${ingest.rejected.length}):`);
      for (const r of ingest.rejected.slice(0, 5)) {
        log(`    - ${r.author}: "${r.text}" (${r.reason})`);
      }
    }
  } catch (err) {
    warn(`  [groupme] ingest failed: ${err.message} — continuing with web tips only`);
  }

  // Read queue
  let queueRaw = [];
  try {
    queueRaw = await redis.lrange(TIPS_QUEUE_KEY, 0, -1);
  } catch (err) {
    warn(`  Redis lrange failed: ${err.message} — exiting`);
    return 0;
  }

  if (!queueRaw || queueRaw.length === 0) {
    log('  Queue empty — nothing to do');
    return 0;
  }

  // Parse tips (strings from Upstash may already be auto-parsed objects)
  const parsedTips = [];
  for (const item of queueRaw) {
    try {
      const obj = typeof item === 'string' ? JSON.parse(item) : item;
      if (obj && typeof obj === 'object' && obj.id && obj.text) {
        parsedTips.push(obj);
      }
    } catch {
      // skip malformed
    }
  }
  log(`  Queue depth: ${parsedTips.length}`);

  // Drop expired
  const now = new Date();
  const freshTips = parsedTips.filter((t) => {
    const age = now.getTime() - (t.submittedAt ?? 0);
    return age <= TIP_EXPIRY_MS;
  });
  const expiredCount = parsedTips.length - freshTips.length;
  if (expiredCount > 0) log(`  Expired tips (>24h): ${expiredCount}`);

  if (freshTips.length === 0) {
    log('  No fresh tips — clearing stale queue');
    if (!DRY_RUN) {
      try {
        await redis.del(TIPS_QUEUE_KEY);
        await redis.del(FIRST_TIP_TS_KEY);
      } catch (err) {
        warn(`  Cleanup failed: ${err.message}`);
      }
    }
    return 0;
  }

  // Gate checks
  const gates = await checkGates(redis, now);
  if (!gates.ok) {
    log(`  GATE FAIL: ${gates.reason}`);
    return 0;
  }
  log(`  Gates OK (posts_today=${gates.postsToday}, marinated enough)`);

  const todayPtDate = getPtDateString(now);

  // Friday mailbag check — runs once per Friday PT, sweeps every gossip
  // tip (any non-trade-offer web/groupme tip) into one roundup so nothing
  // expires unseen. Trade-offer tips still go through their own path on
  // non-Friday cycles; mailbag only takes the gossip pile.
  let mailbagBatch = null;
  if (isFridayPt(now)) {
    let mailbagDoneDate = null;
    try {
      mailbagDoneDate = await redis.get(FRIDAY_MAILBAG_DONE_KEY);
    } catch { /* tolerate */ }
    if (mailbagDoneDate === todayPtDate) {
      log(`  [mailbag] Already ran today (${todayPtDate}) — skipping Friday dump`);
    } else {
      const gossipPool = freshTips.filter((t) => classifyTipKind(t) === 'gossip');
      if (gossipPool.length === 0) {
        log('  [mailbag] Friday + no gossip tips in queue — skipping (no dump needed)');
      } else {
        mailbagBatch = gossipPool.slice(0, MAX_TIPS_PER_BATCH);
        log(`  [mailbag] Friday news-dump: ${mailbagBatch.length} gossip tip(s) queued for roundup`);
      }
    }
  }

  // Pick one topic-bucket (or two, for gossip posts) to report. Trade
  // rumors come first, then the oldest/largest gossip bucket, with an
  // optional second gossip beat stitched into the same post. Tips in
  // other buckets stay in the queue — slow-news leftovers bubble up on
  // the next cycle thanks to the age boost in bucketPriorityScore.
  const buckets = buildTopicBuckets(freshTips);
  log(
    `  Buckets (${buckets.length}): ` +
      buckets.map((b) => `${b.key}[${b.kind}×${b.tips.length}]`).join(', '),
  );

  const gossipToday = Number(
    (await redis.get(RUMOR_GOSSIP_POSTS_TODAY_KEY).catch(() => 0)) ?? 0,
  );
  const { cap: adaptiveGossipCap, reason: adaptiveReason } = computeAdaptiveGossipCap(freshTips, now);
  const gossipAllowedToday = gossipToday < adaptiveGossipCap;
  log(`  Gossip budget: ${gossipToday}/${adaptiveGossipCap} used today — ${adaptiveReason} (${gossipAllowedToday ? 'available' : 'spent'})`);

  // Mailbag takes precedence over the normal bucket pick — drains the
  // whole gossip pool regardless of clustering. Still subject to the
  // MAX_POSTS_PER_DAY gate (it consumes one of the day's slots).
  let primaryBucket = null;
  let secondaryBucket = null;
  let postKind; // 'trade' | 'gossip' | 'mailbag'
  let batch;
  let secondaryBatch = null;

  if (mailbagBatch) {
    postKind = 'mailbag';
    batch = mailbagBatch;
  } else {
    const pick = pickPrimaryBucket(buckets, { gossipAllowedToday, now });
    if (!pick) {
      log('  No bucket qualifies (gossip cap used, no trade rumors) — holding tips for the next cycle');
      return 0;
    }
    primaryBucket = pick.primary;
    secondaryBucket = pick.secondary;
    log(`  Chose bucket ${primaryBucket.key} (kind=${primaryBucket.kind}, size=${primaryBucket.tips.length})`);

    // Cap batch size (within the chosen bucket). Leftovers from other
    // buckets survive this cycle via the partial-drain path below.
    batch = primaryBucket.tips.slice(0, MAX_TIPS_PER_BATCH);
    postKind = primaryBucket.kind;

    // Two-post gossip: a second distinct gossip bucket ships as its own
    // independent feed post in the SAME scan cycle. Both posts count as
    // one slot against the daily + gossip caps, but each has its own
    // post id so reactions, comments, and whisper-back threads stay
    // separate. Trade-rumor posts never carry a secondary — they stay
    // strictly single-topic.
    //
    // The secondary only fires under real backlog pressure
    // (>= SECONDARY_GOSSIP_POST_PRESSURE gossip tips queued). Below that
    // threshold we ship a single post and let the secondary bucket wait
    // its turn — the two-post double is a pile-up catch-up mechanism,
    // not a default cadence.
    if (postKind === 'gossip' && secondaryBucket) {
      const gossipQueueDepth = freshTips.filter((t) => classifyTipKind(t) === 'gossip').length;
      if (gossipQueueDepth >= SECONDARY_GOSSIP_POST_PRESSURE) {
        secondaryBatch = secondaryBucket.tips.slice(0, MAX_TIPS_PER_BATCH);
        log(`  Second post bucket ${secondaryBucket.key} (size=${secondaryBucket.tips.length}, using ${secondaryBatch.length} tip(s)) — pressure ${gossipQueueDepth}/${SECONDARY_GOSSIP_POST_PRESSURE}`);
      } else {
        log(`  Holding ${secondaryBucket.key} for next cycle — gossip queue depth ${gossipQueueDepth} < ${SECONDARY_GOSSIP_POST_PRESSURE} (no pile-up pressure)`);
      }
    }
  }

  const batchIds = new Set([
    ...batch.map((t) => t.id),
    ...(secondaryBatch ? secondaryBatch.map((t) => t.id) : []),
  ]);
  const unusedTips = freshTips.filter((t) => !batchIds.has(t.id));
  log(`  Processing batch of ${batch.length}${secondaryBatch ? ` + ${secondaryBatch.length} secondary` : ''} (holding ${unusedTips.length} for next cycle)`);

  // Anonymize — load the feed early so whisper-back tips can pull parent
  // headline snippets into their scope.
  const teams = await loadTeams();
  const feedForAnonymize = await loadFeed();
  const anonymized = await anonymizeTips(batch, teams, feedForAnonymize.posts ?? [], now, redis);
  const secondaryAnonymized = secondaryBatch
    ? await anonymizeTips(secondaryBatch, teams, feedForAnonymize.posts ?? [], now, redis)
    : null;
  log(`  Anonymized ${anonymized.length} tips${secondaryAnonymized ? ` + ${secondaryAnonymized.length} secondary` : ''}`);

  // ── Phase 4: Ask Roger 7% riff ──
  // Gate: (a) random roll passes, (b) no riff already posted today PT,
  // (c) a rumor-mill post is about to go out anyway (true here since we're
  //     past all gates). We never generate a post JUST for Roger.
  let rogerQuote = null;
  let hadRogerRiff = false;
  const rogerRoll = Math.random();
  const todayPt = todayPtDate;
  let lastRiffDate = null;
  try {
    lastRiffDate = await redis.get(ROGER_LAST_RIFF_DATE_KEY);
  } catch { /* tolerate */ }
  const rollPassed = rogerRoll < ROGER_RIFF_PROBABILITY;
  const alreadyRiffedToday = lastRiffDate === todayPt;
  log(`  [roger-riff] roll=${rogerRoll.toFixed(3)} (need <${ROGER_RIFF_PROBABILITY}), todayPT=${todayPt}, lastRiffDate=${lastRiffDate ?? '(none)'}`);
  if (rollPassed && !alreadyRiffedToday) {
    log(`  [roger-riff] Gate passed — looking for latest Roger quote (24h window)`);
    try {
      rogerQuote = await getLatestRogerQuote({ maxAgeMs: 24 * 60 * 60 * 1000 });
      if (rogerQuote) {
        hadRogerRiff = true;
        log(`  [roger-riff] Found Roger quote: "${rogerQuote.text.slice(0, 100)}${rogerQuote.text.length > 100 ? '…' : ''}"`);
      } else {
        log(`  [roger-riff] No recent Roger activity in last 24h — skipping riff`);
      }
    } catch (err) {
      warn(`  [roger-riff] quote lookup failed: ${err.message} — continuing without riff`);
      rogerQuote = null;
    }
  } else if (alreadyRiffedToday) {
    log(`  [roger-riff] Already riffed today — skipping`);
  } else {
    log(`  [roger-riff] Dice roll failed — no riff this cycle`);
  }

  // Build the list of "beats" — one per independent feed post we'll ship
  // this cycle. Most post kinds produce exactly one beat; a two-topic
  // gossip cycle produces TWO beats (independent post IDs, independent
  // reactions/threads) even though they share the same cap slot.
  const beats = [
    { batch, anonymized, kind: postKind },
  ];
  if (secondaryBatch && postKind === 'gossip') {
    beats.push({
      batch: secondaryBatch,
      anonymized: secondaryAnonymized,
      kind: 'gossip',
    });
  }
  log(`  Producing ${beats.length} post(s) this cycle`);

  // Load the NFL news digest once per cycle. Best-effort: if the file is
  // missing or unreadable the scanner runs without NFL context.
  const nflContext = await loadNflContext();

  // Resolve per-beat Schefter-target mode (self-dep / attack-back / null).
  // GroupMe Schefter mentions get a 7.5% probability of attack-back per beat;
  // web hits always self-dep. No state — independent draw each scan.
  const schefterModes = beats.map((beat) => selectSchefterTargetMode(beat));

  // Generate bodies in parallel. Only the primary beat gets the Roger
  // riff — the riff is a once-per-day cameo that shouldn't double up.
  const aiMode = postKind === 'mailbag' ? 'mailbag' : 'single';
  const aiBodies = await Promise.all(
    beats.map((beat, i) => generateAiBody(beat.anonymized, {
      rogerQuote: i === 0 ? rogerQuote : null,
      lore,
      recentPostsBlock,
      mode: aiMode,
      nflContext,
      schefterTargetMode: schefterModes[i],
    })),
  );

  // Build post objects. Each beat resolves its own whisper-back thread
  // from its own batch's repliesToPostId, so replies to two different
  // parent rumors land in two different threads — one per post. We keep
  // the parent-id mapping in a side Map so it never leaks into the feed
  // JSON or the API response shape.
  const combinedBatch = beats.flatMap((b) => b.batch);
  const builtPosts = [];
  const ctaByPostId = new Map();
  const parentIdByPostId = new Map();
  // Each beat has its own bucket — primary uses primaryBucket, secondary
  // (gossip-only) uses secondaryBucket. Resolve CTA per-beat so a gossip
  // secondary attached to a trade_bait primary doesn't inherit the wrong
  // Trade Builder link.
  const beatBuckets = [primaryBucket, secondaryBucket];
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const aiBody = aiBodies[i];
    const body = aiBody || templateBody(beat.anonymized);
    log(`  [beat ${i + 1}/${beats.length}] (${aiBody ? 'AI' : 'template'})${i === 0 && hadRogerRiff ? ' [with Roger riff]' : ''}:\n    ${body.replace(/\n/g, '\n    ')}`);

    const tipIds = beat.batch.map((t) => t.id);

    // Thread resolution — per beat. Whisper-backs in beat 1 and beat 2
    // threads stay separate.
    const parentCounts = new Map();
    for (const tip of beat.batch) {
      if (tip && typeof tip.repliesToPostId === 'string' && tip.repliesToPostId.length > 0) {
        parentCounts.set(tip.repliesToPostId, (parentCounts.get(tip.repliesToPostId) ?? 0) + 1);
      }
    }
    let dominantParentId = null;
    if (parentCounts.size > 0) {
      let best = -1;
      for (const [id, count] of parentCounts) {
        if (count > best) {
          best = count;
          dominantParentId = id;
        }
      }
    }
    let threadId = null;
    if (dominantParentId) {
      try {
        const registered = await redis.get(`schefter:thread_of:${dominantParentId}`);
        threadId = typeof registered === 'string' && registered.length > 0
          ? registered
          : dominantParentId;
      } catch {
        threadId = dominantParentId;
      }
    }

    // Distinct timestamps so feed ordering is stable between beats —
    // primary (i=0) uses `now`, later beats push out by (i * 1000ms).
    // Feed prepends primary last so primary ends up at index 0 (top).
    const beatTs = new Date(now.getTime() + i * 1000);

    // CTA: most rumor cards link back to the tip page so readers can
    // whisper a follow-up. Trade-bait rumors about a single franchise
    // swap the link for a Trade Builder deep-link pre-loaded with that
    // franchise, since the natural next step is to build a counter.
    // Explicit-pick rumors get a directed dare ("Geeks desk — your move")
    // that pre-selects the named franchise on the tip form, turning the
    // post into the start of a thread.
    const directedCta = buildDirectedCta(beat);
    const cta = directedCta ?? resolveCta(beatBuckets[i]);

    const post = {
      id: generatePostId(),
      timestamp: beatTs.toISOString(),
      type: 'transaction',
      transactionSubType: RUMOR_SUB_TYPE,
      tier: RUMOR_TIER,
      headline: 'Schefter hearing…',
      body,
      authorId: 'claude',
      franchiseIds: [],
      tipIds,
      hadRogerRiff: i === 0 ? hadRogerRiff : false,
      league: LEAGUE_SLUG,
      link: cta.link,
      linkLabel: cta.linkLabel,
      ...(threadId ? { threadId } : {}),
    };
    ctaByPostId.set(post.id, cta);
    if (threadId && dominantParentId) {
      parentIdByPostId.set(post.id, dominantParentId);
    }
    builtPosts.push(post);
  }

  const allTipIds = combinedBatch.map((t) => t.id);
  // GroupMe payload — per-post CTA. Trade-bait posts link into the Trade
  // Builder; every other post carries the tip-page CTA.
  const groupMeTextFor = (p) => {
    const cta = ctaByPostId.get(p.id) ?? {
      groupMePrefix: 'Got a tip?',
      groupMeUrl: TIP_PAGE_ABSOLUTE_URL,
    };
    return `${p.body}\n\n${cta.groupMePrefix} ${cta.groupMeUrl}`;
  };

  if (DRY_RUN) {
    log(`\n  [dry-run] Would append ${builtPosts.length} post(s) to feed:`);
    for (const p of builtPosts) log(JSON.stringify(p, null, 2));
    log('\n  [dry-run] Would remove the following tipIds from queue:');
    log(`    ${allTipIds.join(', ')}`);
    if (unusedTips.length > 0) {
      log(`  [dry-run] Would hold ${unusedTips.length} tip(s) for the next cycle: ${unusedTips.map((t) => t.id).join(', ')}`);
    }
    log(`  [dry-run] Would increment schefter:rumor:posts_today by 1${postKind === 'gossip' ? ' + schefter:rumor:gossip_posts_today by 1' : ''} (even with ${builtPosts.length} posts — counts as one cap slot), set last_post_ts${unusedTips.length > 0 ? ', rewrite queue with leftover tips' : ', DEL first_tip_ts'}`);
    if (hadRogerRiff) {
      log(`  [dry-run] Would set ${ROGER_LAST_RIFF_DATE_KEY}=${todayPt} (ex=48h)`);
    }
    for (const p of builtPosts) {
      await postToGroupMe(groupMeTextFor(p));
    }
    return 0;
  }

  // Write feed — prepend in reverse so the primary beat ends up at index 0
  // (top of the feed). Both posts land in the same fs.writeFile call so
  // an error on GroupMe can't leave one written and one missing.
  const feed = await loadFeed();
  const existingPosts = feed.posts ?? [];
  feed.posts = [...builtPosts, ...existingPosts];
  feed.lastScanTimestamp = now.toISOString();
  await fs.writeFile(FEED_PATH, JSON.stringify(feed, null, 2) + '\n');
  log(`  Appended to feed: ${builtPosts.length} new post(s) (total: ${feed.posts.length})`);

  // GroupMe — one message per post so each shows up as an independent
  // reply target in the group chat. Small stagger between to avoid
  // rate-limiting surprises.
  for (let i = 0; i < builtPosts.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 250));
    await postToGroupMe(groupMeTextFor(builtPosts[i]));
  }

  // Per-team name counter: every post that named a franchise (explicit-pick,
  // multi-source, or trade-bait) bumps the rolling 30-day name count for
  // that franchise. Drives drama escalation in subsequent posts and powers
  // the "Hottest desks this week" sidebar widget. Best-effort — a Redis
  // failure here cannot block anything downstream because the post is
  // already on disk and on GroupMe.
  for (let i = 0; i < builtPosts.length; i++) {
    const beat = beats[i];
    const post = builtPosts[i];
    const namingScopes = ['franchise-explicit-pick', 'franchise-multi-source', 'trade-bait'];
    const safe = beat?.anonymized?.[0];
    if (!safe || !namingScopes.includes(safe.scope?.kind)) continue;
    const namedTip = beat.batch.find((t) => typeof t?.franchiseHint === 'string' && t.franchiseHint.length > 0);
    const franchiseId = namedTip?.franchiseHint;
    if (!franchiseId) continue;
    try {
      await recordTeamNaming(
        franchiseId,
        post.id,
        new Date(post.timestamp).getTime(),
        redis,
      );
    } catch (err) {
      warn(`  [team-naming] record failed for ${post.id} → ${franchiseId}: ${err.message}`);
    }
  }

  // Append each post to the rolling history (one entry per post).
  const tipSources = Array.from(new Set(combinedBatch.map((t) => t.source).filter(Boolean)));
  for (let i = 0; i < builtPosts.length; i++) {
    const p = builtPosts[i];
    const beat = beats[i];
    const subject = deriveHistorySubject(beat.batch, beat.anonymized);
    await appendPostHistory(
      buildHistoryEntry({
        id: p.id,
        timestamp: p.timestamp,
        body: p.body,
        subject,
        tipSources,
      }),
      { log, warn },
    );
  }

  // Redis updates: increment counter (with TTL to midnight PT), last post ts,
  // rewrite queue with leftovers from unchosen buckets, record processed
  // for audit, and bump the gossip cap counter when this was a gossip post.
  try {
    const newCount = await redis.incr(RUMOR_POSTS_TODAY_KEY);
    if (newCount === 1) {
      await redis.expire(RUMOR_POSTS_TODAY_KEY, secondsUntilPtMidnight(now));
    }
    if (postKind === 'gossip') {
      const newGossipCount = await redis.incr(RUMOR_GOSSIP_POSTS_TODAY_KEY);
      if (newGossipCount === 1) {
        await redis.expire(RUMOR_GOSSIP_POSTS_TODAY_KEY, secondsUntilPtMidnight(now));
      }
      log(`  Gossip counter: now ${newGossipCount}/${adaptiveGossipCap}`);
    }
    if (postKind === 'mailbag') {
      // Mark today's mailbag done. 48h TTL — the key naturally falls off
      // before next Friday even if clocks skew.
      await redis.set(FRIDAY_MAILBAG_DONE_KEY, todayPtDate, { ex: 48 * 60 * 60 });
      log(`  [mailbag] Marked done for ${todayPtDate}`);
    }
    await redis.set(RUMOR_LAST_POST_TS_KEY, now.getTime());

    // Remove consumed tips from the queue while preserving tips in other
    // buckets for the next cycle. We replace the list atomically: DEL then
    // RPUSH each leftover JSON string back. Any tip that arrived between
    // LRANGE and now would be lost — acceptable at our 15 min cadence.
    await redis.del(TIPS_QUEUE_KEY);
    if (unusedTips.length > 0) {
      const serialized = unusedTips.map((t) => JSON.stringify(t));
      await redis.rpush(TIPS_QUEUE_KEY, ...serialized);
      // Keep first_tip_ts anchored at the OLDEST surviving tip so the
      // marinate gate still gates the next cycle accurately — tips that
      // have already sat longer than MIN_MARINATE_MS stay eligible.
      const oldest = unusedTips.reduce(
        (acc, t) => Math.min(acc, t.submittedAt ?? Date.now()),
        Number.MAX_SAFE_INTEGER,
      );
      if (Number.isFinite(oldest)) {
        await redis.set(FIRST_TIP_TS_KEY, oldest);
      }
      log(`  Queue held ${unusedTips.length} tip(s) for next cycle (oldest submittedAt=${new Date(oldest).toISOString()})`);
    } else {
      await redis.del(FIRST_TIP_TS_KEY);
    }

    // Processed audit list (TTL 24h) — covers tips from every beat.
    if (allTipIds.length > 0) {
      await redis.lpush(TIPS_PROCESSED_KEY, ...allTipIds);
      await redis.expire(TIPS_PROCESSED_KEY, PROCESSED_TTL_SEC);
    }

    // Phase 10 — hash_for_tip index. The weekly tip-of-the-week script needs to
    // resolve each contributing tipId back to a hashedOwnerId to award badges.
    // We TTL these at 14 days so the weekly job has a generous window even if
    // it runs a day or two late. Covers both beats of a two-beat gossip post
    // plus every tip swept into a Friday mailbag.
    for (const tip of combinedBatch) {
      if (tip && tip.source === 'web' && typeof tip.hashedOwnerId === 'string' && tip.hashedOwnerId.length > 0) {
        try {
          await redis.set(
            `schefter:tipster_hash_for_tip:${tip.id}`,
            tip.hashedOwnerId,
            { ex: 14 * 24 * 60 * 60 },
          );
        } catch (err) {
          warn(`  [hash-for-tip] set failed for ${tip.id}: ${err.message}`);
        }
      }
    }

    // Roger riff date stamp — approximate "end of day PT" with a 48h TTL so
    // the key naturally falls off even if clocks skew.
    if (hadRogerRiff) {
      await redis.set(ROGER_LAST_RIFF_DATE_KEY, todayPt, { ex: 48 * 60 * 60 });
    }

    log(`  Redis updated: posts_today=${newCount}, queue drained, processed archived${hadRogerRiff ? ', roger riff date stamped' : ''}`);
  } catch (err) {
    warn(`  Redis post-write update failed: ${err.message}`);
  }

  // Phase 7 — thread registry. If a post joined an existing thread (or
  // started one from a whisper-back), record it in Redis so future
  // follow-ups can look up the thread and the permalink page can render
  // the chain. Each beat has its own (possibly null) threadId, so we
  // loop and treat them independently.
  for (const p of builtPosts) {
    if (!p.threadId) continue;
    const threadId = p.threadId;
    const dominantParentId = parentIdByPostId.get(p.id);
    try {
      const threadZsetKey = `schefter:thread:${threadId}`;
      const threadOfParentKey = `schefter:thread_of:${dominantParentId}`;
      const threadOfNewKey = `schefter:thread_of:${p.id}`;
      const threadTtlSec = 14 * 24 * 60 * 60;

      await redis.zadd(threadZsetKey, { score: new Date(p.timestamp).getTime(), member: p.id });
      // If the thread is new (rooted at the parent), also index the parent in
      // the zset so the permalink view always opens with it.
      if (dominantParentId && dominantParentId === threadId) {
        const parentPost = (feedForAnonymize.posts ?? []).find((pp) => pp.id === dominantParentId);
        if (parentPost) {
          await redis.zadd(threadZsetKey, {
            score: new Date(parentPost.timestamp).getTime(),
            member: dominantParentId,
          });
        }
      }

      await redis.set(threadOfParentKey, threadId, { ex: threadTtlSec });
      await redis.set(threadOfNewKey, threadId, { ex: threadTtlSec });
      await redis.expire(threadZsetKey, threadTtlSec);

      log(`  [thread] Registered ${p.id} in thread ${threadId}`);
    } catch (err) {
      warn(`  [thread] Registry update failed for ${p.id}: ${err.message}`);
    }
  }

  // Phase 6 — tipster scorecard: increment counters for each distinct web
  // tipster that contributed to this rumor. Runs after the queue drain so a
  // scorecard failure cannot block the post from shipping.
  try {
    const seasonYear = getSeasonYearForTipster(now);
    await incrementTipsterCounters({
      redis,
      batch: combinedBatch,
      seasonYear,
      dryRun: DRY_RUN,
      log,
      warn,
    });
  } catch (err) {
    warn(`  [tipster-counters] hook failed: ${err.message}`);
  }

  return 1;
}

/**
 * Returns the 4-digit league year for tipster counters. Mirrors the
 * getCurrentLeagueYear() semantics from src/utils/league-year.ts — league
 * year advances after Feb 14 @ 8:45 PT. Kept inline here so the scanner
 * stays in pure-Node .mjs without importing the .ts module.
 */
function getSeasonYearForTipster(now = new Date()) {
  const calendarYear = now.getUTCFullYear();
  // Feb 14 @ 8:45 PST = Feb 15 04:45 UTC
  const febCutoff = Date.UTC(calendarYear, 1, 15, 4, 45, 0, 0);
  return now.getTime() >= febCutoff ? calendarYear : calendarYear - 1;
}

// Only run main() when invoked directly (node scripts/schefter-rumor-scan.mjs).
// When this module is imported (e.g. by vitest to test the helpers exported
// above), skip the top-level invocation so the test process doesn't get
// killed by process.exit().
const invokedDirectly = (() => {
  try {
    const entryHref = `file://${process.argv[1]}`;
    return import.meta.url === entryHref;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main()
    .then((count) => {
      log(`\n=== Done. Posts written: ${count} ===`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[rumor-scan] Fatal:', err);
      process.exit(1);
    });
}
