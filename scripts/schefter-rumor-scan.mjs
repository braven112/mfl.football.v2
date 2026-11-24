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
 *   3. schefter:rumor:posts_today < MAX_POSTS_PER_DAY (the SHARED budget)
 *   3b. schefter:rumor:mill_posts_today < the rumor mill's own cap — 1/day
 *       while a season is being played, MAX_POSTS_PER_DAY in the offseason
 *       and in each league's trade-deadline run-up. See
 *       scripts/lib/schefter-rumor-cadence.mjs.
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
import { mflFetch } from './lib/mfl-api.mjs';
import { ingestGroupMeMentions, getLatestRogerQuote, mentionsSchefter } from './schefter-groupme-listen.mjs';
import {
  redactTradeOffer,
  offerPostProbability,
  tierForDistinctOfferers,
  classifyAsset,
} from './lib/redact-trade-offer.mjs';
import {
  allowsTwoPostCycle,
  MAILBAG_EXEMPT_FROM_MILL_CAP,
  rumorMillCapReason,
  rumorMillDailyCap,
} from './lib/schefter-rumor-cadence.mjs';
import { assetShapeOf, tradeSignatureOf } from './lib/schefter-offer-beats.mjs';
import {
  tradingWindowState,
  deadOfferReason,
  lastTradedAtByPlayer,
  tradingClosedPromptBlock,
} from './lib/schefter-trading-window.mjs';
import {
  DEADLINE_WRAP_WINDOW_MS,
  buildDeadlineWrapFacts,
  wrapHasStory,
  deadlineWrapTemplate,
  deadlineWrapSystemPrompt,
  deadlineWrapUserMessage,
} from './lib/schefter-deadline-wrap.mjs';
import { buildSeedFromProposal, writeSeed } from './lib/speculation-seeds.mjs';
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
import { incrementTipsterCounters, incrementTipsterTopicCounters } from './lib/schefter-tipster-counters.mjs';
import { schefterKey, globalSchefterKey } from './lib/schefter-keys.mjs';
import { writeJsonIfChanged } from './lib/canonical-json.mjs';
import { dedupeTipsById, isUsableTip } from './lib/schefter-tip-queue.mjs';
import {
  collectFranchiseNameTokens,
  memoryNameMasker,
  resolveTeamTokens,
  tokenizedTeam,
  tokenizedFormerName,
  authorizedTokensFor,
  MASKED_TEAM,
} from './lib/schefter-name-mask.mjs';
import { getTopicPolicy, DRAINABLE_TOPIC_IDS } from '../src/config/schefter-topics.mjs';
import {
  classifyTipKind,
  isTradeFlavoredBatch,
  buildTopicBuckets,
  bucketPriorityScore,
  bucketFingerprint,
  isBucketStale,
  bucketStreakLength,
} from './lib/schefter-bucket-logic.mjs';
import {
  MAX_TRADE_POSTS_PER_DAY,
  tradePostsTodayKey,
  tradeSlotsRemaining,
} from './lib/speculation-budget.mjs';
import { buildTipsterContext } from './lib/schefter-tipster-context.mjs';
import {
  loadLedger,
  saveLedger,
  rolloverForSeason,
  currentSeasonYear,
  isoWeekLabel,
  markFingerprintSeen,
  getMemoryRecall,
  ledgerPath,
} from './lib/schefter-recurrence-ledger.mjs';
import {
  isOverNamingRateLimit,
  MAX_EXPLICIT_PICKS_PER_TARGET,
} from './lib/schefter-naming-rate-limit.mjs';
import {
  getTeamNameCount30d,
  recordTeamNaming,
} from './lib/schefter-team-naming.mjs';
import { buildFormerNameCallback } from './lib/schefter-former-name.mjs';
import { checkGroupMeQuality, RELAXED_QUALITY_THRESHOLD } from './lib/schefter-quality-gate.mjs';
import { getRedisConfig } from './lib/redis.mjs';
import { createUpstashClient } from './lib/redis-client.mjs';
import { postToGroupMe as sharedPostToGroupMe } from './lib/groupme.mjs';
import { postToGroupMeCapped } from './lib/groupme-capped.mjs';
import { sendPushFanout, broadcast } from './lib/push-fanout.mjs';
import { LEAGUES as REGISTRY_LEAGUES } from '../src/config/leagues-data.mjs';
// buildHostToSlugMap / stripLeaguePrefix / ensureLeaguePrefix moved out with
// the CTA builder — see scripts/lib/schefter-public-url.mjs. Left imported here
// they would read as dependencies this file still has.
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { createPublicUrl, normalizeBaseUrl } from './lib/schefter-public-url.mjs';
import { leagueYearFor } from './lib/schefter-league-year.mjs';
import { getSchefterLeague } from './lib/schefter-leagues.mjs';
import {
  getPtHour,
  getPtDateString,
  secondsUntilPtMidnight,
  isFridayPt,
} from './lib/pt-date.mjs';
import { HAIKU_MODEL, HAIKU_THINKING, responseText } from '../src/utils/claude-models.mjs';
import { readPackText } from './lib/beat-reporter-pack.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const DRY_RUN = process.argv.includes('--dry-run');
const TRADE_OFFERS_ONLY = process.argv.includes('--trade-offers-only');

// ── League selection (--league <slug>, default theleague) ──
//
// One scanner process serves exactly ONE league per invocation — the
// schefter-articles.yml pattern. Everything league-shaped below (paths,
// Redis key prefixes, GroupMe bot, base URL, feature gates) derives from
// this selection once at module init.
function parseLeagueArg() {
  const idx = process.argv.indexOf('--league');
  if (idx === -1) return 'theleague';
  const val = process.argv[idx + 1];
  if (!val || val.startsWith('--')) {
    throw new Error('--league requires a value (theleague | afl-fantasy)');
  }
  return val;
}
const SCHEFTER_LEAGUE = getSchefterLeague(parseLeagueArg());

// ── Constants ──

const LEAGUE_SLUG = SCHEFTER_LEAGUE.registrySlug;
// The raw registry entry (slug + domains) — what the URL-prefix helpers take.
const SCHEFTER_LEAGUE_REGISTRY = getLeagueBySlug(LEAGUE_SLUG);
const LEAGUE_ID = SCHEFTER_LEAGUE.leagueId;
// Redis keys below are league-scoped via schefterKey(NAV_SLUG, …): TheLeague
// keeps its legacy unprefixed keys; any other league gets schefter:<navSlug>:*.
const NAV_SLUG = SCHEFTER_LEAGUE.slug;
const MFL_HOST = process.env.MFL_HOST || 'api.myfantasyleague.com';
const FEED_PATH = SCHEFTER_LEAGUE.feedPath;
const CONFIG_PATH = SCHEFTER_LEAGUE.configPath;
const PLAYERS_PATH = SCHEFTER_LEAGUE.playersPath;

const RUMOR_POSTS_TODAY_KEY = schefterKey(NAV_SLUG, 'rumor:posts_today');
const RUMOR_GOSSIP_POSTS_TODAY_KEY = schefterKey(NAV_SLUG, 'rumor:gossip_posts_today');
// The rumor mill's OWN delivered-post counter, distinct from the shared
// `rumor:posts_today` budget above. The shared one also carries the
// transaction scanner's big-name-drop pings and the speculation lane, so
// gating the in-season cap on it would let a real roster move silence the
// rumor mill for the rest of the day (and vice versa). See
// scripts/lib/schefter-rumor-cadence.mjs for why the cap is the lane's alone.
const RUMOR_MILL_POSTS_TODAY_KEY = schefterKey(NAV_SLUG, 'rumor:mill_posts_today');
// The day's TRADE-story count, shared with scripts/schefter-trade-speculation.mjs.
// A topic ceiling rather than a post budget — see MAX_TRADE_POSTS_PER_DAY.
const RUMOR_TRADE_POSTS_TODAY_KEY = tradePostsTodayKey(NAV_SLUG);
// Counts GENERATION cycles (delivered or suppressed) — the aggregate
// LLM-rate ceiling, NOT a posting budget. See checkGates and the
// BUDGET-ON-DELIVERY sentinel for why the two are separate counters.
const RUMOR_GEN_ATTEMPTS_TODAY_KEY = schefterKey(NAV_SLUG, 'rumor:gen_attempts_today');
const RUMOR_LAST_POST_TS_KEY = schefterKey(NAV_SLUG, 'rumor:last_post_ts');
const FIRST_TIP_TS_KEY = schefterKey(NAV_SLUG, 'tips:first_tip_ts');
const TIPS_QUEUE_KEY = schefterKey(NAV_SLUG, 'tips:queue');
const TIPS_PROCESSED_KEY = schefterKey(NAV_SLUG, 'tips:processed');
const ROGER_LAST_RIFF_DATE_KEY = schefterKey(NAV_SLUG, 'ask_roger:last_riff_date');
const MORNING_GREETING_DATE_KEY = schefterKey(NAV_SLUG, 'morning_greeting:last_used_date');
// Feature 7 — "saying no, out loud" cooldown. Stores PT-date string of the
// last quiet-day post. Fires AT MOST once per QUIET_DAY_COOLDOWN_DAYS so
// Schefter doesn't make "slow news" his whole bit. See attemptQuietDayPost.
const QUIET_DAY_LAST_DATE_KEY = schefterKey(NAV_SLUG, 'rumor:quiet_day_last_date');
const QUIET_DAY_COOLDOWN_DAYS = 3;
// Rule 27 — hotseat storylines about one team cool down for 14 rolling days.
const HOTSEAT_TEAM_COOLDOWN_DAYS = 14;
const hotseatCooldownKey = (fid) => `${schefterKey(NAV_SLUG, 'hotseat:last_post:')}${fid}`;

// ── Phase 6: Trade-Offer Rumor Redis keys ──
// Cumulative-probability model. The base PER-DAY probability lives in
// `scripts/lib/redact-trade-offer.mjs#OFFER_POST_PROBABILITY` — deliberately
// NOT restated here, because the stale "~8 scans a day" figure that used to
// sit in this file is half of why the leak rate drifted unnoticed. Read the
// constant, and read Gate B beside it for the roll cadence it assumes.
// Each live offer gets:
//   - an entry in `first_seen` HASH (offerId → epoch ms of first sighting)
//     used to compute age → framingHint ('fresh' <48h, 'lingering' ≥48h)
//   - an entry in `exposure` HASH (offerId → int N) incremented every time
//     a dice roll passes and a post ships. This is the SINGLE source of
//     truth for graduated disclosure:
//       N=1 → first post named one team only
//       N=2 → second post added the marquee player
//       N=3+ → each later post added another player
//     Since 2026-09-08 a second post is RARE rather than routine: the offer
//     must survive OFFER_REPOST_COOLDOWN_MS (7d) and then win another daily
//     roll, and most proposals die first. The ladder therefore describes what
//     a re-surfacing offer may reveal, NOT a cadence to work through — the
//     old "keeping one offer in rotation is the point" framing is what shipped
//     the same offer twice in seven hours. We do NOT seed exposure from the
//     pre-2026-05 `posted` set:
//     every offer that predates the ladder is a closed/stale trade, so any
//     still-live offer starts fresh at signal=1.
//   - `posted` SET — still written on every post for admin tooling (the
//     Captured Trades card's posted/closed/stale pill logic). No longer an
//     absorbing gate; an offer can be in `posted` AND keep getting posts.
const OFFER_FIRST_SEEN_KEY = schefterKey(NAV_SLUG, 'trade_offers:first_seen');
const OFFER_EXPOSURE_KEY = schefterKey(NAV_SLUG, 'trade_offers:exposure');
const OFFER_POSTED_KEY = schefterKey(NAV_SLUG, 'trade_offers:posted');
const OFFER_STATE_TTL_SEC = 30 * 24 * 60 * 60;       // 30d on first_seen / exposure / posted

// ── Rarity controls (2026-09-08) ──
// Two keys that together turn the rumor mill from an advertising feed back
// into a beat. Both are HASHes keyed by offerId, on the same 30d TTL as the
// rest of the per-offer state.
//
// `last_roll_date` (PT date string) THROTTLES THE DICE to one roll per offer
// per Pacific day. The cron ticks every 15 minutes, so an offer used to draw
// ~50 rolls a day and OFFER_POST_PROBABILITY — nominally 5% — compounded to
// ~92% within 24 hours. Every offer leaked, almost immediately. With one roll
// a day the constant finally means what it reads like.
//
// `last_post` (epoch ms) enforces OFFER_REPOST_COOLDOWN_MS: the same proposal
// may not be the subject of a second post inside the window. On 2026-09-08 one
// offer was reported twice 7.5 hours apart — once inside a multi-desk bucket,
// once as its own story — which reads to the league as the same advertisement
// run twice, not as two pieces of news.
const OFFER_LAST_ROLL_DATE_KEY = schefterKey(NAV_SLUG, 'trade_offers:last_roll_date');
const OFFER_LAST_POST_KEY = schefterKey(NAV_SLUG, 'trade_offers:last_post');

// An offer that has already been reported goes quiet for a week. Chosen to sit
// just past the 7-day tip expiry: nearly every proposal dies inside the window,
// so in practice a given offer is reported once. The ones that survive it are
// genuinely still on the table a week later, and "this is somehow STILL
// sitting there" is a new story rather than a repeat of the old one.
const OFFER_REPOST_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

// Permanent archive of every offer the scanner has ever ingested. Distinct
// from `first_seen` because we want the running total to outlive the 30-day
// TTL — the admin page's "Trade Offers Archive" card needs to show offers
// from months/years ago, including ones that were never posted (retracted
// before the dice roll fired). Entry is JSON-encoded {offerId, offeringFid,
// partnerFid, willGiveUp, willReceive, comments, mflTimestamp, firstSeenMs}.
const OFFER_ARCHIVE_KEY = schefterKey(NAV_SLUG, 'trade_offers:archive');
// Per-offer roll counter: hincrby on every offer-scan iteration that gets to
// the dice roll (i.e., offers still eligible — not already-posted, not
// legacy-burned). Tells the commish how many GitHub Actions runs had a chance
// to leak the rumor before MFL dropped the offer.
const OFFER_ROLLS_KEY = schefterKey(NAV_SLUG, 'trade_offers:rolls');
// Movement state. `shape` fingerprints what each proposal is asking for so the
// next scan can tell "still sitting there" from "they changed the ask";
// `closed` makes a closure post fire exactly once per proposal, because a
// proposal can read as expired on every scan for the rest of its 30-day TTL.
const OFFER_SHAPE_KEY = schefterKey(NAV_SLUG, 'trade_offers:shape');
const OFFER_CLOSED_KEY = schefterKey(NAV_SLUG, 'trade_offers:closed');

const OFFER_LINGERING_THRESHOLD_MS = 48 * 60 * 60 * 1000;   // 48h → framing flip
const RE_OFFER_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;        // 30d → "these two have talked before"

const OFFER_OWNER_KEY_PREFIX = schefterKey(NAV_SLUG, 'trade_offers:owner:');
const OFFER_DIV_KEY_PREFIX = schefterKey(NAV_SLUG, 'trade_offers:div:');
// Owner-sourced intake: owners populate this hash from /api/trades/pending
// and /api/trades/submit. See src/utils/owner-trade-reports.ts. Read-only
// from this scanner — the API routes own the writes and TTL.
const OFFER_OWNER_REPORTS_KEY = schefterKey(NAV_SLUG, 'trade_offers:owner_reports');
const PLAYER_OFFER_HISTORY_PREFIX = schefterKey(NAV_SLUG, 'player_offer_history:');
const OFFER_ROLLING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;    // 7d owner + div
/**
 * Player escalation history, scoped to the player POOL the offer lives in.
 * Single-pool leagues (TheLeague) keep the legacy `player_offer_history:<pid>`
 * key; a per-conference league (the AFL rosters one player in both
 * conferences) gets `player_offer_history:<conf>:<pid>`, so two unrelated
 * deals in different conferences never read as "his name keeps coming up".
 */
export function playerOfferHistoryKey(pid, pool) {
  const p = pool == null ? '' : String(pool).trim();
  return p ? `${PLAYER_OFFER_HISTORY_PREFIX}${p}:${pid}` : `${PLAYER_OFFER_HISTORY_PREFIX}${pid}`;
}
const PLAYER_HISTORY_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;  // 21d player escalation

const ROGER_RIFF_PROBABILITY = 0.07;

// Trade rumors eat the bulk of our daily post quota; gossip is rationed
// to at most one per day so the feed doesn't read like a group-chat burn
// book. With a hard gossip cap of 1/day, the remaining slots are effectively
// reserved for trade rumors. When the backlog is deep OR a tip is aging
// out we bump the gossip cap by one that day — see computeAdaptiveGossipCap.
const MAX_POSTS_PER_DAY = 3;
// LLM safety valve: max generation cycles per day, counted whether the
// beat ships or gets suppressed. Posting budgets count delivered posts
// only, so without this an all-suppressed day would re-generate on every
// 15-min cron tick (~64 LLM rounds). Generous by design — 4× the posting
// cap — because it exists to stop runaway spend, not to shape cadence.
const MAX_GEN_ATTEMPTS_PER_DAY = 12;
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

// Hold-and-strike (Option A): when the quality gate suppresses a post, the
// tips in that beat are pushed back into the queue with `suppressedStrikes`
// incremented, instead of being drained. They re-marinate and get re-evaluated
// next cycle — at which point a corroborating tip about the same franchise
// can promote the scope to "franchise-multi-source" (rule 4) and clear the
// new specificity bar. Tips that exceed either threshold below are dropped.
// MAX_SUPPRESSED_STRIKES is per-TIP across all cycles (3 generation
// attempts lifetime), not a per-cycle counter — the per-day generation
// ceiling is MAX_GEN_ATTEMPTS_PER_DAY.
const MAX_SUPPRESSED_STRIKES = 3;
const MAX_HELD_MS = 48 * 60 * 60 * 1000;

const QUIET_HOUR_START = 23; // 11pm PT
const QUIET_HOUR_END = 7;    // 7am PT

// Busy-morning catch-up window. Trade-offer rumors accumulate in the queue
// overnight (dice rolls keep happening, but checkGates blocks the actual
// post during quiet hours). When the morning window opens and there's a
// backlog of 2+ trade tips, the scanner emits TWO trade-offer beats per
// cycle instead of one — both consuming a single MAX_POSTS_PER_DAY slot —
// so the backlog clears faster. Each beat carries a "busy morning" tone
// marker so Schefter acknowledges the overnight volume in-voice.
const BUSY_MORNING_END_HOUR = 10; // 7:00–9:59 PT
const BUSY_MORNING_TRADE_THRESHOLD = 2;

// Morning-greeting window. The first post of the day (any kind, any tier)
// in this window gets a "good morning, league" cold-open from the classic-
// news / SportsCenter playbook. Once-per-PT-day — subsequent morning posts
// go out greeting-less so we don't spam openers. Slightly wider than the
// busy-morning window so a post that lands at 10:30 (just after the
// catch-up window closes) still gets the greeting.
const MORNING_GREETING_END_HOUR = 11; // 7:00–10:59 PT

// Friday mailbag — one big roundup that sweeps the queue so nothing
// expires unseen. Runs once per Friday PT. Same Redis-key TTL pattern as
// the other daily counters.
const FRIDAY_MAILBAG_DONE_KEY = schefterKey(NAV_SLUG, 'mailbag:done_date');
const FRIDAY_WEEKDAY_INDEX = 5; // 0=Sun … 5=Fri

// Public URL of the tip page — appended to every GroupMe rumor post so
// owners always have a one-tap path to whisper back with intel. The feed
// card renders the same destination via post.link / post.linkLabel.
//
// PREFIXED, like every other feed link: `post.link` is persisted and rendered
// raw by the Schefter cards, and the bare `/schefter/tip` only resolves on a
// league apex host (the middleware rewrite) — on mfl.football it falls through
// to the 404 catch-all. publicUrl() strips the prefix for the apex-host
// absolute form, so the GroupMe CTA still reads `.../schefter/tip`.
const TIP_PAGE_PATH = `/${LEAGUE_SLUG}/schefter/tip`;
const TIP_PAGE_LINK_LABEL = 'Got a tip? Whisper to Schefter →';
// The prefix-aware CTA builder now lives in scripts/lib/schefter-public-url.mjs
// — the speculation lane needs the identical answer for its own GroupMe CTA,
// and a second copy of "does this base strip or keep the league prefix" is the
// shape this repo has already paid for once.
const PUBLIC_BASE_URL = normalizeBaseUrl(
  process.env.SCHEFTER_PUBLIC_BASE_URL || SCHEFTER_LEAGUE.baseUrl,
);
const publicUrl = createPublicUrl({
  baseUrl: PUBLIC_BASE_URL,
  leagueSlug: LEAGUE_SLUG,
  registryLeague: SCHEFTER_LEAGUE_REGISTRY,
});

const TIP_PAGE_ABSOLUTE_URL = publicUrl(TIP_PAGE_PATH);

// Trade-bait rumors send readers to the Trade Builder instead of the tip
// page — the owner has publicly listed players, so the natural next click
// is to build a counter-offer with those players pre-loaded. The ?b=<id>
// param is the same convention the rosters page uses (see rosters.astro).
const TRADE_BUILDER_LINK_LABEL = 'Open in Trade Builder →';
const TRADE_BUILDER_GROUPME_PREFIX = 'Counter on the block?';

function buildTradeBuilderPath(franchiseId) {
  return `/${LEAGUE_SLUG}/front-office/trade-builder?b=${encodeURIComponent(franchiseId)}`;
}

/**
 * A tip is "trade-flavored" if it's about trades in any way — actual MFL
 * pending offers, owner-listed trade bait, or web/groupme speculation with
 * topic === 'trade'. All three send readers to the Trade Builder so the
 * natural next click is to build a counter-offer, not to whisper back.
 *
 * Whisper-back tips (`repliesToPostId`) are excluded — the user explicitly
 * chose to reply to a non-trade rumor; we honor that lane.
 */
/**
 * This run's trading window (scripts/lib/schefter-trading-window.mjs), set
 * once in main() before any tip is read. Null until then, which reads as OPEN:
 * a failed calendar read must not mute the lane in the middle of the season.
 */
let TRADING_STATE = null;
const tradingClosed = () => TRADING_STATE?.closed === true;

/**
 * A pending MFL offer or an owner's trade-block listing. Both are about a
 * trade that could still happen, so neither has a story once trading closes.
 * Web/GroupMe chatter tagged `topic: 'trade'` is NOT in this set — "the
 * Geeks got fleeced in that deal" is a fine post-deadline story, and the
 * closed-trading prompt block keeps it in the past tense.
 */
function isLiveTradeTip(tip) {
  return tip?.source === 'trade_offer' || tip?.source === 'trade_bait';
}

function isTradeFlavoredTip(tip) {
  if (!tip) return false;
  if (tip.source === 'trade_offer' || tip.source === 'trade_bait') return true;
  if (tip.repliesToPostId) return false;
  return tip.topic === 'trade';
}

/**
 * Bare Trade Builder path used when a trade-flavored rumor doesn't resolve
 * to a single franchise (league-wide speculation, or a multi-franchise
 * cluster). Owners land on the empty builder and pick from there.
 */
const TRADE_BUILDER_PATH = `/${LEAGUE_SLUG}/front-office/trade-builder`;

/**
 * Resolve the CTA for a post based on its primary bucket.
 *
 * Trade-flavored beats (any tip with source 'trade_offer'/'trade_bait' or
 * topic 'trade') route to the Trade Builder — single-franchise scope
 * pre-loads via `?b=<fid>`, multi-franchise or league-wide drops to the
 * bare builder. Everything else (commish beef, roster gripes, predictions,
 * other) keeps the tip-page CTA so readers can whisper a follow-up.
 *
 * Returns the feed link, feed label, GroupMe prefix, and absolute GroupMe
 * URL so the post builder + groupMeTextFor stay in sync.
 */
function resolveCta(primaryBucket) {
  const tips = primaryBucket?.tips ?? [];
  // Once trading has closed there is no counter-offer to build, so the Trade
  // Builder link is an invitation to something MFL will refuse.
  const tradeFlavored = !tradingClosed() && tips.length > 0 && tips.some(isTradeFlavoredTip);
  if (tradeFlavored) {
    const franchiseIds = new Set(
      tips
        .filter(isTradeFlavoredTip)
        .map((t) => t.franchiseHint)
        .filter((fid) => typeof fid === 'string' && fid !== 'league-wide' && fid !== 'commish'),
    );
    const path = franchiseIds.size === 1
      ? buildTradeBuilderPath([...franchiseIds][0])
      : TRADE_BUILDER_PATH;
    return {
      link: path,
      linkLabel: TRADE_BUILDER_LINK_LABEL,
      groupMePrefix: TRADE_BUILDER_GROUPME_PREFIX,
      groupMeUrl: publicUrl(path),
    };
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
 * Skipped for trade-flavored beats — those route to the Trade Builder via
 * resolveCta, and a directed tip-form link would override that. Owners who
 * want to whisper back on a trade rumor can still tap the regular tip page.
 *
 * Returns null when the beat doesn't qualify (no franchise-explicit-pick
 * scope, the resolving tip has no franchiseHint, or any tip in the batch
 * is trade-flavored).
 */
function buildDirectedCta(beat) {
  const safe = beat?.anonymized?.[0];
  if (safe?.scope?.kind !== 'franchise-explicit-pick') return null;
  const batch = beat?.batch ?? [];
  if (batch.some(isTradeFlavoredTip)) return null;
  const tip = batch.find((t) => typeof t?.franchiseHint === 'string' && t.franchiseHint.length > 0);
  const franchiseId = tip?.franchiseHint;
  if (!franchiseId) return null;
  const franchiseShort = safe.scope.franchise || `Team ${franchiseId}`;
  const path = `${TIP_PAGE_PATH}?target=${encodeURIComponent(franchiseId)}`;
  return {
    link: path,
    linkLabel: `${franchiseShort} desk — your move →`,
    groupMePrefix: `${franchiseShort} desk — your move:`,
    groupMeUrl: publicUrl(path),
  };
}

/**
 * Cross-corroboration matcher. Detects when a real MFL pending offer
 * (`source: 'trade_offer'`) is being whispered about independently in the
 * web/groupme tip queue. When a match exists, the trade-offer tip gets
 * a `corroboratingSourceCount` and the LLM upgrades to direct-knowledge
 * voice ("multiple sources with direct knowledge", "spoke on the condition
 * of anonymity").
 *
 * Match signals (any of):
 *   1. Web/groupme tip has `topic === 'trade'` AND `franchiseHint` matches
 *      either side of the offer (offering franchise OR partner). This is
 *      the strong signal — deliberate scope on a trade-flavored tip.
 *   2. Web/groupme tip's `text` contains a player name from this offer
 *      (lower-cased substring match). Catches league-wide speculation that
 *      named the player without choosing a franchise scope.
 *
 * Trade-offer-to-trade-offer matching is excluded — corroboration is
 * specifically about INDEPENDENT tipster sources confirming a real offer.
 *
 * Returns the array of corroborating tip ids (deduped).
 */
function findCorroboratingTips(tradeOfferTip, otherTips) {
  if (!tradeOfferTip || tradeOfferTip.source !== 'trade_offer') return [];
  const offeringFid = tradeOfferTip.offeringFranchiseId;
  const partnerFid = tradeOfferTip.partnerFranchiseId;
  const playerNames = Array.isArray(tradeOfferTip.playerNames) ? tradeOfferTip.playerNames : [];
  const matchingFids = new Set([offeringFid, partnerFid].filter((fid) => typeof fid === 'string' && fid && fid !== 'league-wide' && fid !== 'commish'));

  const matches = new Set();
  for (const tip of otherTips) {
    if (!tip || tip.source === 'trade_offer') continue;
    let matched = false;

    if (tip.topic === 'trade' && tip.franchiseHint && matchingFids.has(tip.franchiseHint)) {
      matched = true;
    }

    if (!matched && playerNames.length > 0 && typeof tip.text === 'string' && tip.text.length > 0) {
      const textLower = tip.text.toLowerCase();
      for (const name of playerNames) {
        if (name && textLower.includes(name)) {
          matched = true;
          break;
        }
      }
    }

    if (matched) matches.add(tip.id);
  }
  return [...matches];
}

// ── Logging ──

function log(...args) {
  console.log(...args);
}
function warn(...args) {
  console.warn(...args);
}

// ── Redis (Upstash) — getRedisConfig (lib/redis.mjs) + createUpstashClient (lib/redis-client.mjs) shared ──

let _redis;

async function getRedis() {
  if (_redis !== undefined) return _redis;
  const config = getRedisConfig();
  if (!config) {
    warn('[rumor-scan] Redis credentials not set — exiting');
    _redis = null;
    return null;
  }
  try {
    _redis = await createUpstashClient(config);
    return _redis;
  } catch (err) {
    warn(`[rumor-scan] Redis import failed: ${err.message}`);
    _redis = null;
    return null;
  }
}

// ── Time helpers (Pacific Time) — getPtHour/getPtDateString/secondsUntilPtMidnight/isFridayPt now shared, see scripts/lib/pt-date.mjs ──

function isQuietHours(now = new Date()) {
  const h = getPtHour(now);
  // quiet from 23:00 (inclusive) through 06:59 (wraps midnight)
  return h >= QUIET_HOUR_START || h < QUIET_HOUR_END;
}

function isBusyMorningWindow(now = new Date()) {
  const h = getPtHour(now);
  // morning catch-up: 07:00 (inclusive) through 09:59 PT
  return h >= QUIET_HOUR_END && h < BUSY_MORNING_END_HOUR;
}

function isMorningGreetingWindow(now = new Date()) {
  const h = getPtHour(now);
  // morning greeting: 07:00 (inclusive) through 10:59 PT
  return h >= QUIET_HOUR_END && h < MORNING_GREETING_END_HOUR;
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

// The AFL's competition (Premier League / D-League) has ONE master,
// competition-history.json beside the config; the config carries no copy.
// The current makeup = the season the standings show (the league's own
// rollover clock, June 1 for the AFL) or the latest earlier one, never next
// season's makeup that the movement job records after Week 17. Absent for
// TheLeague.
async function loadCurrentCompetitionMembership() {
  try {
    const hist = JSON.parse(await fs.readFile(path.join(path.dirname(CONFIG_PATH), 'competition-history.json'), 'utf8'));
    const season = leagueYearFor(SCHEFTER_LEAGUE, new Date());
    const years = Object.keys(hist.seasons ?? {})
      .filter((y) => Number(y) <= season && Object.keys(hist.seasons[y]?.membership ?? {}).length)
      .sort((a, b) => Number(a) - Number(b));
    return years.length ? hist.seasons[years[years.length - 1]].membership : {};
  } catch {
    return {};
  }
}

async function loadTeams() {
  const raw = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
  const membership = await loadCurrentCompetitionMembership();
  const map = new Map();
  for (const t of raw.teams ?? []) {
    map.set(t.franchiseId, {
      name: t.name,
      nameMedium: t.nameMedium,
      nameShort: t.nameShort,
      abbrev: t.abbrev,
      division: t.division,
      // Every OTHER name this franchise answers to. Both are load-bearing for
      // text redaction, not decoration: an owner typing a team's nickname or
      // its retired name identifies it just as well as the current one, and
      // dropping these here is what let "Cock Gobbler" (The Show's 2025
      // last-place rebrand) reach a post that was not allowed to name a
      // second team. Retired names are the sharper risk of the two — a
      // punitive rebrand is recent AND memorable.
      aliases: Array.isArray(t.aliases) ? t.aliases : [],
      history: Array.isArray(t.history) ? t.history : [],
      // AFL-only fields; undefined for TheLeague. `competition` drives the hotseat
      // scope floor ({ kind: 'tier' }) — dropping it here silently downgrades
      // every Relegation-watch post to league-wide framing.
      conference: t.conference,
      competition: membership[t.franchiseId],
    });
  }
  return map;
}

function pickTeamName(team) {
  if (!team) return null;
  return team.nameShort || team.nameMedium || team.name || null;
}

// `collectFranchiseNameTokens` moved to scripts/lib/schefter-name-mask.mjs so
// the rumor scanner, the transaction scanner and the memory-block masker all
// harvest franchise names — retired forms and aliases included — the same way.

/**
 * Who CURRENTLY answers to each name form or alias, as `lowerName → Set<fid>`.
 * History is deliberately excluded: this map answers "is some live franchise
 * using this name right now", which is what decides whether a name may be
 * normalized onto another team.
 */
function buildCurrentNameOwners(teams) {
  const owners = new Map();
  const claim = (value, fid) => {
    if (typeof value !== 'string' || value.trim().length < 2) return;
    const key = value.trim().toLowerCase();
    if (!owners.has(key)) owners.set(key, new Set());
    owners.get(key).add(fid);
  };
  for (const [fid, team] of teams) {
    for (const field of ['name', 'nameMedium', 'nameShort', 'abbrev']) claim(team?.[field], fid);
    for (const alias of Array.isArray(team?.aliases) ? team.aliases : []) claim(alias, fid);
  }
  return owners;
}

/**
 * Lower-cased set of name tokens the franchise answering to `displayName` may
 * have NORMALIZED to that name. Used by the redactor to treat one franchise's
 * many names as one identity.
 *
 * A franchise does not get to claim a name another franchise is currently
 * using, even one sitting in its own `history[]`. TheLeague's "Midwestside
 * Connection" is 0010's former name and **0011's current one**, so with a
 * post scoped to 0010, a genuine mention of 0011 was being rewritten as
 * "Jocks" — not leaked, but actively misattributed to the wrong team, which
 * is worse. Those tokens fall through to "[a team]" instead.
 *
 * Resolution goes through CURRENT names first because `keepFranchise` is
 * always a current display form, and a historical name can collide with
 * another team's live one — matching on the full token set would hand the
 * keep-name to whichever franchise the Map happened to iterate first.
 *
 * Returns just the name itself when no franchise claims it, so an unknown
 * keep-name is still honored literally rather than silently redacted.
 */
function franchiseTokensOwning(teams, displayName, currentOwners) {
  const target = displayName.trim().toLowerCase();
  let ownerFid = null;
  const liveOwners = currentOwners.get(target);
  if (liveOwners && liveOwners.size > 0) {
    [ownerFid] = liveOwners;
  } else {
    for (const [fid, team] of teams) {
      const own = collectFranchiseNameTokens(new Map([[fid, team]]));
      if (own.some((t) => t.toLowerCase() === target)) { ownerFid = fid; break; }
    }
  }
  if (ownerFid === null) return new Set([target]);

  const own = collectFranchiseNameTokens(new Map([[ownerFid, teams.get(ownerFid)]]));
  const usedByAnotherLiveTeam = (lower) => {
    const owners = currentOwners.get(lower);
    return Boolean(owners) && [...owners].some((id) => id !== ownerFid);
  };
  return new Set(
    own
      .map((t) => t.toLowerCase())
      .filter((lower) => lower === target || !usedByAnotherLiveTeam(lower)),
  );
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A franchise name written with a hyphen or an underscore is the same name.
 * "Dead Cap" is 0004's `nameMedium`; a tipster typing "dead-cap is over the
 * limit" means exactly that team, but a literal space in the pattern misses
 * it. The token then falls apart into its pieces, and `dead` on its own is an
 * ordinary word the relaxation lets through — so the FULL name survived
 * intact, which is worse than the single-word case the relaxation was scoped
 * to allow ("balls-deep is rebuilding", "dead-cap is over the limit").
 *
 * Widening the separator is safe in a way that widening a word is not: it
 * cannot match anything a literal space wouldn't, except the same name under
 * different punctuation. Runs collapse, so "dead  --  cap" matches too.
 *
 * Applied to the ESCAPED token, which is fine because `escapeRegExp` leaves
 * whitespace alone.
 */
function withFlexibleSeparators(escaped) {
  return escaped.replace(/\s+/g, SEPARATOR_RUN);
}

/**
 * What may stand in for the space inside a multi-word franchise name:
 * HORIZONTAL whitespace, hyphen, underscore, slash — or a period that is NOT
 * followed by whitespace.
 *
 * Each exclusion is a real over-redaction that was measured, not a precaution.
 * Widening a separator is cheap to get wrong in exactly the direction this
 * change exists to fix:
 *
 * - **Horizontal only.** `\s` spans line breaks, so a wrapped tip reading
 *   "I watched the\nshow last night." matched "The Show" and came out as
 *   "I watched [a team] last night." A franchise name does not straddle a
 *   newline; two unrelated lines routinely do.
 * - **The period is guarded.** A period is also a full stop, so "The deal is
 *   dead. Cap space is tight." matches "Dead Cap" across the sentence break
 *   and welds two sentences into one phantom team. `\.(?!\s)` keeps
 *   "dead.cap" (one token) and refuses "dead. Cap" (two sentences).
 * - **The slash pays for itself only with the left-edge guard below.** It is
 *   here because "dead/cap" otherwise leaks the full name, but a slash is
 *   also a path separator: "see /the/show for context" and
 *   "https://example.com/smokane/fc" both redacted a URL segment into a team.
 *   See `LEFT_EDGE_GUARD`.
 */
const SEPARATOR_RUN = '(?:[^\\S\\r\\n\\u2028\\u2029]|[-_/]|\\.(?!\\s))+';

/**
 * A name may not START immediately after a slash. That position is a URL or
 * path segment, never a franchise mention, and admitting `/` as an internal
 * separator (above) is what made those segments reachable at all. Tips carry
 * links routinely — Schefter's own CTAs are URLs — so this is a live shape,
 * not a hypothetical.
 *
 * Extends the existing `(?<!\w)` guard rather than replacing it: a name still
 * may not start glued to a word character either.
 */
const LEFT_EDGE_GUARD = '(?<![\\w/])';

/**
 * Lower-cased with separator runs collapsed to a single space, so a match and
 * a config form compare equal regardless of how the tipster punctuated it.
 * Both the keep-franchise identity check and the alias-normalization lookup go
 * through this — without it, `withFlexibleSeparators` would match "dead-cap"
 * and then fail every Set lookup keyed on "dead cap", quietly demoting the
 * KEPT franchise's own name to "[a team]".
 */
function canonicalizeNameKey(s) {
  return s.toLowerCase().replace(/[\s\-_/.]+/g, ' ').trim();
}

/**
 * Boundary-matched alternation over every franchise name token, longest form
 * first. Two deliberate choices, each of which was a live bug:
 *
 * 1. **Per-token edge guards, not `\b … \b` and not a blanket lookaround.**
 *    A word boundary is defined between a word and a non-word character, so
 *    it cannot exist after a token that ENDS in punctuation — `\bThe Blunt
 *    Bros\.\b` never matches "The Blunt Bros." at all. Eight real AFL names
 *    die that way, including the punitive "Be Rough!" and "Lucky Buck$".
 *
 *    But wrapping every token in `(?<!\w) … (?!\w)` fixes only the common
 *    case and reintroduces the same defect at the seam: "The Blunt
 *    Bros.are done" leaves `.` followed by `a`, so the trailing `(?!\w)`
 *    fails and the whole name survives. The guard has to depend on the
 *    token's own edges — a token that already ENDS in punctuation carries
 *    its own delimiter and needs no right guard; one that ends in a word
 *    character does. Same on the left.
 * 2. **ONE alternation, not a replace() per token.** Sequential passes
 *    re-scan their own output: with "Smokane" kept and normalized to
 *    "Smokane FC", the later "Smokane" pass matches inside the "Smokane FC"
 *    an earlier pass just wrote, yielding "Smokane FC FC" ("The Show" →
 *    "The The Show" the same way). A single pass visits each position once,
 *    and alternation is ordered so the longest name wins there.
 */
function buildFranchiseNameMatcher(tokens) {
  if (tokens.length === 0) return null;
  const alternation = tokens
    .map((t) => {
      // Only assert "not glued to a word character" on an edge that is
      // itself a word character. Punctuation is already its own boundary.
      const left = /^\w/.test(t) ? LEFT_EDGE_GUARD : '';
      const right = /\w$/.test(t) ? '(?!\\w)' : '';
      return `${left}${withFlexibleSeparators(escapeRegExp(t))}${right}`;
    })
    .join('|');
  return new RegExp(`(?:${alternation})`, 'gi');
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
 *
 * `keepFranchise` arrives as ONE display name, but the franchise behind it
 * answers to several (short forms, aliases, retired names). Those are kept
 * too — it is the same team, and HARD RULE 4 lets Schefter name it — but
 * they are NORMALIZED to the canonical display name rather than passed
 * through verbatim, so a tipster's nickname or last-season's punitive
 * rebrand never becomes the label Schefter prints.
 */
/**
 * Per-teams-map cache for the two expensive derivations — the token harvest
 * (plus its compiled matcher) and the per-franchise token sets keyed by
 * display name. Both are pure functions of the config, but the redactor runs
 * once per tip per field, so recomputing them made the scrub
 * O(tips × fields × franchises). Keyed on the Map identity, which the scanner
 * builds once per run.
 *
 * CONTRACT: the `teams` map is treated as IMMUTABLE once redaction has seen
 * it. Mutating a team in place, or adding one, after the first scrub will not
 * invalidate the cache and the new name will not be redacted. Every caller
 * builds the map once per run via `loadTeams()` and never touches it again;
 * keep it that way. The `size` check below catches the add/remove case
 * cheaply, but nothing catches in-place edits — don't rely on it.
 */
const redactionCache = new WeakMap();

/**
 * Franchise name forms that are ALSO ordinary words a tipster uses in ordinary
 * football prose. Matched case-insensitively at a floor of two characters, the
 * harvest turns these into a shredder aimed at the tip's own content:
 *
 *   "Deal is dead."               → "Deal is [a team]."          (DEAD, 0004 abbrev)
 *   "He is a heavy favorite"      → "a [a team] favorite"        (Heavy, 0004 retired nameShort)
 *   "Owner put out feelers"       → "put out [a team]"           (Feelers, AFL 0017 alias)
 *   "headed to the Saints"        → "the [a team]"               (Saints, AFL 0020 — an NFL team)
 *   "Swift is being shopped"      → "[a team] is being shopped"  (Swift, AFL 0016 — an NFL player)
 *
 * CLAUDE.md's "over-matching is the safe direction" is still right, but it was
 * written assuming a stray hit merely fuzzes a word. It does something worse:
 * "[a team]" is a SEMANTIC INSERTION. It asserts that a franchise reference
 * existed where none did, and HARD RULES 2/3 then order the LLM to make the
 * tip's content survive the fuzz — so the model dutifully invents a team's
 * involvement out of "put out feelers". A leak names the wrong team; this
 * fabricates one, on a tip nobody scoped to a franchise at all.
 *
 * The relaxation is deliberately narrow — a token in here is not dropped, it
 * only stops matching in the two positions where it CANNOT be a proper noun
 * (see `readsAsOrdinaryProse`). Capitalized mid-sentence, it still redacts.
 *
 * Inclusion test: would this word plausibly appear in a fantasy-football tip
 * in a NON-team sense? Team-flavored forms that merely happen to be words
 * ("Mafia", "Generals", "Ninjas", "Pigs") stay out — nobody writes those in
 * prose. Every entry must be a real config form, and its franchise must keep
 * a non-ambiguous form; `tests/schefter-franchise-name-redaction.test.ts`
 * enforces both against the live configs, so a rename cannot quietly add an
 * entry here that strips a franchise of all protection.
 */
export const AMBIGUOUS_NAME_TOKENS = new Set([
  // TheLeague
  'art', 'chevy', 'cowboy', 'dead', 'dogs', 'dream', 'fire', 'gap', 'grid',
  'heavy', 'music', 'pain', 'rock',
  // AFL
  'baked', 'ballers', 'balls', 'bastards', 'chat', 'clowns', 'drunk',
  'dummies', 'feelers', 'herd', 'indians', 'married', 'mint', 'reckless',
  'saints', 'shit', 'show', 'smoke', 'swift', 'wonders',
]);

/**
 * Narrow `AMBIGUOUS_NAME_TOKENS` to the forms it is actually safe to relax.
 *
 * Two different questions decide that, and only one of them is answerable by
 * a human writing a list:
 *
 *   1. "Is this an ordinary English word?" — judgment, not derivable.
 *      That is what `AMBIGUOUS_NAME_TOKENS` above encodes.
 *   2. "Is this a name people currently CALL the team?" — derivable, and it
 *      changes every time a franchise renames. That is this function.
 *
 * A token is relaxable only when every one of its appearances across BOTH
 * leagues is incidental: an MFL `abbrev` (a 3-5 char code nobody types in
 * prose) or any field on a RETIRED `history[]` entry. The moment some
 * franchise wears it as a current `name`/`nameMedium`/`nameShort`/alias — the
 * forms an owner actually writes — it is blocked everywhere, because a
 * lowercase bare nickname identifies that team to any reader.
 *
 * Found by the Codex reviewer on PR #547: with the flat list, "hearing saints
 * is shopping a tight end" reached the prompt intact, and `Saints` is AFL
 * 0020's `nameShort`. Same for `balls`, `feelers`, `herd`, `chat`, `swift`,
 * `fire`, `pain`, `indians`, `cowboy`, `dream`, `baked`.
 *
 * Blocking is global rather than per-franchise on purpose: a token that is
 * one team's dead abbreviation and another's live nickname must lose, and
 * `abbrev` is treated as incidental even when current because it is a code,
 * not a name. All three originally reported cases (`dead`, `heavy`, `chevy`)
 * survive this filter — 0004 wears `DEAD` as an abbrev and retired
 * "Heavy Chevy" years ago.
 */
export function computeRelaxableTokens(teams) {
  const relaxable = new Set();
  const blocked = new Set();
  const claim = (value, incidental) => {
    if (typeof value !== 'string') return;
    const key = value.trim().toLowerCase();
    if (!AMBIGUOUS_NAME_TOKENS.has(key)) return;
    (incidental ? relaxable : blocked).add(key);
  };
  for (const team of teams.values()) {
    for (const field of ['name', 'nameMedium', 'nameShort']) claim(team?.[field], false);
    for (const alias of Array.isArray(team?.aliases) ? team.aliases : []) claim(alias, false);
    claim(team?.abbrev, true);
    for (const h of Array.isArray(team?.history) ? team.history : []) {
      for (const field of ['name', 'nameMedium', 'nameShort', 'abbrev']) claim(h?.[field], true);
      for (const alias of Array.isArray(h?.aliases) ? h.aliases : []) claim(alias, true);
    }
  }
  for (const b of blocked) relaxable.delete(b);
  return relaxable;
}

/**
 * Whether this match of an ambiguous token reads as an ordinary word rather
 * than a franchise mention. The test is CASE ALONE: lowercase relaxes,
 * anything capitalized still redacts.
 *
 * Every franchise name form in both configs is stored capitalized (the lone
 * exception, TheLeague's lowercase `dream` alias, is covered by "The Dream"),
 * so a lowercase match carries ZERO evidence of name use and relaxing it is
 * free. A capital carries some, and that is where this stops.
 *
 * **Rejected: also relaxing a capital that is merely sentence-initial.** It is
 * tempting — "Fire sale incoming.", "Dream scenario for that roster." and
 * "Balls to the wall on this rebuild." are natural tip openers and all three
 * get eaten without it. But sentence-initial position destroys the only signal
 * there is, and the same position is where a tipster names a team as the
 * subject. Measured against the live configs, it leaked five franchises
 * outright — "Saints are shopping a tight end.", "Feelers wants a
 * quarterback.", "Balls is rebuilding.", "Herd has been quiet.", "Chat is
 * shopping a RB." all passed through untouched.
 *
 * A subject-cue guard (redact when the next word is `is`/`are`/`wants`/…)
 * closes exactly those five and keeps the three openers, but still leaks on
 * any ordinary verb — "Saints traded for a QB", "Herd landed a WR" — and a
 * knowingly-partial privacy heuristic is what this whole change is arguing
 * against. Privacy takes the tie, same as for the two unresolvable
 * mid-sentence collisions ("Saints" the AFL franchise vs. the NFL club,
 * "Swift" the franchise vs. the running back).
 */
function readsAsOrdinaryProse(match, relaxable) {
  if (!relaxable.has(match.toLowerCase())) return false;
  return !/^[A-Z]/.test(match);
}

function getRedactionContext(teams) {
  let ctx = redactionCache.get(teams);
  if (ctx && ctx.size !== teams.size) ctx = null;
  if (!ctx) {
    const tokens = collectFranchiseNameTokens(teams);
    ctx = {
      size: teams.size,
      matcher: buildFranchiseNameMatcher(tokens),
      currentOwners: buildCurrentNameOwners(teams),
      relaxable: computeRelaxableTokens(teams),
      ownedBy: new Map(),
    };
    redactionCache.set(teams, ctx);
  }
  return ctx;
}

export function redactFranchiseNamesInText(text, teams, { keepFranchise } = {}) {
  if (typeof text !== 'string' || text.length === 0) return text;
  const { matcher, ownedBy, currentOwners, relaxable } = getRedactionContext(teams);
  if (!matcher) return text;
  const keepName = typeof keepFranchise === 'string' && keepFranchise.trim().length > 0
    ? keepFranchise.trim()
    : null;
  const keepLower = keepName ? canonicalizeNameKey(keepName) : null;
  let keepTokens = new Set();
  if (keepName) {
    if (!ownedBy.has(keepLower)) {
      ownedBy.set(
        keepLower,
        new Set(
          [...franchiseTokensOwning(teams, keepName, currentOwners)]
            .map(canonicalizeNameKey),
        ),
      );
    }
    keepTokens = ownedBy.get(keepLower);
  }
  return text.replace(matcher, (match) => {
    const lower = canonicalizeNameKey(match);
    // FIRST, before any keep-franchise handling. An ordinary word that happens
    // to be one of the KEPT franchise's own forms would otherwise fall into
    // the normalize branch below and be rewritten to that team's display name
    // — so a tip scoped to Dead Cap Walking turns "the deal is dead" into
    // "the deal is Dead Cap Walking". That is the same fabrication as
    // "[a team]" with a specific team's name on it, which is strictly worse.
    if (readsAsOrdinaryProse(match, relaxable)) return match;
    // Already the canonical name — leave it exactly as the tipster wrote it.
    if (keepLower && lower === keepLower) return match;
    // Another name for the franchise we ARE allowed to name: normalize to the
    // canonical form so a nickname or last season's rebrand never becomes the
    // label Schefter prints.
    if (keepTokens.has(lower)) return keepName;
    return '[a team]';
  });
}

/**
 * Scopes whose whole point is that the franchise stays unidentified. Anything
 * NOT in this set is either allowed to name its franchise or has no free text.
 */
const NAMING_ALLOWED_SCOPES = new Set([
  'franchise-multi-source',
  'franchise-explicit-pick',
  'trade-bait',
]);

/**
 * THE redaction point. Applied once to the finished payload, after scope
 * resolution, to EVERY free-text field the LLM will see.
 *
 * This is deliberately not done inside the scope branches. `resolveTipScope`
 * is a long classifier with a dozen early returns, and a sanitizer sitting at
 * its tail only protects whichever paths happen to fall through — `league-wide`
 * and `commish` returned raw text for months for exactly that reason. Sanitizing
 * the RESULT instead of trusting the control flow makes the guarantee total,
 * and makes a new scope branch safe by default.
 *
 * `threadFollowup.parentHeadlineSnippet` is the field that proved the point: it
 * is lifted from a PUBLISHED post, which may legitimately have named a
 * franchise, and pinned onto a tip that may be fully anonymous. It reaches the
 * prompt through the same JSON.stringify as `text`, so it needs the same scrub.
 */
function redactSafePayload(safe, teams) {
  // GroupMe is public by design — the author @'d Schefter in the group chat
  // and HARD RULE 6 encourages naming them. Nothing to fuzz.
  if (safe?.scope?.kind === 'groupme-public') return safe;

  const keepFranchise = NAMING_ALLOWED_SCOPES.has(safe?.scope?.kind)
    ? safe.scope.franchise
    : null;
  const scrub = (v) => redactFranchiseNamesInText(v, teams, { keepFranchise });

  if (typeof safe.text === 'string') safe.text = scrub(safe.text);
  if (typeof safe.author === 'string' && !safe.attributable) safe.author = scrub(safe.author);
  if (typeof safe.threadFollowup?.parentHeadlineSnippet === 'string') {
    safe.threadFollowup.parentHeadlineSnippet = scrub(safe.threadFollowup.parentHeadlineSnippet);
  }
  // Trade-bait carries the owner's own MFL comments. Naming the LISTING team
  // is the whole point of this scope, but the owner typed these by hand and
  // routinely names a counterparty in them ("Call the Geeks only") — that
  // second team gets no say and no consent signal, so it fuzzes like any
  // other. They reach the prompt through the same JSON.stringify as `text`.
  for (const field of ['ownerWillGiveUp', 'ownerWillTake']) {
    if (typeof safe.meta?.[field] === 'string') safe.meta[field] = scrub(safe.meta[field]);
  }
  return safe;
}

// ── Tip receipts ──

/**
 * Record what became of one owner's tip, so the tip page can answer "what
 * happened to the thing I sent?".
 *
 * Before this existed, a web tip had exactly two observable outcomes: a post
 * appears, or nothing ever happens. "Nothing ever happens" covered the whole
 * back half of the pipeline — the quality gate suppressing a beat three times
 * until the tip struck out, a tip aging past TIP_EXPIRY_MS in a quiet week,
 * a hold that ran past MAX_HELD_MS. All three are legitimate editorial
 * outcomes; none of them was survivable as a user experience, because the
 * tipster could not distinguish them from a broken tip line. (Sep 2026: an
 * owner's tip was generated, scored 2/10, held, and struck out over ~30h
 * without a single signal reaching them.)
 *
 * One key per tipster, overwritten each time — this is a receipt for your
 * most recent tip, not an audit log, and it never accumulates history that
 * could be correlated back to an identity. Web tips only: GroupMe tippers
 * have no hashedOwnerId and trade-offer tips have no human behind them.
 *
 * `status`:
 *   published — a post carrying this tip shipped to the feed
 *   spiked    — the quality gate suppressed it to exhaustion (3 strikes /
 *               past the 48h hold window). Schefter couldn't find the angle.
 *   expired   — aged out of the queue unposted (quiet week, never chosen)
 */
const TIP_RECEIPT_TTL_SEC = 14 * 24 * 60 * 60;

async function recordTipReceipt(redis, tip, outcome) {
  if (!redis || DRY_RUN) return;
  if (!tip || tip.source !== 'web') return;
  const hash = typeof tip.hashedOwnerId === 'string' ? tip.hashedOwnerId : '';
  if (!hash) return;
  try {
    await redis.set(
      `${schefterKey(NAV_SLUG, 'tipster:last_receipt:')}${hash}`,
      JSON.stringify({
        status: outcome.status,
        postId: outcome.postId ?? null,
        tipId: tip.id,
        topic: typeof tip.topic === 'string' ? tip.topic : null,
        submittedAt: tip.submittedAt ?? null,
        at: Date.now(),
      }),
      { ex: TIP_RECEIPT_TTL_SEC },
    );
  } catch (err) {
    warn(`  [tip-receipt] write failed for ${tip.id}: ${err.message}`);
  }
}

// ── GroupMe ──

// Quality-gate suppressions tracker — populated when checkGroupMeQuality
// blocks a chat ping. Flushed to data/schefter/groupme-suppressions.json
// at exit so a workflow follow-up can act on it. Mirrors the contract used
// by scripts/schefter-scan.mjs.
const groupMeSuppressions = [];
async function recordRumorGroupMeSuppression(entry) {
  warn(`  [quality-gate] SUPPRESSED GroupMe: ${entry.id} (score ${entry.score}) — ${entry.reason}`);
  groupMeSuppressions.push({
    league: LEAGUE_SLUG,
    timestamp: new Date().toISOString(),
    ...entry,
  });
}

async function flushGroupMeSuppressions() {
  try {
    const suppressionsPath = path.join(projectRoot, 'data', 'schefter', 'groupme-suppressions.json');
    await fs.mkdir(path.dirname(suppressionsPath), { recursive: true });
    let existing = [];
    try {
      const raw = JSON.parse(await fs.readFile(suppressionsPath, 'utf8'));
      if (Array.isArray(raw?.suppressions)) existing = raw.suppressions;
    } catch {
      // file missing or unparseable — start fresh
    }
    const merged = [...existing, ...groupMeSuppressions];
    // Skip-if-unchanged, ignoring `generatedAt` — same reason as the sibling
    // write in schefter-scan.mjs: a rewrite whose only difference is the run
    // clock still commits to `main`, and every commit to `main` is a
    // production build.
    writeJsonIfChanged(
      suppressionsPath,
      JSON.stringify({ generatedAt: new Date().toISOString(), suppressions: merged }, null, 2) + '\n',
      { ignoreKeys: ['generatedAt'] },
    );
    if (groupMeSuppressions.length > 0) {
      log(`⚠️  Suppressed ${groupMeSuppressions.length} GroupMe send(s) (see ${path.relative(projectRoot, suppressionsPath)})`);
    }
  } catch (err) {
    warn(`  Failed to write GroupMe suppressions log: ${err.message}`);
  }
}

// Wraps the shared postToGroupMe() (scripts/lib/groupme.mjs). The missing-bot-id
// check happens here, BEFORE the dry-run check, to preserve the original branch
// order — if both are true, the original warned about the missing bot id rather
// than logging the dry-run preview.
/** Push a rumor beat to owners who asked for the rumor mill. */
async function pushRumor(post) {
  if (!post?.headline) return;

  const registry = REGISTRY_LEAGUES[SCHEFTER_LEAGUE.registrySlug];
  if (!registry) return;
  const teams = await loadTeams().catch(() => null);
  if (!teams || teams.size === 0) return;

  await sendPushFanout({
    league: registry,
    dryRun: DRY_RUN,
    category: 'rumor',
    notifications: broadcast({
      franchiseIds: [...teams.keys()],
      title: post.headline,
      body: (post.body ?? '').slice(0, 160),
      url: '/news',
      tag: post.id,
    }),
    log: { log, warn },
  });
}

/**
 * Deliver one rumor beat.
 *
 * Takes the POST as well as the composed chat text: the group chat gets a
 * single blob of body copy, but a push needs a headline, a link and a stable
 * tag. Rumors are held out of the chat entirely by the daily cap, so in
 * practice this function's real job is now the push.
 */
async function postToGroupMe(text, post = null) {
  await pushRumor(post);
  const botId = SCHEFTER_LEAGUE.groupMeSchefterBotId;
  if (!botId) {
    warn('[rumor-scan] GROUPME_SCHEFTER_BOT_ID not set — skipping GroupMe (Roger is reserved for deadlines)');
    return;
  }
  // Rumors are push-only under the league-wide cap: high volume, and none of
  // it is the day's news. Held here rather than removed, so re-enabling is a
  // one-line calendar change if the league ever wants a rumor day.
  await postToGroupMeCapped({
    // SCHEFTER_LEAGUE.slug IS the nav slug here (see schefter-leagues.mjs) —
    // passed explicitly rather than letting the wrapper guess, because a
    // registry entry's `slug` is the CANONICAL one ('afl-fantasy') and keying
    // the day off the wrong one would silently give a league two slots.
    league: { navSlug: SCHEFTER_LEAGUE.slug },
    kind: 'rumor',
    botId,
    text,
    dryRun: DRY_RUN,
    onDryRun: (sent) => log(`  [dry-run] Would post to GroupMe:\n${sent}`),
    onPosted: () => log('  [GroupMe] Posted'),
    onFetchError: (err) => warn(`  [GroupMe] Failed: ${err.message}`),
  });
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
    return await isOverNamingRateLimit(tipsterHash, franchiseId, redis, NAV_SLUG);
  } catch {
    return false;
  }
}

async function safeGetTeamNameCount30d(franchiseId, redis) {
  if (!redis) return 0;
  try {
    return await getTeamNameCount30d(franchiseId, redis, undefined, NAV_SLUG);
  } catch {
    return 0;
  }
}

export async function anonymizeTips(tips, teams, feedPosts = [], now = new Date(), redis = null, tipsterContext = null) {
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

  // Who currently answers to each in-use name/alias, league-wide. This is an
  // ownership map rather than a flat set of taken names on purpose: a
  // franchise usually keeps its own retired name in `aliases` so people can
  // still search by it, and a flat set can't distinguish "another team has
  // this name" from "this team kept its own old nickname". Former-name
  // callbacks need the former (TheLeague's "Midwestside Connection" moved
  // from 0010 to 0011, so it must never become 0010's callback) without
  // tripping over the latter.
  const nameOwners = new Map();
  const claim = (value, fid) => {
    if (typeof value !== 'string' || value.trim().length < 2) return;
    const key = value.trim().toLowerCase();
    if (!nameOwners.has(key)) nameOwners.set(key, new Set());
    nameOwners.get(key).add(fid);
  };
  for (const [fid, team] of teams) {
    for (const field of ['name', 'nameMedium', 'nameShort', 'abbrev']) claim(team?.[field], fid);
    for (const alias of Array.isArray(team?.aliases) ? team.aliases : []) claim(alias, fid);
  }
  // Tokenized on the way out: `current` and `former` are the two fields the
  // model PRINTS, so they become {{TEAM:<fid>}} and {{TEAM_FORMER:<fid>:<year>}}.
  // A franchise identity here is (franchiseId, year) — 0003 is Maverick now,
  // was Generals in 2014 — so the token carries both and resolves to exactly
  // one name. lastSeason/punitive/phase stay real: they are facts the model
  // reasons about, not names it prints.
  const formerNameFor = (team, currentName, franchiseId) => {
    const callback = buildFormerNameCallback(team, { currentName, nameOwners, franchiseId, now });
    return callback ? tokenizedFormerName(callback, franchiseId, team) : undefined;
  };

  // Scope resolution and redaction are deliberately separate stages: this
  // classifier returns early from a dozen branches, so redacting inside it
  // means every future branch has to remember to. `redactSafePayload` runs on
  // whatever comes back, so it cannot be skipped.
  const resolveTipScope = async (tip) => {
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
      // Cross-corroboration: when independent web/groupme tips name the
      // same trade, the LLM upgrades to direct-knowledge voice. The count
      // is anonymous metadata — no source ids, no franchise names leak.
      // Internal-only fields (partnerFranchiseId, playerNames) used by the
      // matcher upstream are NEVER passed to the LLM.
      if (typeof tip.corroboratingSourceCount === 'number' && tip.corroboratingSourceCount > 0) {
        safe.corroboratingSourceCount = tip.corroboratingSourceCount;
      }
      // Age-based framing — 'lingering' means the offer has been open ≥48h
      // and nobody has answered; the LLM should swap to a "phones aren't
      // picking up" frame instead of fresh-rumor energy.
      safe.framingHint = tip.framingHint ?? 'fresh';
      // Graduated disclosure (Phase 6c): per-offer exposure ladder. When
      // present, this is the AUTHORITATIVE name surface — the LLM may name
      // exposure.team and any player in exposure.players, and nothing else.
      // signal=1 ships team only; signal=2 adds the marquee player; signal=3+
      // keeps adding the next-best player. See HARD RULE 26 in the trade
      // playbook for the LLM-facing rules.
      if (tip.exposure && tip.exposure.team) {
        safe.exposure = {
          signal: tip.exposure.signal,
          // TOKEN, not the name. The model cannot substitute a franchise it
          // was never given, which is what "never name a second team" had been
          // relying on it to choose not to do. The token carries the franchise
          // id, so resolution is a lookup rather than an assumption about
          // which team this post is about. Substituted at the body choke
          // point — see resolveTeamTokens.
          // Tips queued BEFORE this shipped carry no `fid` (7-day expiry, and
          // held tips are requeued), and redactTradeOffer permits null. Those
          // fall back to the pre-token behavior rather than minting
          // `{{TEAM:undefined}}` — which resolves to nothing, discards the AI
          // body, and spends the offer's advanced exposure counter on a
          // template that names no team. Self-healing: the queue drains inside
          // a week and every new tip is tokenized.
          team: tip.exposure.fid
            ? tokenizedTeam(tip.exposure.fid)
            : { ...tip.exposure.team },
          players: Array.isArray(tip.exposure.players)
            ? tip.exposure.players.map((p) => ({ ...p }))
            : [],
        };
      }
      // Beats — the drip layer. Carries no franchise names of its own (the
      // only nameable team is the one already in `exposure`) and no player
      // name outside `exposure.players` / the named escalation tier, because
      // `buildMarketBeats` takes the nameable set and falls back to
      // position-level subjects for everyone else. `leadKind` tells the LLM
      // which fact is NEW this signal so consecutive posts about one proposal
      // open differently.
      if (Array.isArray(tip.beats) && tip.beats.length > 0) {
        safe.beats = tip.beats.map((b) => ({ ...b }));
        if (tip.leadKind) safe.leadKind = tip.leadKind;
      }
      // Scrub text/author fields that don't apply. Internal-only audit fields
      // (partnerFranchiseId, playerNames, offeringFranchiseId, offerId,
      // hashedOwnerId) are never written into `safe` above, so there's
      // nothing else to strip here.
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
      // Former-name callback (HARD RULE 30) — only ever attached to a scope
      // that is already allowed to name this franchise, so the bit can never
      // become a back door to identifying a team Schefter must keep anonymous.
      safe.formerName = formerNameFor(team, franchiseName, hint);
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

    // Tipster-aware voice flags (web tips only — groupme/trade_offer/trade_bait
    // returned above). Surfaced early so EVERY web-tip scope branch (league-wide,
    // commish, division, multi-source, explicit-pick) carries them. These are
    // ANONYMOUS framing signals: HARD RULE 22 uses `firstTimeTipster` for
    // curiosity-spark phrasing, HARD RULE 23 uses `prolificTipster` for soft
    // hedge, HARD RULE 24 uses `tipsterBeat` for the standing-beat nod
    // WITHOUT ever attaching a codename (option B — codename:topic binding
    // stays private). None of these flags leak hashedOwnerId, franchise, or
    // division.
    if (
      typeof tip.hashedOwnerId === 'string' &&
      tip.hashedOwnerId.length > 0 &&
      tipsterContext
    ) {
      const c = tipsterContext.get(tip.hashedOwnerId);
      if (c) {
        if (c.isFirstTime) safe.firstTimeTipster = true;
        if (c.isProlific) safe.prolificTipster = true;
        if (c.beat && typeof c.beat.topic === 'string') {
          // ONLY the topic — the codename never surfaces here.
          safe.tipsterBeat = { topic: c.beat.topic };
        }
      }
    }

    // Per-topic naming/scope policy from the topic registry. Accusation-
    // shaped and reader-de-anonymizable topics carry stricter rules than the
    // default multi-source/explicit-pick ladder.
    const topicPolicy = getTopicPolicy(tip.topic, NAV_SLUG);
    if (topicPolicy.mandatoryHedge) safe.mandatoryHedge = true;

    const hint = tip.franchiseHint;
    if (!hint || hint === 'league-wide') {
      safe.scope = { kind: 'league-wide' };
      return safe;
    }

    if (hint === 'commish') {
      // Commish is a role, not an anonymity leak — the office is public.
      // Schefter can reference "the commissioner" without naming the franchise.
      // The office being public is exactly why the FRANCHISE stays fuzzed.
      safe.scope = { kind: 'commish' };
      return safe;
    }

    const team = teams.get(hint);
    if (topicPolicy.namingPolicy === 'never') {
      // Scope floor: content readers could de-anonymize by cross-referencing
      // public standings (hot-seat) never names and never scopes below the
      // configured floor — league-wide for TheLeague's 4-team divisions,
      // tier (12-team pool) for the AFL.
      safe.scope =
        topicPolicy.scopeFloor === 'tier' && team?.competition
          ? { kind: 'tier', tier: team.competition }
          : { kind: 'league-wide' };
      return safe;
    }
    if (multiSourceFranchises.has(hint) && topicPolicy.namingPolicy !== 'explicit-pick-only') {
      // Unlock named franchise + "multiple sources" phrasing
      const nameCount30d = await safeGetTeamNameCount30d(hint, redis);
      safe.scope = {
        kind: 'franchise-multi-source',
        franchise: pickTeamName(team) ?? `Team ${hint}`,
        division: team?.division,
        sourceCount: webFranchiseCounts.get(hint),
        nameCount30d,
      };
      safe.formerName = formerNameFor(team, safe.scope.franchise, hint);
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
      safe.formerName = formerNameFor(team, safe.scope.franchise, hint);
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
    // other scope fuzzes to "[a team]" for ALL franchise names. The scrub
    // itself now happens once in redactSafePayload, below.
    return safe;
  };

  return Promise.all(
    tips.map(async (tip) => redactSafePayload(await resolveTipScope(tip), teams)),
  );
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
function pickPrimaryBucket(buckets, { gossipAllowedToday, now = new Date(), tipsterContext = null } = {}) {
  const tradeBuckets = buckets.filter((b) => b.kind === 'trade');
  if (tradeBuckets.length > 0) {
    // Only one bucket key (trade:offer) maps to kind === 'trade' under the
    // new classification, but sort defensively in case that ever changes.
    tradeBuckets.sort((a, b) => bucketPriorityScore(b, now, tipsterContext) - bucketPriorityScore(a, now, tipsterContext));
    return { primary: tradeBuckets[0], secondary: null };
  }

  if (!gossipAllowedToday) return null;

  const gossipBuckets = buckets.filter((b) => b.kind === 'gossip');
  if (gossipBuckets.length === 0) return null;

  gossipBuckets.sort((a, b) => {
    const sa = bucketPriorityScore(a, now, tipsterContext);
    const sb = bucketPriorityScore(b, now, tipsterContext);
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
 *
 * isFridayPt now shared — see scripts/lib/pt-date.mjs.
 */

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

// Per-topic phrasing used by the division/league-wide template branches so
// the fallback isn't a content-free "Northwest is buzzing" line. The tip's
// `topic` field is the only piece of tip content guaranteed safe to surface
// after redaction (raw `text` may carry hostile/off-topic material that the
// LLM lane is supposed to launder via HARD RULE 16). Surfacing the topic
// noun gives the fallback enough specificity to read like a real beat-
// reporter blurb instead of a placeholder.
const TOPIC_NOUNS = {
  trade: 'trade',
  roster: 'roster',
  prediction: 'prediction',
  commish: 'league-office',       // legacy id — old queued tips still carry it
  frontoffice: 'front-office',
  hotseat: 'hot-seat',
  tampering: 'tampering',
  intentions: 'draft-day',
  motive: 'contract-year',
  other: '',
};

// Startup prompt-coverage assertion: every topic id the queue can contain
// must have template-noun handling here (and by extension a prompt lane).
// A new topic added to src/config/schefter-topics.mjs without scanner
// support fails fast instead of silently falling through to '' framing.
for (const topicId of DRAINABLE_TOPIC_IDS) {
  if (!(topicId in TOPIC_NOUNS)) {
    throw new Error(
      `schefter-rumor-scan: topic "${topicId}" from schefter-topics.mjs has no TOPIC_NOUNS entry — add scanner handling before shipping the topic`,
    );
  }
}

function pickTopicNoun(anonymized) {
  // Single dominant topic across the batch wins; mixed topics return ''.
  const topics = [...new Set(anonymized.map((t) => t.topic).filter(Boolean))];
  if (topics.length !== 1) return '';
  return TOPIC_NOUNS[topics[0]] ?? '';
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
  const topicNoun = pickTopicNoun(anonymized);
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
    if (one.scope?.kind === 'tier') {
      const tier = one.scope.tier;
      return pickFlavor(seed, [
        `Hearing one of the ${tier} desks is playing with the season on the line. Nothing confirmed — take it for what it's worth. Developing.`,
        `Real chatter about a ${tier} club this week — the table doesn't lie. We'll see.`,
        `Somebody in the ${tier} pool is feeling the floor move. More to come.`,
      ]);
    }
    if (one.scope?.kind === 'division') {
      const div = one.scope.division;
      const noun = TOPIC_NOUNS[one.topic] ?? '';
      if (noun === 'tampering') {
        // Accusation-shaped: every tampering line hedges, even in fallback.
        return pickFlavor(seed, [
          `Hearing some grumbling about contact before the window opened in the ${div}. Nothing official — eyebrows raised, that's all. Developing.`,
          `Quiet tampering talk out of the ${div} this week. Nothing confirmed, take it for what it's worth. We'll see.`,
        ]);
      }
      if (noun === 'league-office') {
        return pickFlavor(seed, [
          `Hearing an owner in the ${div} has a problem with the league office this week. Developing.`,
          `Quiet flak headed toward the league office from a ${div} desk. More to come.`,
          `Sources in the ${div} aren't thrilled with how the front office is handling things. We'll see.`,
        ]);
      }
      if (noun) {
        return pickFlavor(seed, [
          `Hearing ${noun} chatter out of the ${div} this week — a team in the division is the one to watch. Developing.`,
          `${noun.charAt(0).toUpperCase()}${noun.slice(1)} questions percolating in the ${div} — phones moving on a team in that division. More to come.`,
          `Real ${noun} heat coming from inside the ${div} — one of those desks is driving it. We'll see.`,
          `A ${div} desk is making ${noun} noise this week. Worth watching. Stay tuned.`,
        ]);
      }
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
    if (topicNoun === 'league-office') {
      return pickFlavor(seed, [
        `Hearing the league office is catching some flak this week — owner-side, not strictly on-field. Developing.`,
        `Front office under quiet fire — somebody's airing a grievance with the way things are run. More to come.`,
      ]);
    }
    if (topicNoun) {
      return pickFlavor(seed, [
        `Hearing real ${topicNoun} chatter rippling around the league — owner pushing on it tonight. Developing.`,
        `${topicNoun.charAt(0).toUpperCase()}${topicNoun.slice(1)} smoke from somewhere in the league this week — phones warm. We'll see.`,
        `Plenty of ${topicNoun} whispers right now — the kind that usually means more later. More to come.`,
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
    if (topicNoun === 'league-office') {
      return pickFlavor(`div-${div}-${anonymized.length}-league-office`, [
        `Multiple ${div} owners sending complaints toward the league office this week. Developing.`,
        `Real flak on the front office out of the ${div} — more than one voice. More to come.`,
      ]);
    }
    if (topicNoun) {
      return pickFlavor(`div-${div}-${anonymized.length}-${topicNoun}`, [
        `Multiple ${div} desks aligned on a ${topicNoun} story this week — same tune from different sources. Developing.`,
        `${topicNoun.charAt(0).toUpperCase()}${topicNoun.slice(1)} chatter stacking up in the ${div} — owners pushing the same line. More to come.`,
        `Real ${topicNoun} heat inside the ${div} — multiple owners aligned. We'll see.`,
      ]);
    }
    return pickFlavor(`div-${div}-${anonymized.length}`, [
      `League sources tell me the ${div} is buzzing — multiple owners whispering the same tune. Developing.`,
      `The ${div} is the most active corner of the league this week. Several desks pushing the same story. More to come.`,
      `Real heat inside the ${div} — owners aligned on something and the phones are moving. We'll see.`,
    ]);
  }
  // Single-topic fallback: the batch agrees on one subject even if the
  // LLM can't articulate it. Lead with "multiple sources" — the batch
  // size already earned that phrasing.
  if (topicNoun === 'league-office') {
    return pickFlavor(`multi-${anonymized.length}-league-office`, [
      `Multiple owners pushing back on the league office this week — same complaint, different desks. Developing.`,
      `Hearing real heat aimed at the front office from multiple corners tonight. More to come.`,
    ]);
  }
  if (topicNoun) {
    return pickFlavor(`multi-${anonymized.length}-${topicNoun}`, [
      `Multiple sources around the league pushing the same ${topicNoun} story right now. More as it clears.`,
      `Hearing the same ${topicNoun} chatter from different corners tonight. Worth watching. Developing.`,
      `League-wide ${topicNoun} hum — multiple desks, same energy. We'll see.`,
    ]);
  }
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
function buildTradeOfferPlaybook() {
  const playbook = readPackText('prompts/trade-offer-playbook.md');
  return playbook ? `\n${playbook}\n` : null;
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

/**
 * Should the scanner fire a "saying no, out loud" quiet-day post this cycle?
 *
 * Conditions (ALL must hold):
 *   - The normal bucket pick returned null (nothing qualifies this cycle).
 *   - We're not on Friday's mailbag path (mailbag is its own catch-up lane).
 *   - At least ONE of:
 *       (a) freshTips is empty — the queue genuinely has nothing.
 *       (b) every queued tip with an hashedOwnerId came from a single
 *           prolific tipster (according to tipsterContext) — Schefter has
 *           one chatty voice and nothing else.
 *       (c) every non-trade bucket is stale (recurrence ledger has marked
 *           them as 3-week repeats) — the queue is full of old chatter.
 *
 * Cooldown check (against `lastQuietDayDateStr`) is done by the caller —
 * this helper is pure so it's testable. Returns the reason string for logs.
 */
export function evaluateQuietDayConditions({
  pick,
  mailbagBatch,
  freshTips,
  normalLaneBuckets,
  staleBuckets,
  tipsterContext,
}) {
  if (pick) return { shouldFire: false, reason: 'normal-pick-available' };
  if (mailbagBatch) return { shouldFire: false, reason: 'mailbag-active' };

  const tips = Array.isArray(freshTips) ? freshTips : [];
  if (tips.length === 0) {
    return { shouldFire: true, reason: 'queue-empty', queueSize: 0 };
  }

  // (b) single prolific tipster owns the queue. Count distinct web hashes;
  // if there's exactly one and the context flags them prolific, qualifies.
  const webHashes = new Set();
  for (const tip of tips) {
    if (tip?.source === 'web' && typeof tip.hashedOwnerId === 'string' && tip.hashedOwnerId) {
      webHashes.add(tip.hashedOwnerId);
    }
  }
  if (webHashes.size === 1) {
    const onlyHash = [...webHashes][0];
    const c = tipsterContext?.get?.(onlyHash);
    if (c?.isProlific) {
      return { shouldFire: true, reason: 'single-prolific-tipster', queueSize: tips.length };
    }
  }

  // (c) all non-trade buckets are stale — only mailbag would touch them.
  const haveNormalLane = Array.isArray(normalLaneBuckets) && normalLaneBuckets.length > 0;
  const haveStale = Array.isArray(staleBuckets) && staleBuckets.length > 0;
  if (!haveNormalLane && haveStale) {
    return { shouldFire: true, reason: 'all-stale', queueSize: tips.length };
  }

  return { shouldFire: false, reason: 'no-quiet-day-trigger' };
}

/**
 * Quiet-day body generator. Independent LLM call (separate system prompt
 * from generateAiBody) so it can stay tiny and cache-eligible. Returns the
 * generated post text, or a template fallback if ANTHROPIC_API_KEY is unset.
 *
 * Feature 7 — "saying no, out loud." When the rumor mill is genuinely
 * quiet, Schefter files ONE candid acknowledgment instead of fabricating
 * a story. Fires at most once per QUIET_DAY_COOLDOWN_DAYS so it doesn't
 * become his whole bit.
 *
 * @param {Object} ctx
 * @param {string} ctx.reason  Internal log string ("queue empty",
 *                             "single-prolific-tipster", "all-stale")
 * @param {number} ctx.queueSize
 * @returns {Promise<string>}  The post body.
 */
export async function generateQuietDayBody({ reason = 'queue-quiet', queueSize = 0 } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  // Template fallback — chosen so a dry-run / no-key environment still
  // ships a recognizable Schefter-voice quiet-day line.
  const templates = [
    'Slow news day. League is quiet. Or my tipster line just needs new batteries.',
    'Phones are not ringing. Either the league is at peace or my sources are at the beach.',
    'Nothing crossing the desk worth filing. Bench day for the rumor mill.',
    'Quiet rolodex tonight. The desk is open if anyone has something real.',
  ];
  const fallback = templates[Math.floor(Math.random() * templates.length)];

  if (!apiKey) {
    warn('  [quiet-day] ANTHROPIC_API_KEY not set — using template');
    return fallback;
  }

  // The prompt is voice material and lives in the private beat-reporter repo
  // (scripts/lib/beat-reporter-pack.mjs). Without it, the templates above.
  const system = readPackText('prompts/quiet-day.md');
  if (!system) return fallback;

  const userMessage = `File a quiet-day post. Internal cue (do NOT reference): reason="${reason}", queueSize=${queueSize}. Output JSON only.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        thinking: HAIKU_THINKING,
        max_tokens: 160,
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      warn(`  [quiet-day] anthropic ${res.status}: ${t.slice(0, 200)} — falling back to template`);
      return fallback;
    }
    const data = await res.json();
    const text = responseText(data);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      warn('  [quiet-day] no JSON in response — falling back to template');
      return fallback;
    }
    const parsed = JSON.parse(match[0]);
    if (typeof parsed?.post === 'string' && parsed.post.trim().length > 0) {
      return parsed.post.trim();
    }
    warn('  [quiet-day] empty post in response — falling back to template');
    return fallback;
  } catch (err) {
    warn(`  [quiet-day] generation failed: ${err.message} — falling back to template`);
    return fallback;
  }
}

async function generateAiBody(anonymized, { rogerQuote, lore, recentPostsBlock, mode = 'single', nflContext = null, schefterTargetMode = null, busyMorning = false, busyMorningBacklog = 0, morningGreeting = false } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    warn('  [rumor-scan] ANTHROPIC_API_KEY not set — using template');
    return null;
  }

  const hasTradeOffer = anonymized.some((t) => t.source === 'trade_offer');

  // The rumor mill's system prompt (its voice AND its anonymity rules) lives
  // in the private beat-reporter repo at prompts/rumor-mill.md, with the
  // trade-offer playbook beside it. Without them this FAILS CLOSED to the
  // template path: a post written without the redaction rules could out a
  // tipster, which is far worse than a plainer post.
  const rumorMillPrompt = readPackText('prompts/rumor-mill.md');
  const playbook = hasTradeOffer ? buildTradeOfferPlaybook() : '';
  if (!rumorMillPrompt || playbook === null) {
    warn('  [rumor-scan] private rumor-mill prompt unavailable — using template');
    return null;
  }

  let system = rumorMillPrompt;

  if (playbook) {
    system += '\n\n' + playbook;
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

  // Busy-morning ack — fires only on trade-offer beats during the first
  // morning catch-up cycle when a backlog of 2+ trade tips accumulated
  // overnight. The directive nudges Schefter into investigative-reporter
  // tone: a one-line nod to overnight volume, then the actual offer. The
  // tone reference matters — proposed trades are the prestige-content
  // lane, NOT breathless-headline-shouting lane.
  let busyMorningDirective = '';
  if (busyMorning && busyMorningBacklog >= 2) {
    busyMorningDirective = `\n\nBUSY_MORNING_CONTEXT: ${busyMorningBacklog} trade proposals crossed the desk overnight; this is one of two trade reports being filed this morning. Open with a brief, in-voice acknowledgment of the overnight volume — beat-reporter cadence ("phone's been ringing since 7", "plenty crossing the desk this morning", "league sources kept the desk up overnight", "stack of message slips waiting", "busy morning around the league"). Vary the phrasing across posts; never stack two posts with the same opener. The acknowledgment is a tone marker on the lede, NOT the whole post — file the actual offer in the same 1–2 sentences. Investigative-reporter energy on proposed-trade rumors: phone calls, anonymous sources, message slips. NOT breathless headline shouting.`;
  }

  // Morning greeting — once-per-day cold-open from the classic-news /
  // SportsCenter playbook when the first post of the morning lands in
  // the 07:00–10:59 PT window. The directive lists rotating phrasings so
  // each morning sounds different. Stacks naturally with BUSY_MORNING_CONTEXT:
  // if both fire, the LLM is instructed to merge them into ONE opener
  // (e.g. "Morning, league. Phone's been ringing since 7.") instead of
  // double-stacking two separate ledes.
  let morningGreetingDirective = '';
  if (morningGreeting) {
    morningGreetingDirective = `\n\nMORNING_GREETING_CONTEXT: this is the first Schefter post of the day (PT). Cold-open with a brief, in-voice "good morning" line in the classic-news / sports-columnist tradition. Pick ONE pattern from the playbook (rotate across days; never reuse the same opener two days in a row):

Beat-reporter / column openers:
  - "Morning, league."
  - "Top of the morning."
  - "Pour yourself a cup."
  - "First cup says it all."
  - "Coffee's hot, so's the chatter."
  - "Wake up to this."
  - "Morning brief, league."

Bryant Gumbel / Today Show:
  - "Up and at 'em."
  - "Bright and early."

SportsCenter / SVP:
  - "Welcome to your morning."
  - "Set your coffee down."

Adam Schefter signature (his real voice — sourcing tic + morning context):
  - "Just got off the phone, league."
  - "Sources up early."
  - "Per my sources, morning brief."
  - "I'm told the league's already moving."
  - "League sources checking in."
  - "BREAKING: morning brief."

Howard Cosell echo (USE ONLY when the post names a single specific franchise — i.e. "franchise-multi-source" or "franchise-explicit-pick" or "trade-bait" scope):
  - "Good morning to everyone except the [Franchise]."

The greeting is a SHORT (2–6 words) cold-open BEFORE the actual post body — a tone marker, not the whole post. Keep total length 1–2 sentences. If BUSY_MORNING_CONTEXT also fires, MERGE the two — one combined opener (e.g. "Morning, league. Phone's been ringing since 7.") — never two separate ledes. NEVER use the Cosell pattern with anonymous / division / league-wide / commish scope (it requires naming a franchise; doing so on an anonymous-scope post leaks identity).`;
  }

  // Corroboration upgrade — when an MFL pending offer is being whispered
  // about independently (a tip in the queue carries
  // corroboratingSourceCount >= 1), elevate the voice to direct-knowledge
  // framing. This is the highest-credibility lane in the rumor mill: the
  // story is BOTH a real pending offer AND independently named by tipsters.
  // Schefter graduates from "I'm hearing chatter" to "multiple sources with
  // direct knowledge spoke on the condition of anonymity."
  const maxCorroboration = anonymized.reduce((max, t) => {
    const n = typeof t?.corroboratingSourceCount === 'number' ? t.corroboratingSourceCount : 0;
    return n > max ? n : max;
  }, 0);
  let corroborationDirective = '';
  if (maxCorroboration >= 1) {
    const sourceWord = maxCorroboration === 1 ? 'source' : 'sources';
    corroborationDirective = `\n\nCORROBORATION_CONTEXT: ${maxCorroboration} independent ${sourceWord} ${maxCorroboration === 1 ? 'is' : 'are'} pointing at this same trade — a real pending offer on the books AND tipsters whispering about it. Upgrade voice to direct-knowledge framing. Use one of these patterns (rotate, vary across posts, never stack two identical openers in a row): "I'm told by multiple sources with direct knowledge", "a high-level source spoke on the condition of anonymity", "two independent sources confirm", "league sources with direct knowledge tell me", "multiple corners of the league are pointing at the same deal", "sources close to the negotiations". Drop the hedge words ("hearing chatter", "buzzing", "developing") — this is more solid intel than a typical rumor. Still respect every anonymity rule (no franchise names unless the existing scope rules already permit it; no player names unless escalation tier already permits). Direct-knowledge framing is about CREDIBILITY of the source, not LIBERTY to name names. Stack on top of any other directives (busy-morning, framing flips, etc.).`;
  }

  // Trading closed: every post, whatever its lane, stays in the past tense on
  // trades. A system-prompt rule rather than a user directive so it outranks
  // the trade-offer playbook's "shopping / fielding calls" vocabulary.
  const closedBlock = tradingClosedPromptBlock(TRADING_STATE);
  if (closedBlock) system = `${closedBlock}\n\n${system}`;

  const jsonContract = `Output JSON ONLY: {"post": "<the post text as a single string>"}. No markdown, no headlines, no meta-commentary in the "post" field. If the IRON RULES require dropping this batch, output {"post": null} — never write reasoning, filtering decisions, or explanations into the "post" field.`;

  let userMessage;
  if (mode === 'mailbag') {
    userMessage = `MAILBAG: Friday news-dump. Apply HARD RULE 20 — bullet each topic in the GOSSIP_TIPS array as a one-liner (≤6 bullets). Open with a mailbag framing and sign off at the end. ${jsonContract} (Newlines inside the post string are fine for bullets.)${rogerDirective}${schefterModeDirective}${morningGreetingDirective}${busyMorningDirective}${corroborationDirective}${recentBlock}\n\nGOSSIP_TIPS:\n${JSON.stringify(anonymized, null, 2)}`;
  } else {
    userMessage = `Synthesize these tips into ONE rumor-mill post (1–2 sentences, one topic). ${jsonContract}${rogerDirective}${schefterModeDirective}${morningGreetingDirective}${busyMorningDirective}${corroborationDirective}${recentBlock}\n\nTIPS:\n${JSON.stringify(anonymized, null, 2)}`;
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
        model: HAIKU_MODEL,
        thinking: HAIKU_THINKING,
        max_tokens: mode === 'mailbag' ? 800 : 340,
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    if (!res.ok) {
      warn(`  [rumor-scan AI] ${res.status} — using template`);
      return null;
    }
    const data = await res.json();
    const text = responseText(data).trim();
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
 * One MFL export for this league, fetched live, or null on ANY failure — an
 * HTTP error, the HTML login page, or MFL's HTTP-200 error body. Null means
 * "use the committed file", never "nothing there".
 *
 * The roster sync now holds the current year's rosters.json and
 * transactions.json out of its commit and lets them through once a day
 * (scripts/lib/held-sync-files.mjs), so the copy in this job's checkout can be
 * a day old. The two readers below ask MFL first for that reason.
 */
async function fetchLiveLeagueExport(year, type, extra = '') {
  const url = `https://${MFL_HOST}/${year}/export?TYPE=${type}&L=${LEAGUE_ID}${extra}&JSON=1`;
  try {
    // mflFetch for the same cross-origin-redirect reason as the pendingTrades read.
    const res = await mflFetch({
      url,
      cookies: { MFL_USER_ID: process.env.MFL_USER_ID },
      userAgent: 'schefter-rumor-scan/1.0',
      timeoutMs: 15_000,
    });
    if (!res.ok) throw new Error(`MFL HTTP ${res.status}`);
    const text = await res.text();
    if (text.trim().startsWith('<')) throw new Error('MFL returned HTML');
    const data = JSON.parse(text);
    if (data?.error) throw new Error(`MFL error body: ${data.error?.$t ?? data.error}`);
    return data;
  } catch (err) {
    warn(`  [offer-scan] live ${type} unavailable: ${err.message} — reading the committed file`);
    return null;
  }
}

/**
 * Who currently rosters each player — live from MFL, else the league's own
 * committed rosters feed (up to a day old; see fetchLiveLeagueExport).
 *
 * This is the ground truth under every ownership claim the trade-offer lane
 * makes. A PENDING proposal has not executed, so a player being given up in it
 * is still on the roster of the franchise giving him up — which turns "does
 * this team own this player" from a thing we infer off MFL's field names into
 * a thing we look up. `attributeSides` uses it to validate (and, on a garbled
 * row, to repair) the side/franchise binding, and `buildExposure` uses it as
 * the per-player floor under the name it prints.
 *
 * Read through the registry's `feedFilePath`, never a joined league directory
 * — `tests/league-literal-guard.test.ts` forbids the literal and the registry
 * is the only thing that knows where a league's feeds live.
 *
 * A live answer with no franchises is no answer. A missing or unreadable file
 * returns an EMPTY map, which the redactor treats as "no evidence" and falls
 * back to taking the row at its word. That is the pre-2026-09-10 behaviour: a
 * stale feed degrades the check, it does not silence the lane.
 */
function rosterOwnersFrom(raw) {
  const map = new Map();
  const list = raw?.rosters?.franchise ?? [];
  for (const franchise of Array.isArray(list) ? list : [list]) {
    // Validate BEFORE padding. `''.padStart(4, '0')` is `'0000'` — truthy,
    // and a real franchise id — so the emptiness check below never fired and
    // a malformed row's players were attributed to a franchise that does not
    // exist. That is not inert: `attributeSides` scores orientations off this
    // map, so a phantom `0000` owner is false evidence in the one check the
    // whole binding now rests on.
    const rawFid = String(franchise?.id ?? '').trim();
    if (!rawFid) continue;
    const fid = rawFid.padStart(4, '0');
    const players = franchise?.player ?? [];
    for (const player of Array.isArray(players) ? players : [players]) {
      if (player?.id) map.set(String(player.id), fid);
    }
  }
  return map;
}

async function loadRosterOwners(year) {
  const live = rosterOwnersFrom(await fetchLiveLeagueExport(year, 'rosters'));
  if (live.size > 0) return live;
  try {
    return rosterOwnersFrom(JSON.parse(await fs.readFile(SCHEFTER_LEAGUE.feedFilePath(year, 'rosters.json'), 'utf8')));
  } catch (err) {
    warn(`  [offer-scan] rosters file unreadable: ${err.message} — ownership checks degraded`);
    return new Map();
  }
}

/**
 * Load the league's ADP dynasty rank map. Used by the trade-offer redactor
 * to pick the marquee (highest-value) player for the graduated exposure
 * ladder — at signal=2+ we name players in best-first order, and ADP
 * dynasty rank is the cleanest proxy we have. Missing file = empty map;
 * the redactor falls back to alphabetical-by-playerId, which keeps the
 * ladder deterministic even without ADP data.
 */
async function loadAdpDynastyRanks(year) {
  // Through the registry's resolver, never a hand-joined league directory —
  // the league-literal guard forbids the literal and the registry is the only
  // thing that knows where a league's feeds live.
  const adpPath = SCHEFTER_LEAGUE.feedFilePath(year, 'adp-dynasty.json');
  try {
    const raw = JSON.parse(await fs.readFile(adpPath, 'utf8'));
    const list = raw?.adp?.player ?? [];
    const arr = Array.isArray(list) ? list : [list];
    const map = new Map();
    for (const p of arr) {
      const id = String(p?.id ?? '');
      const rank = Number(p?.rank);
      if (id && Number.isFinite(rank) && rank > 0) map.set(id, rank);
    }
    return map;
  } catch (err) {
    warn(`  [offer-scan] adp-dynasty file unreadable: ${err.message}`);
    return new Map();
  }
}

/**
 * Signatures of trades that actually happened: the committed transactions
 * feed UNIONED with MFL's live list of this season's trades. The file alone is
 * up to a day old (see fetchLiveLeagueExport), and a trade it has not caught
 * up with yet reads as a proposal still open — re-posted as a rumor after it
 * was accepted. Either source alone still works.
 *
 * Deliberately the SAME signature `schefter-scan.mjs#buildTradeSignature`
 * builds — sorted franchise pair + sorted asset ids — so a proposal and the
 * TRADE it became hash identically whichever side MFL happens to call
 * "franchise1". Rebuilt rather than imported because that module is a scan
 * entry point with its own MFL fetches at import time.
 */
function tradeSignaturesFrom(raw, signatures) {
  const list = raw?.transactions?.transaction ?? [];
  for (const txn of Array.isArray(list) ? list : [list]) {
    if (txn?.type !== 'TRADE') continue;
    const signature = tradeSignatureOf(txn);
    if (signature) signatures.add(signature);
  }
  return signatures;
}

/**
 * Also fills `lastTradedAt` (playerId → epoch ms of his latest completed
 * trade) when a map is passed — the dead-offer check below reads it, and it
 * comes off the same two reads, so it costs no extra MFL call.
 */
async function loadCompletedTradeSignatures(year, lastTradedAt = null) {
  const signatures = new Set();
  const live = await fetchLiveLeagueExport(year, 'transactions', '&TRANS_TYPE=TRADE');
  if (live) tradeSignaturesFrom(live, signatures);
  const mergeMoves = (raw) => {
    if (!lastTradedAt) return;
    for (const [id, ms] of lastTradedAtByPlayer(raw)) {
      if (!lastTradedAt.has(id) || lastTradedAt.get(id) < ms) lastTradedAt.set(id, ms);
    }
  };
  if (live) mergeMoves(live);
  const txnPath = SCHEFTER_LEAGUE.feedFilePath(year, 'transactions.json');
  try {
    const committed = JSON.parse(await fs.readFile(txnPath, 'utf8'));
    tradeSignaturesFrom(committed, signatures);
    mergeMoves(committed);
  } catch (err) {
    warn(
      `  [offer-scan] transactions feed unreadable: ${err.message}` +
        (live ? ' — live trades only' : ' — accepted-closure detection off'),
    );
  }
  return signatures;
}

/**
 * How many EARLIER proposals each franchise pair has in our archive, within the
 * re-offer window. A floor, not a total — the archive holds the proposals this
 * lane saw, and the lane sees what owners self-reported.
 */
async function loadPriorPairCounts({ redis, nowMs }) {
  const counts = new Map();
  let archive;
  try {
    archive = await redis.hgetall(OFFER_ARCHIVE_KEY);
  } catch (err) {
    warn(`  [offer-scan] hgetall(archive) failed: ${err.message} — re-offer beats disabled`);
    return counts;
  }
  const windowStart = nowMs - RE_OFFER_WINDOW_MS;
  for (const entry of Object.values(archive ?? {})) {
    try {
      const parsed = typeof entry === 'string' ? JSON.parse(entry) : entry;
      if (!parsed) continue;
      const firstSeen = Number(parsed.firstSeenMs);
      if (!Number.isFinite(firstSeen) || firstSeen < windowStart) continue;
      const pair = [String(parsed.offeringFid || ''), String(parsed.partnerFid || '')]
        .filter(Boolean)
        .sort()
        .join(':');
      if (!pair) continue;
      counts.set(pair, (counts.get(pair) ?? 0) + 1);
    } catch {
      // A malformed archive row is not worth failing a scan over.
    }
  }
  return counts;
}

/**
 * Upstash auto-deserializes JSON values, so a stored shape arrives as an object
 * on one client and a string on another. Both are accepted; anything else is
 * treated as "no previous shape", which drops the beat rather than inventing a
 * change.
 */
function parseStoredShape(stored) {
  if (!stored) return null;
  try {
    const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
    return parsed && typeof parsed.h === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** Pair key for `priorPairCounts`, built from a live proposal row. */
function franchisePairKeyOf(raw, offeringFid) {
  const partner = String(raw?.offeredto || raw?.franchise2 || '').padStart(4, '0');
  return [String(offeringFid || ''), partner].filter(Boolean).sort().join(':');
}

/**
 * Call MFL pendingTrades for a specific franchise id. Returns the array
 * of raw trade rows (both sent-by and received-by that franchise).
 */
async function fetchPendingTradesForFranchise(leagueId, year, franchiseId, mflCookie) {
  const url = `https://${MFL_HOST}/${year}/export?TYPE=pendingTrades&L=${leagueId}&FRANCHISE_ID=${franchiseId}&JSON=1`;
  // mflFetch, NOT a bare fetch: MFL_HOST defaults to api.myfantasyleague.com,
  // which 302s to the league's www## host, and Node's undici DROPS the Cookie
  // header on that cross-origin hop. This read arrived anonymous and MFL
  // answered with the HTML login page — caught by the "returned HTML" guard
  // below, so the whole trade-offer rumor scan failed quietly rather than
  // loudly. See tests/mfl-cookie-redirect-guard.test.ts.
  const res = await mflFetch({
    url,
    cookies: { MFL_USER_ID: mflCookie },
    userAgent: 'schefter-rumor-scan/1.0',
    timeoutMs: 15_000,
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
      // A per-conference player pool (the AFL): the same player id is a
      // different asset in each conference. Absent for single-pool leagues.
      conference: t.conference,
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
/**
 * Every open proposal this lane can see: MFL's league-wide pendingTrades read
 * (per franchise, minus the commish-approval queue that Phase 1 owns), merged
 * with owners' self-reported offers. Shared by the offer scan and the
 * deadline wrap-up, which must count the same set of deals.
 */
async function collectPendingOffers({ redis, teams, year, mflCookie }) {
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


  return { offerMap, commishPending };
}

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
  const adpRankByPlayerId = await loadAdpDynastyRanks(year);
  // NOT `year`. The heuristic above advances on Feb 1 while TheLeague's MFL
  // rollover is Feb 14 PT, so for those 13 days it names a league year MFL has
  // not created — the rosters file is absent, the map comes back empty, and the
  // ownership check silently degrades to trusting the row's own sides, which is
  // the exact failure this whole branch exists to stop. `leagueYearFor` is the
  // registry-aware clock and already carries each league's own rollover.
  const rosterYear = leagueYearFor(SCHEFTER_LEAGUE, now);
  const rosterOwnerByPlayerId = await loadRosterOwners(rosterYear);
  log(`  [offer-scan] Roster ownership loaded for ${rosterOwnerByPlayerId.size} player(s)`);

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

  const { offerMap, commishPending } = await collectPendingOffers({ redis, teams, year, mflCookie });
  log(`  [offer-scan] Distinct counter-party-awaiting offers: ${offerMap.size}`);

  // ── Movement state ──
  // One read each, before the loop: per-scan hgets inside a 6-offer loop would
  // triple this lane's Redis round-trips for data that never changes mid-scan.
  let shapeByOfferId = {};
  let closedOfferIds = new Set();
  try {
    shapeByOfferId = (await redis.hgetall(OFFER_SHAPE_KEY)) ?? {};
  } catch (err) {
    warn(`  [offer-scan] hgetall(shape) failed: ${err.message} — ask-changed beats disabled`);
  }
  try {
    closedOfferIds = new Set((await redis.smembers(OFFER_CLOSED_KEY)) ?? []);
  } catch (err) {
    warn(`  [offer-scan] smembers(closed) failed: ${err.message}`);
  }

  // Completed trades, by the same signature schefter-scan.mjs uses to let a
  // finished TRADE supersede a pending-trade post: sorted franchise pair +
  // sorted assets, so a proposal and the transaction it became hash alike
  // whichever side MFL calls "franchise1".
  const lastTradedAt = new Map();
  const completedTradeSignatures = await loadCompletedTradeSignatures(year, lastTradedAt);

  // Earlier proposals between the same franchise pair, from our own archive.
  const priorPairCounts = await loadPriorPairCounts({ redis, nowMs });

  // ── Beat inputs (see scripts/lib/schefter-offer-beats.mjs) ──
  // The league's PUBLIC trade block, per franchise. `tradeBaitState` is written
  // by the trade-bait lane's own LIVE MFL read and lives in the same feed file
  // this scanner already loads, so it is fresher than the committed
  // mfl-feeds/<year>/tradeBait.json snapshot (refreshed once a day) and costs
  // no extra fetch. `observedBlock` is what MFL shows right now;
  // `committedBlock` is what Schefter has already reported, which is a
  // different question.
  //
  // A franchise with no entry is ABSENT from the Map rather than present with
  // an empty Set: only the first means "we cannot say what is on their block",
  // and a beat that cannot tell those apart would report a player as unlisted
  // on the strength of never having read his owner's block.
  const blockByFid = new Map();
  try {
    const feedForBlocks = await loadFeed();
    for (const [fid, state] of Object.entries(feedForBlocks?.tradeBaitState ?? {})) {
      const observed = state?.observedBlock;
      if (!Array.isArray(observed)) continue;
      blockByFid.set(String(fid).padStart(4, '0'), new Set(observed.map((id) => String(id))));
    }
  } catch (err) {
    warn(`  [offer-scan] trade-block state unreadable: ${err.message} — block beats disabled`);
  }

  // Positions in play across every proposal this scan can see. A FLOOR, not a
  // total: with the league-wide read quiet, the lane only sees proposals owners
  // self-reported, so the beat carries `atLeast` and the playbook hedges it.
  //
  // "In play" means ALIVE. The same dead-proposal problem the expiry check
  // fixes below applies here a level up: `owner_reports` keeps resolved
  // proposals indefinitely, so counting the raw map would report a run on a
  // position off deals MFL dropped weeks ago — a hedge of "at least" does not
  // make a stale count true.
  // Dead offers out, before anything counts them. A proposal whose player has
  // since changed hands cannot execute, but owner self-reports keep it in view
  // indefinitely — which is how a Saturday post (2026-11-14) put "The Dream at
  // the center of the McCaffrey chatter" four days after McCaffrey was traded.
  // Dropped here, ahead of positionRuns and the tip loop, so a dead proposal
  // is neither a story nor a count. A proposal that was itself ACCEPTED is
  // left alone here, so the signature check below still files its closure.
  for (const [offerId, { raw }] of [...offerMap]) {
    const sig = tradeSignatureOf(raw);
    if (sig && completedTradeSignatures.has(sig)) continue;
    const dead = deadOfferReason(raw, { rosterOwnerByPlayerId, lastTradedAt });
    if (!dead) continue;
    offerMap.delete(offerId);
    log(`  [offer-scan] offerId=${offerId} dropped — ${dead}`);
  }

  const positionRuns = new Map();
  for (const [, { raw }] of offerMap) {
    const expiresAt = parseInt(raw.expires ?? '0', 10);
    if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt * 1000 <= nowMs) continue;
    const sig = tradeSignatureOf(raw);
    if (sig && completedTradeSignatures.has(sig)) continue;
    const seen = new Set();
    for (const token of [
      ...(raw.franchise1_gave_up || '').split(','),
      ...(raw.franchise2_gave_up || '').split(','),
    ]) {
      const asset = classifyAsset(token.trim(), players, year);
      if (asset?.kind !== 'player' || !asset.position) continue;
      seen.add(String(asset.position).toUpperCase());
    }
    for (const position of seen) {
      positionRuns.set(position, (positionRuns.get(position) ?? 0) + 1);
    }
  }
  log(
    `  [offer-scan] Beat inputs: blocks for ${blockByFid.size} franchise(s), `
      + `positions in play ${[...positionRuns.entries()].map(([p, n]) => `${p}:${n}`).join(' ') || 'none'}`,
  );

  const tips = [];
  const debugLog = [];
  const windowStart = nowMs - OFFER_ROLLING_WINDOW_MS;
  const playerWindowStart = nowMs - PLAYER_HISTORY_WINDOW_MS;

  for (const [offerId, { raw, offeringFid }] of offerMap) {
    // Read current exposure count — how many prior posts have shipped about
    // this offer under the graduated-disclosure model. The post we're about
    // to consider is at signal=N+1. Still no absorbing state, but a recurrence
    // now has to clear the 7-day repost cooldown below AND win a fresh daily
    // roll, so in practice an offer is reported once and signal 2 is reserved
    // for a proposal genuinely still sitting there a week later.
    //
    // The exposure HASH is the SINGLE source of truth. We deliberately do
    // NOT seed it from the pre-2026-05 `posted` / `seen` sets — those entries
    // are all stale (closed trades from the old one-shot model), so any
    // still-live offer starts fresh at signal=1 (team only).
    let priorExposure = 0;
    try {
      const exposureRaw = await redis.hget(OFFER_EXPOSURE_KEY, offerId);
      const n = parseInt(exposureRaw, 10);
      if (Number.isFinite(n) && n > 0) priorExposure = n;
    } catch (err) {
      warn(`  [offer-scan] hget(exposure) failed for ${offerId}: ${err.message}`);
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

      // Permanent archive — one entry per offer ever seen. No TTL: this is
      // the running history feed for the admin "Trade Offers Archive" card.
      // We only write on first sighting so a returning offer keeps its
      // original metadata (raw can shift if MFL re-orders fields).
      try {
        const partnerFid = String(raw.offeredto || raw.franchise2 || '').padStart(4, '0');
        const archiveEntry = JSON.stringify({
          offerId,
          offeringFid,
          partnerFid,
          willGiveUp: raw.will_give_up || raw.franchise1_gave_up || '',
          willReceive: raw.will_receive || raw.franchise2_gave_up || '',
          comments: raw.comments || '',
          mflTimestamp: Number(raw.timestamp || 0) || null,
          firstSeenMs: nowMs,
        });
        await redis.hset(OFFER_ARCHIVE_KEY, { [offerId]: archiveEntry });
      } catch (err) {
        warn(`  [offer-scan] hset(archive) failed: ${err.message}`);
      }
    }

    // ── Is this proposal over? ──
    // Two endings, both stated by MFL rather than inferred by us, and they are
    // routed DIFFERENTLY:
    //   accepted — a TRADE transaction with this proposal's signature exists.
    //              Gets a closure post; the trade is public anyway.
    //   expired  — the row's own `expires` has passed; MFL drops it at expiry.
    //              Seeds the speculation lane instead of posting (see below).
    // There is deliberately no "withdrawn". This lane is fed by owner
    // self-reports, so a proposal leaving view means an owner stopped loading
    // the trades page just as often as it means the proposal died — and the
    // owner-report hash has no per-row TTL, so a resolved proposal LINGERS in
    // it either way. Guessing would put "talks have gone cold" on a live
    // negotiation.
    //
    // The expiry check also fixes a quieter bug: without it a proposal MFL
    // dropped weeks ago keeps drawing dice rolls and shipping fresh rumors off
    // a stale owner report, which is where the 26-to-56-day-old "live"
    // proposals in this lane came from.
    const expiresSecs = parseInt(raw.expires ?? '0', 10);
    const hasExpired = Number.isFinite(expiresSecs) && expiresSecs > 0
      && expiresSecs * 1000 <= nowMs;
    const signature = tradeSignatureOf(raw);
    const wasAccepted = !!signature && completedTradeSignatures.has(signature);

    if (hasExpired || wasAccepted) {
      const reason = wasAccepted ? 'accepted' : 'expired';
      if (closedOfferIds.has(offerId)) {
        debugLog.push({ offerId, offeringFid, skipped: `already closed (${reason})` });
        continue;
      }

      // ── An expiry is a SEED, not a post ──
      // A proposal that ran out the clock is the strongest private evidence we
      // have that a GM is willing to move the players they offered, and that
      // they need what they asked for. That belongs to the speculation lane,
      // which builds its own hypothetical pairings and publishes those — not
      // to a Schefter post announcing that a specific real deal died.
      //
      // Only the proposer's half seeds anything: their offered players are an
      // availability signal and the positions they asked for are a stated
      // need. The franchise they asked never said a word, so it contributes
      // nothing and is recorded solely to be EXCLUDED as a counterparty, which
      // keeps speculation from wandering back onto the real pairing.
      //
      // `accepted` still gets its closure post: that trade is public the
      // moment it processes, so closing the story reveals nothing.
      if (hasExpired && !wasAccepted) {
        const seed = buildSeedFromProposal({
          rawOffer: raw,
          offeringFid,
          playerMap: players,
          expiredAtMs: expiresSecs * 1000,
        });
        let seeded = true;
        if (!dryRun && seed) {
          seeded = await writeSeed({ redis, navSlug: NAV_SLUG, seed, log, warn });
        } else if (seed) {
          log(`  [seed] dry-run: would seed speculation from expired proposal ${offerId}`);
        }
        // Close it only once the seed is safely stored. Marking it closed on a
        // failed write would drop the signal permanently — the next scan
        // short-circuits on the closed set and never looks at this proposal
        // again — for the sake of one retry we can simply take next cycle.
        if (!dryRun && seeded) {
          try {
            await redis.sadd(OFFER_CLOSED_KEY, offerId);
            await redis.expire(OFFER_CLOSED_KEY, OFFER_STATE_TTL_SEC);
            await redis.hdel(OFFER_SHAPE_KEY, offerId);
          } catch (err) {
            warn(`  [offer-scan] closing expired ${offerId} failed: ${err.message}`);
          }
        } else if (!dryRun) {
          warn(`  [offer-scan] seed write failed for ${offerId} — leaving it open to retry next scan`);
        }
        debugLog.push({ offerId, offeringFid, expired: true, seeded: !!seed, priorExposure });
        continue;
      }
      // Nothing was ever reported about this proposal, so there is no story to
      // close — a closure post would be the lane's FIRST word on a proposal
      // that never passed a dice roll, which is the one thing the roll exists
      // to prevent.
      if (priorExposure < 1) {
        if (!dryRun) {
          try {
            await redis.sadd(OFFER_CLOSED_KEY, offerId);
            await redis.expire(OFFER_CLOSED_KEY, OFFER_STATE_TTL_SEC);
          } catch (err) {
            warn(`  [offer-scan] sadd(closed) failed: ${err.message}`);
          }
        }
        debugLog.push({ offerId, offeringFid, skipped: `${reason}, never reported` });
        continue;
      }

      const closureRedaction = redactTradeOffer({
        rawOffer: raw,
        offeringFid,
        playerMap: players,
        teamMap: teams,
        counts: { ownerOfferCount7d: 1, divisionOfferCount7d: 0, playerHistory: new Map() },
        currentYear: year,
        framingHint,
        offerAgeMs,
        // Held, not advanced — see the `closure` branch in redactTradeOffer.
        exposureCount: priorExposure,
        adpRankByPlayerId,
        rosterOwnerByPlayerId,
        blockByFid,
        positionRuns,
        closure: {
          reason,
          daysOpen: offerAgeMs / (24 * 60 * 60 * 1000),
          priorPosts: priorExposure,
        },
        nowMs,
      });

      if (closureRedaction.skip) {
        debugLog.push({ offerId, offeringFid, skipped: `closure: ${closureRedaction.reason}` });
        continue;
      }

      log(
        `  [offer-scan] offerId=${offerId} fid=${offeringFid} CLOSED (${reason}) `
          + `after ${Math.round(offerAgeMs / (24 * 60 * 60 * 1000))}d and ${priorExposure} post(s) → filing closure`,
      );
      debugLog.push({
        offerId,
        offeringFid,
        closure: reason,
        priorExposure,
        tipPreview: closureRedaction.tip,
      });

      // No dice roll: the closure is terminal, fires once, and reveals nothing
      // the ladder had not already revealed. The queue's own gates (daily cap,
      // spacing, quiet hours) still decide when it actually ships.
      //
      // The closed marker below is written before the tip has actually
      // shipped, so a closure the queue later drops is lost rather than
      // retried. That is the deliberate side to fail on: the alternative —
      // marking it closed only on publication — reposts the same callback on
      // every scan until one lands. This only applies to `accepted`, which is
      // roughly a once-a-season event in this league.
      if (detectionOnly && !enabled) {
        log(`  [offer-scan] detection-only: would have queued closure ${closureRedaction.tip.id}`);
        continue;
      }
      if (!dryRun) {
        try {
          await redis.sadd(OFFER_CLOSED_KEY, offerId);
          await redis.expire(OFFER_CLOSED_KEY, OFFER_STATE_TTL_SEC);
        } catch (err) {
          warn(`  [offer-scan] sadd(closed) failed: ${err.message}`);
        }
        try {
          await redis.hdel(OFFER_SHAPE_KEY, offerId);
        } catch {
          // Best effort — a stale shape row expires with the hash.
        }
      }
      tips.push(closureRedaction.tip);
      continue;
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
      const pKey = playerOfferHistoryKey(pid, teams.get(offeringFid)?.conference);
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
      exposureCount: priorExposure,
      adpRankByPlayerId,
      rosterOwnerByPlayerId,
      blockByFid,
      positionRuns,
      previousShape: parseStoredShape(shapeByOfferId[offerId]),
      priorPairCount: Math.max(
        0,
        (priorPairCounts.get(franchisePairKeyOf(raw, offeringFid)) ?? 0) - 1,
      ),
      nowMs,
    });

    if (redaction.skip) {
      debugLog.push({ offerId, offeringFid, skipped: redaction.reason });
      continue;
    }

    // Dice roll — base probability is OFFER_POST_PROBABILITY (see
    // `scripts/lib/redact-trade-offer.mjs`), scaled exponentially by the most-
    // shopped player's effective distinct-offerer count (real + 0.4*draft) and
    // clamped to OFFER_PROBABILITY_CEILING. It is a PER-DAY figure, which is
    // true only because of Gate B below.
    //
    // The roll stays unpredictable on purpose: an owner cannot tell whether
    // their own submission, or any particular other-team draft, is what tipped
    // Schefter. Two gates run first.
    //
    // Gate A — repost cooldown. An offer the mill has already reported goes
    // quiet for OFFER_REPOST_COOLDOWN_MS. Checked BEFORE the roll so a
    // cooling-down offer does not even consume its daily roll, which keeps the
    // roll counter meaning "chances this offer had to leak".
    let lastPostMs = 0;
    try {
      const raw = await redis.hget(OFFER_LAST_POST_KEY, offerId);
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) lastPostMs = n;
    } catch (err) {
      warn(`  [offer-scan] hget(last_post) failed for ${offerId}: ${err.message}`);
    }
    if (lastPostMs && nowMs - lastPostMs < OFFER_REPOST_COOLDOWN_MS) {
      const hoursLeft = (OFFER_REPOST_COOLDOWN_MS - (nowMs - lastPostMs)) / 3600000;
      log(
        `  [offer-scan] offerId=${offerId} held — already reported ` +
          `${((nowMs - lastPostMs) / 3600000).toFixed(1)}h ago, ` +
          `${hoursLeft.toFixed(1)}h of cooldown left`,
      );
      debugLog.push({ offerId, offeringFid, skipped: 'repost-cooldown', lastPostMs });
      continue;
    }

    // Gate B — one roll per offer per Pacific day. Without this the 15-minute
    // cron compounds the base probability ~50× a day and every offer leaks
    // within hours. Dry runs do not stamp the date, so a dry run never spends
    // the real scanner's roll for the day.
    const todayPtForRoll = getPtDateString(now);
    let lastRollDate = null;
    try {
      lastRollDate = await redis.hget(OFFER_LAST_ROLL_DATE_KEY, offerId);
    } catch (err) {
      warn(`  [offer-scan] hget(last_roll_date) failed for ${offerId}: ${err.message}`);
    }
    if (lastRollDate === todayPtForRoll) {
      debugLog.push({ offerId, offeringFid, skipped: 'already-rolled-today' });
      continue;
    }
    if (!dryRun) {
      try {
        await redis.hset(OFFER_LAST_ROLL_DATE_KEY, { [offerId]: todayPtForRoll });
        await redis.expire(OFFER_LAST_ROLL_DATE_KEY, OFFER_STATE_TTL_SEC);
      } catch (err) {
        warn(`  [offer-scan] hset(last_roll_date) failed for ${offerId}: ${err.message}`);
      }
    }

    // `priorExposure` no longer scales the odds — see the "NO EXPOSURE
    // SCALING" note in redact-trade-offer.mjs. It still decides how much
    // detail a re-surfacing offer may reveal, which is why it is read above.
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
      priorExposure,
      nextSignal: priorExposure + 1,
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
        `priorExp=${priorExposure} nextSignal=${priorExposure + 1} ` +
        `p=${probability.toFixed(4)} roll=${roll.toFixed(3)} → ${passed ? 'PASS' : 'fail'}` +
        (redaction.tip.escalatedPlayer
          ? ` [escalation=${redaction.tip.escalatedPlayer.tier}/${redaction.tip.escalatedPlayer.distinctOfferers}]`
          : '') +
        (redaction.tip.exposure
          ? ` [exposure team=${redaction.tip.exposure.team.name} players=${redaction.tip.exposure.players.length}]`
          : ''),
    );

    // Roll counter — increment regardless of pass/fail so the admin can see
    // how many chances each offer had to leak before MFL dropped it.
    // Detection-only runs still count: the dice was rolled, the chance was
    // real, even if we suppressed the post. Dry-run does NOT increment —
    // it didn't actually mutate anything.
    if (!dryRun) {
      try {
        await redis.hincrby(OFFER_ROLLS_KEY, offerId, 1);
      } catch (err) {
        warn(`  [offer-scan] hincrby(rolls) failed: ${err.message}`);
      }
    }

    if (!passed) continue;

    // Detection-only: don't queue, and DON'T record as posted — we want to
    // keep observing the cumulative probability curve in detection runs.
    if (detectionOnly && !enabled) {
      log(`  [offer-scan] detection-only: would have queued tip ${redaction.tip.id}`);
      continue;
    }

    // Bump the per-offer exposure counter. The NEXT scan that passes the
    // dice roll on this offer will read the new count and the redactor will
    // reveal one more detail (signal=2 adds the marquee player, signal=3
    // adds the second player, etc.). We also keep writing to OFFER_POSTED_KEY
    // so admin tooling and the legacy migration path stay accurate, but it's
    // no longer used as an absorbing gate.
    if (!dryRun) {
      // The stored shape is the ask AS OF THE LAST REPORT, not as of the last
      // scan. Writing it on every scan meant a changed ask was detectable for
      // exactly one cycle — most changes were overwritten before they could
      // ever post. Anchored here, the beat means "changed since we last told
      // you", which is the more useful claim and the one that survives until
      // it is made. (The original note cited "~8 scans a day"; the cron had
      // long since moved to */15. Cadence figures do not belong in comments.)
      try {
        await redis.hset(OFFER_SHAPE_KEY, { [offerId]: JSON.stringify(assetShapeOf(raw)) });
        await redis.expire(OFFER_SHAPE_KEY, OFFER_STATE_TTL_SEC);
      } catch (err) {
        warn(`  [offer-scan] hset(shape) failed for ${offerId}: ${err.message}`);
      }
      // NOTE: the OFFER_LAST_POST_KEY cooldown anchor is deliberately NOT
      // written here. This function ENQUEUES a tip; the post ships later, out
      // of the queue, and may never ship at all — the quality gate can
      // suppress it, the daily cap can block the cycle, the tip can strike out
      // or expire. Stamping the cooldown here would lock an offer out for 7
      // days for a post nobody ever read, and since TIP_EXPIRY_MS is also 7
      // days that usually means forever. It is stamped on DELIVERY instead,
      // off consumedBatch — see the BUDGET-ON-DELIVERY sentinel.
      //
      // `exposure` keeps incrementing here for back-compat: it has always
      // counted enqueues (see the 2026-09-07 insight), and re-anchoring it is
      // a separate change with its own blast radius.
      try {
        await redis.hincrby(OFFER_EXPOSURE_KEY, offerId, 1);
        await redis.expire(OFFER_EXPOSURE_KEY, OFFER_STATE_TTL_SEC);
      } catch (err) {
        warn(`  [offer-scan] hincrby(exposure) failed: ${err.message}`);
      }
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

async function checkGates(redis, now, { exemptFromMillCap = false } = {}) {
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

  // 2a. the rumor mill's OWN daily cap. Tighter than the shared budget while
  // a season is being played (1/day), back to the shared figure in the
  // offseason and through the ten days into each league's trade deadline —
  // see scripts/lib/schefter-rumor-cadence.mjs. Counted on its own key so a
  // transaction ping cannot spend the mill's slot, or the mill a ping's.
  const millCap = rumorMillDailyCap(LEAGUE_SLUG, now, MAX_POSTS_PER_DAY);
  const millRaw = await redis.get(RUMOR_MILL_POSTS_TODAY_KEY);
  const millPostsToday = typeof millRaw === 'number' ? millRaw : parseInt(millRaw ?? '0', 10) || 0;
  if (exemptFromMillCap && millPostsToday >= millCap) {
    log(`  [mailbag] Over the ${millCap}/day mill cap (${millPostsToday}) — exempt, the Friday sweep still runs`);
  } else if (millPostsToday >= millCap) {
    return {
      ok: false,
      reason:
        `mill_posts_today=${millPostsToday} — rumor-mill cap ${millCap}/day ` +
        `(${rumorMillCapReason(LEAGUE_SLUG, now)})`,
    };
  }

  // 2b. generation-attempt safety valve. Posting budgets count DELIVERED
  // posts only (BUDGET-ON-DELIVERY sentinel), so on an all-suppressed day
  // nothing above would ever trip — this separate attempt counter is the
  // aggregate LLM-rate ceiling that stops every cron tick from burning a
  // generate+score round against a queue of unshippable tips.
  const genAttemptsRaw = await redis.get(RUMOR_GEN_ATTEMPTS_TODAY_KEY);
  const genAttempts = typeof genAttemptsRaw === 'number' ? genAttemptsRaw : parseInt(genAttemptsRaw ?? '0', 10) || 0;
  if (genAttempts >= MAX_GEN_ATTEMPTS_PER_DAY) {
    return { ok: false, reason: `gen_attempts_today=${genAttempts} — LLM safety valve (max ${MAX_GEN_ATTEMPTS_PER_DAY}/day)` };
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

  return { ok: true, postsToday, millPostsToday, millCap };
}

// ── Main ──

/**
 * The deadline wrap-up (scripts/lib/schefter-deadline-wrap.mjs): ONE post per
 * deadline, in the first days after trading closes, about the deals that were
 * still on the table and did not get done. Brandon, 2026-11-14.
 *
 * Once per deadline, keyed on its cutoff instant, and outside the mill's daily
 * caps — it is a once-a-season story, not a rumor competing for a slot. Feed
 * only: the trade lanes never post to chat (docs/claude/rules/schefter.md).
 * The model writes it; the template stands in when the model is unavailable,
 * and also whenever the model's text carries a franchise name.
 */
async function maybePostDeadlineWrap({ redis, now, teams }) {
  if (!TRADING_STATE?.closed || !TRADING_STATE.cutoffISO) return;
  const cutoffMs = new Date(TRADING_STATE.cutoffISO).getTime();
  if (now.getTime() - cutoffMs > DEADLINE_WRAP_WINDOW_MS) return;
  if (isQuietHours(now)) return;

  const wrapKey = `${schefterKey(NAV_SLUG, 'trade_deadline_wrap:')}${TRADING_STATE.cutoffISO}`;
  try {
    if (await redis.get(wrapKey)) return;
  } catch (err) {
    warn(`  [deadline-wrap] key read failed: ${err.message} — skipping rather than risk a second wrap`);
    return;
  }

  const year = leagueYearFor(SCHEFTER_LEAGUE, now);
  const tradesRaw = (await fetchLiveLeagueExport(year, 'transactions', '&TRANS_TYPE=TRADE'))
    ?? await fs.readFile(SCHEFTER_LEAGUE.feedFilePath(year, 'transactions.json'), 'utf8').then(JSON.parse).catch(() => null);
  const tradeRows = (() => {
    const list = tradesRaw?.transactions?.transaction ?? [];
    return (Array.isArray(list) ? list : [list]).filter((t) => String(t?.type ?? '').toUpperCase() === 'TRADE');
  })();

  // Open offers come from the trade-offer lane's own sources, so only where
  // that lane runs. Elsewhere the wrap still counts the deals that got done.
  let offers = [];
  const mflCookie = process.env.MFL_USER_ID;
  if (SCHEFTER_LEAGUE.features?.tradeOfferRumors && mflCookie) {
    try {
      const { offerMap } = await collectPendingOffers({
        redis, teams: await loadTeamsWithDivisions(), year, mflCookie,
      });
      offers = [...offerMap.values()].map((o) => o.raw);
    } catch (err) {
      warn(`  [deadline-wrap] open offers unreadable: ${err.message} — counting completed deals only`);
    }
  }

  const features = SCHEFTER_LEAGUE_REGISTRY?.features ?? {};
  const facts = buildDeadlineWrapFacts({
    offers,
    cutoffMs,
    completedTrades: tradeRows,
    rosterOwnerByPlayerId: await loadRosterOwners(year),
    lastTradedAt: lastTradedAtByPlayer(tradeRows),
    playerMap: await loadPlayers(year),
    adpRankByPlayerId: await loadAdpDynastyRanks(year),
    rostersCarryOver: Boolean(features.contracts || features.keepers),
  });
  log(`  [deadline-wrap] facts: ${JSON.stringify(facts)}`);

  if (!wrapHasStory(facts)) {
    if (!DRY_RUN) await redis.set(wrapKey, 'nothing-to-report', { ex: 60 * 24 * 60 * 60 });
    log('  [deadline-wrap] no open deals and no completed deals — nothing to wrap');
    return;
  }

  const template = deadlineWrapTemplate(facts, TRADING_STATE.cutoffLabel);
  let body = template;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey && !DRY_RUN) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: HAIKU_MODEL,
          thinking: HAIKU_THINKING,
          max_tokens: 300,
          system: deadlineWrapSystemPrompt(),
          messages: [{ role: 'user', content: deadlineWrapUserMessage(facts, TRADING_STATE.cutoffLabel) }],
        }),
      });
      if (res.ok) {
        const match = responseText(await res.json()).match(/\{[\s\S]*\}/);
        const post = match ? JSON.parse(match[0])?.post : null;
        if (typeof post === 'string' && post.trim()) body = post.trim();
      } else {
        warn(`  [deadline-wrap] anthropic ${res.status} — using the template`);
      }
    } catch (err) {
      warn(`  [deadline-wrap] generation failed: ${err.message} — using the template`);
    }
  }
  // A wrap names no team. If the model slipped one in, the template ships.
  if (redactFranchiseNamesInText(body, teams) !== body) {
    warn('  [deadline-wrap] model text named a franchise — using the template');
    body = template;
  }

  const post = {
    id: generatePostId(),
    timestamp: now.toISOString(),
    type: 'transaction',
    transactionSubType: RUMOR_SUB_TYPE,
    tier: RUMOR_TIER,
    headline: 'Trade deadline wrap-up',
    body,
    authorId: 'claude',
    franchiseIds: [],
    tipIds: [],
    league: LEAGUE_SLUG,
    link: `/${LEAGUE_SLUG}/transactions`,
    linkLabel: 'See every deal that got done →',
  };

  if (DRY_RUN) {
    log(`  [dry-run] Would post the deadline wrap:\n${JSON.stringify(post, null, 2)}`);
    return;
  }
  const feed = await loadFeed();
  feed.posts = [post, ...(feed.posts ?? [])];
  feed.lastScanTimestamp = now.toISOString();
  await fs.writeFile(FEED_PATH, JSON.stringify(feed, null, 2) + '\n');
  await redis.set(wrapKey, post.id, { ex: 60 * 24 * 60 * 60 });
  log(`  [deadline-wrap] posted ${post.id}`);
}

async function main() {
  log(`\n=== Schefter Rumor-Mill Scan ${DRY_RUN ? '[DRY RUN]' : ''} ===`);
  log(`  Timestamp: ${new Date().toISOString()}`);

  // Enable gates: the env var is the GLOBAL kill switch; per-league
  // enablement comes from the registry's schefterTips flag (surfaced as
  // features.rumorMill via scripts/lib/schefter-leagues.mjs).
  const enabled = process.env.SCHEFTER_RUMOR_MILL_ENABLED;
  if (!enabled || enabled === '0' || String(enabled).toLowerCase() === 'false') {
    log('  SCHEFTER_RUMOR_MILL_ENABLED is not truthy — exiting');
    return 0;
  }
  if (!SCHEFTER_LEAGUE.features?.rumorMill) {
    log(`  rumor mill is not enabled for ${LEAGUE_SLUG} (features.schefterTips) — exiting`);
    return 0;
  }
  log(`  League: ${LEAGUE_SLUG} (${LEAGUE_ID})`);

  const redis = await getRedis();
  if (!redis) {
    warn('  Redis unavailable — exiting gracefully');
    return 0;
  }

  // Load personality + lore + bits once per run. If any file fails we fall
  // back to the legacy inline prompt inside generateAiBody.
  const lore = await loadLore({ log, warn, navSlug: NAV_SLUG });
  const history = await loadPostHistory({ log, warn, navSlug: NAV_SLUG });
  // Loaded HERE, before the memory block, not at the anonymize step below —
  // the block needs the team map to mask franchise names out of the recalled
  // post bodies, and an unmasked block is how another team's name reached a
  // post its payload never authorized (2026-09-07, Fire Ready Aim / Cyrus
  // Allen). Same map is reused for anonymize further down; loading it twice
  // would read the same config file twice for no reason.
  const teams = await loadTeams();
  const recentPostsBlock = buildRecentPostsPromptBlock(history.posts, {
    maskNames: memoryNameMasker(teams, redactFranchiseNamesInText),
    warn,
  });
  log(`  [memory] last ${Math.min(history.posts.length, 5)} posts passed to LLM (franchise names masked)`);

  // ── Phase 6: Trade-Offer Rumor source ──
  // Runs BEFORE the queue read so fresh redacted tips land in this cycle.
  // In detection-only mode, mutates Redis counters but doesn't queue.
  // Runs for any league whose registry `features.tradeRumors` is on (surfaced
  // as features.tradeOfferRumors). Offers arrive mostly through owners' own
  // reads (owner_reports); player escalation is scoped per player POOL so a
  // league with per-conference pools (the AFL) never counts two conferences'
  // separate deals for one player as a bidding war.
  // ── Trading window ──
  // Read before any trade lane runs. MFL's calendar is the source of truth
  // for the deadline (live, else the committed feed); the Constitution only
  // stands in when the calendar has no deadline. A failed read leaves
  // TRADING_STATE null, which every check reads as OPEN.
  try {
    const leagueYear = leagueYearFor(SCHEFTER_LEAGUE, new Date());
    let calendar = await fetchLiveLeagueExport(leagueYear, 'calendar');
    if (!calendar) {
      try {
        calendar = JSON.parse(await fs.readFile(SCHEFTER_LEAGUE.feedFilePath(leagueYear, 'calendar.json'), 'utf8'));
      } catch {
        calendar = null;
      }
    }
    TRADING_STATE = tradingWindowState({ slug: LEAGUE_SLUG, leagueYear, now: new Date(), calendar });
    log(
      `  [trading] ${TRADING_STATE.closed ? 'CLOSED' : 'open'} — deadline ${TRADING_STATE.cutoffLabel ?? 'none'} `
        + `(${TRADING_STATE.source})${TRADING_STATE.reopensISO ? `, reopens ${TRADING_STATE.reopensISO}` : ''}`,
    );
  } catch (err) {
    warn(`  [trading] window unreadable: ${err.message} — treating trading as open`);
  }

  if (tradingClosed()) {
    try {
      await maybePostDeadlineWrap({ redis, now: new Date(), teams });
    } catch (err) {
      warn(`  [deadline-wrap] failed: ${err.message} — continuing`);
    }
  }

  let offerTipsPushed = 0;
  if (tradingClosed()) {
    // Past the deadline a pending proposal can never execute, so the lane has
    // nothing to report: "four offers are circling… more to come" the morning
    // after the deadline is the post this guard exists to stop.
    log('  [offer-scan] trading is closed — trade-offer lane skipped');
    if (TRADE_OFFERS_ONLY) return 0;
  } else if (!SCHEFTER_LEAGUE.features?.tradeOfferRumors) {
    log(`  [offer-scan] trade-offer lane disabled for ${LEAGUE_SLUG} — skipping`);
    if (TRADE_OFFERS_ONLY) {
      log('  [offer-scan] --trade-offers-only with lane disabled → exiting');
      return 0;
    }
  } else {
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
  }

  // ── Phase 3: GroupMe mention ingest ──
  // Feed any @Schefter / @Claude mentions since the last watermark into the
  // same tips queue. Runs BEFORE the queue read so fresh mentions are included
  // in this cycle's batch.
  //
  // TheLeague-only, and the gate is load-bearing rather than cosmetic:
  // `schefter-groupme-listen.mjs` hardcodes TheLeague's keys (queue,
  // watermark, style book) because TheLeague owns the only group chat we
  // ingest. Running it from the AFL invocation would read TheLeague's group
  // and push into TheLeague's queue a second time per cycle. Until the env
  // was wired up (Sep 2026) the missing token no-op'd it and hid that.
  if (!SCHEFTER_LEAGUE.features?.groupmeListen) {
    log(`  [groupme] mention ingest disabled for ${LEAGUE_SLUG} — skipping`);
  } else {
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

  // Parse tips (strings from Upstash may already be auto-parsed objects).
  // `isUsableTip` owns the admission rule — see scripts/lib/schefter-tip-queue.mjs
  // for why `text` is required of some sources and not others.
  const parsedTips = [];
  let unparseableCount = 0;
  for (const item of queueRaw) {
    try {
      const obj = typeof item === 'string' ? JSON.parse(item) : item;
      if (isUsableTip(obj)) {
        parsedTips.push(obj);
      } else {
        unparseableCount++;
      }
    } catch {
      unparseableCount++;
    }
  }
  // Never let queue items vanish quietly again. Anything counted here is
  // about to be destroyed by the stale-queue cleanup below, so it has to be
  // loud enough to show up in a workflow log.
  if (unparseableCount > 0) {
    warn(`  ${unparseableCount} queue item(s) missing id/text or malformed — these will be DROPPED`);
  }
  // One row per tip, before anything downstream counts rows as stories.
  const dedupedTips = dedupeTipsById(parsedTips);
  const duplicateRows = parsedTips.length - dedupedTips.length;
  if (duplicateRows > 0) {
    log(`  Collapsed ${duplicateRows} duplicate queue row(s) — same tip id enqueued more than once`);
  }
  log(`  Queue depth: ${dedupedTips.length}${duplicateRows > 0 ? ` (+${duplicateRows} duplicate)` : ''}${unparseableCount > 0 ? ` (+${unparseableCount} unusable)` : ''}`);

  // Drop expired — by submitted age, by suppressed-strike count, or by
  // total time spent on hold. The strike/hold checks let Option A age out
  // a tip that the gate keeps rejecting without an LLM call ever firing.
  const now = new Date();
  const freshTips = [];
  const droppedTips = [];
  for (const t of dedupedTips) {
    const age = now.getTime() - (t.submittedAt ?? 0);
    const strikes = typeof t.suppressedStrikes === 'number' ? t.suppressedStrikes : 0;
    // A tip that struck out reached the LLM and lost on the merits; one that
    // simply aged out never got picked. The tipster deserves to know which.
    if (strikes >= MAX_SUPPRESSED_STRIKES) {
      droppedTips.push([t, 'spiked']);
    } else if (typeof t.firstSuppressedAt === 'number' && now.getTime() - t.firstSuppressedAt > MAX_HELD_MS) {
      droppedTips.push([t, 'spiked']);
    } else if (age > TIP_EXPIRY_MS) {
      droppedTips.push([t, 'expired']);
    } else if (tradingClosed() && isLiveTradeTip(t)) {
      // Queued before the deadline, about a deal that can no longer happen.
      droppedTips.push([t, 'expired']);
    } else {
      freshTips.push(t);
    }
  }
  if (droppedTips.length > 0) {
    log(`  Dropped tips (expired / strike-exhausted / hold-aged): ${droppedTips.length}`);
    for (const [t, status] of droppedTips) await recordTipReceipt(redis, t, { status });
  }

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

  const todayPtDate = getPtDateString(now);

  // Is THIS cycle a candidate Friday mailbag? Resolved before the gate because
  // the mailbag is exempt from the mill's daily cap, and checkGates returns
  // early — asking afterwards is asking too late. In season the cap is 1/day,
  // so one earlier rumor would otherwise spend the slot, the mailbag would
  // never run, its done-key would never be set, and the swept gossip tips
  // would age out unseen. That is the exact loss the mailbag exists to
  // prevent, so it gets the one exemption. Its own once-per-Friday done-key
  // still bounds it to a single extra post a week.
  let mailbagCandidate = false;
  if (MAILBAG_EXEMPT_FROM_MILL_CAP && isFridayPt(now)) {
    try {
      mailbagCandidate = (await redis.get(FRIDAY_MAILBAG_DONE_KEY)) !== todayPtDate;
    } catch {
      // Unreadable done-key: assume not yet run. Over-claiming the exemption
      // costs at most one post; under-claiming silently destroys tips.
      mailbagCandidate = true;
    }
    if (mailbagCandidate) {
      mailbagCandidate = freshTips.some((t) => classifyTipKind(t) === 'gossip');
    }
  }

  // Gate checks
  const gates = await checkGates(redis, now, { exemptFromMillCap: mailbagCandidate });
  if (!gates.ok) {
    log(`  GATE FAIL: ${gates.reason}`);
    return 0;
  }
  log(`  Gates OK (posts_today=${gates.postsToday}, marinated enough)`);

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
  const allBuckets = buildTopicBuckets(freshTips);
  log(
    `  Buckets (${allBuckets.length}): ` +
      allBuckets.map((b) => `${b.key}[${b.kind}×${b.tips.length}]`).join(', '),
  );

  // ── The day's TRADE budget ──
  //
  // Three lanes are trade-flavored (offers, trade-bait, and the speculation
  // scanner) and every cap in this file counts POSTS, so trade could take the
  // whole daily budget — 13 of 16 posts across Sept 4-10 2026, with three days
  // running at 100%. This is a topic ceiling on top of the post budget: one
  // trade story a day, league-wide, and the other slots stay open for
  // non-trade beats so a quiet trade day is not a quiet feed.
  //
  // A losing trade bucket is HELD, never dropped. Its tips stay in the queue
  // and the age boost in `bucketPriorityScore` floats them up tomorrow, which
  // is the same partial-drain path an unchosen bucket already takes.
  let tradePostsToday = 0;
  try {
    const raw = await redis.get(RUMOR_TRADE_POSTS_TODAY_KEY);
    tradePostsToday = typeof raw === 'number' ? raw : parseInt(raw ?? '0', 10) || 0;
  } catch (err) {
    warn(`  [trade-budget] read failed: ${err.message} — treating today as unspent`);
  }
  let tradeSlots = tradeSlotsRemaining(tradePostsToday, MAX_TRADE_POSTS_PER_DAY);
  const buckets = tradeSlots > 0
    ? allBuckets
    : allBuckets.filter((b) => !isTradeFlavoredBatch(b.tips));
  if (buckets.length !== allBuckets.length) {
    const held = allBuckets.filter((b) => !buckets.includes(b)).map((b) => b.key);
    log(
      `  [trade-budget] ${tradePostsToday}/${MAX_TRADE_POSTS_PER_DAY} trade post(s) today — `
        + `holding ${held.length} trade bucket(s) for tomorrow: ${held.join(', ')}`,
    );
  } else {
    log(`  [trade-budget] ${tradePostsToday}/${MAX_TRADE_POSTS_PER_DAY} used, ${tradeSlots} slot(s) open`);
  }
  // No `return` when the filter empties the list. `pickPrimaryBucket([])`
  // already yields null, which lands on the existing "no bucket qualifies"
  // path — the one that can still file a quiet-day post. And the Friday
  // mailbag is resolved ABOVE this, off its own gossip pool, so the sweep that
  // stops owner-submitted tips aging out is never blocked by a trade ceiling
  // it was deliberately exempted from.

  // Per-tipster context — lifts a first-time voice over same-sized noise
  // from the league's chatty regulars, and discounts a burst-tipping
  // tipster who has 3+ tips queued this cycle. See
  // scripts/lib/schefter-tipster-context.mjs for the score math and the
  // signal sources (Redis: rumors_total + topic_counts).
  let tipsterContext = new Map();
  try {
    tipsterContext = await buildTipsterContext(freshTips, redis, NAV_SLUG);
    if (tipsterContext.size > 0) {
      const summary = [...tipsterContext.values()].map((c) => {
        const tags = [];
        if (c.isFirstTime) tags.push('first');
        if (c.isProlific) tags.push('prolific');
        if (c.tipsInQueue >= 2) tags.push(`burst×${c.tipsInQueue}`);
        if (c.beat) tags.push(`beat:${c.beat.topic}`);
        return `${c.hashedOwnerId.slice(0, 6)}=${tags.join('+') || 'baseline'}`;
      }).join(', ');
      log(`  [tipster-context] ${tipsterContext.size} contributor(s) — ${summary}`);
    }
  } catch (err) {
    warn(`  [tipster-context] build failed: ${err.message} — falling back to size+age ranking`);
    tipsterContext = new Map();
  }

  // Recurrence ledger: a gossip bucket that has produced a post in each of
  // the two preceding ISO weeks is "stale". Skipping it from the normal
  // lane lets fresher tips post sooner. Stale tips still drain via the
  // Friday mailbag (where stale-ness doesn't apply — that path keeps the
  // unfiltered pool). Season rollover at Labor Day wipes the ledger.
  const seasonYear = currentSeasonYear(now);
  let recurrenceLedger;
  let ledgerReset;
  const ledgerPathAbs = path.join(projectRoot, ledgerPath(NAV_SLUG));
  try {
    [recurrenceLedger, ledgerReset] = rolloverForSeason(loadLedger(ledgerPathAbs), seasonYear);
    if (ledgerReset) {
      log(`  [recurrence] Season rollover → cleared ledger for ${seasonYear}`);
    }
  } catch (err) {
    warn(`  [recurrence] load failed (${err.message}) — starting fresh for ${seasonYear}`);
    [recurrenceLedger, ledgerReset] = rolloverForSeason(null, seasonYear);
  }
  const currentIsoWeek = isoWeekLabel(now);
  const staleBuckets = buckets.filter((b) => isBucketStale(b, recurrenceLedger, currentIsoWeek));
  const normalLaneBuckets = buckets.filter((b) => !isBucketStale(b, recurrenceLedger, currentIsoWeek));
  if (staleBuckets.length > 0) {
    log(
      `  [recurrence] ${currentIsoWeek} — ${staleBuckets.length} stale bucket(s) deferred to mailbag: ` +
        staleBuckets.map((b) => b.key).join(', '),
    );
  }

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
  // Busy-morning catch-up: when the morning window opens with 2+ trade
  // tips waiting, the scanner ships TWO trade-offer beats this cycle
  // (each its own post; both consume one MAX_POSTS_PER_DAY slot). The
  // flag below is also passed into the LLM so Schefter acknowledges the
  // overnight volume in-voice (rule: investigative-reporter energy, not
  // breathless headline shouting).
  let busyMorning = false;
  let busyMorningBacklog = 0;

  if (mailbagBatch) {
    postKind = 'mailbag';
    batch = mailbagBatch;
  } else {
    // Normal lane sees only non-stale buckets — stale repeats wait for Friday.
    // Rule 27 hard backstop: a hotseat storyline about the same team fires at
    // most once per rolling HOTSEAT_TEAM_COOLDOWN_DAYS, regardless of the
    // staleness-streak math ("your team is bad" repeated hits differently
    // than a trade rumor repeated). League-wide hotseat buckets pass through.
    const eligibleLaneBuckets = [];
    for (const b of normalLaneBuckets) {
      const m = /^topic:hotseat:(.+)$/.exec(b.key);
      // Only real franchise scopes cool down — 'league-wide' and 'commish'
      // aren't teams. Read-only check, so it runs in dry-run too (dry-run
      // output should pick the same bucket a live run would).
      if (m && /^\d{4}$/.test(m[1]) && redis) {
        try {
          const held = await redis.get(hotseatCooldownKey(m[1]));
          if (held) {
            log(`  Bucket ${b.key} held — hotseat cooldown active for that team`);
            continue;
          }
        } catch { /* fail open */ }
      }
      eligibleLaneBuckets.push(b);
    }
    const pick = pickPrimaryBucket(eligibleLaneBuckets, { gossipAllowedToday, now, tipsterContext });
    if (!pick) {
      if (staleBuckets.length > 0) {
        log(`  No fresh bucket qualifies — ${staleBuckets.length} stale bucket(s) held for next Friday mailbag`);
      } else {
        log('  No bucket qualifies (gossip cap used, no trade rumors) — holding tips for the next cycle');
      }
      // Feature 7 — quiet-day post. When the normal lane has nothing AND
      // we're not mid-mailbag, Schefter optionally files ONE candid
      // acknowledgment instead of going silent. Cooldown enforced via a
      // PT-date key so this fires at most once per QUIET_DAY_COOLDOWN_DAYS.
      const quietEval = evaluateQuietDayConditions({
        pick,
        mailbagBatch,
        freshTips,
        normalLaneBuckets,
        staleBuckets,
        tipsterContext,
      });
      if (!quietEval.shouldFire) return 0;

      let quietLastDateStr = null;
      try { quietLastDateStr = await redis.get(QUIET_DAY_LAST_DATE_KEY); } catch { /* tolerate */ }
      if (typeof quietLastDateStr === 'string' && quietLastDateStr.length > 0) {
        const ageDays = Math.floor((Date.parse(`${todayPtDate}T00:00:00Z`) - Date.parse(`${quietLastDateStr}T00:00:00Z`)) / (24 * 60 * 60 * 1000));
        if (ageDays < QUIET_DAY_COOLDOWN_DAYS) {
          log(`  [quiet-day] cooldown active — last fired ${quietLastDateStr} (${ageDays}d ago, need ≥${QUIET_DAY_COOLDOWN_DAYS}d)`);
          return 0;
        }
      }
      log(`  [quiet-day] firing — reason=${quietEval.reason}, queueSize=${quietEval.queueSize ?? 0}`);

      const quietBody = await generateQuietDayBody({
        reason: quietEval.reason,
        queueSize: quietEval.queueSize ?? 0,
      });
      log(`  [quiet-day] body: ${quietBody}`);

      if (DRY_RUN) {
        log(`  [dry-run] Would ship quiet-day post; would set ${QUIET_DAY_LAST_DATE_KEY}=${todayPtDate}`);
        return 0;
      }

      const quietPost = {
        id: generatePostId(),
        timestamp: now.toISOString(),
        type: 'transaction',
        transactionSubType: RUMOR_SUB_TYPE,
        tier: RUMOR_TIER,
        headline: 'Schefter checking in…',
        body: quietBody,
        authorId: 'claude',
        franchiseIds: [],
        tipIds: [],
        league: LEAGUE_SLUG,
        link: TIP_PAGE_PATH,
        linkLabel: 'Got a real tip?',
      };

      try {
        const feed = await loadFeed();
        feed.posts = [quietPost, ...(feed.posts ?? [])];
        feed.lastScanTimestamp = now.toISOString();
        await fs.writeFile(FEED_PATH, JSON.stringify(feed, null, 2) + '\n');
        log(`  [quiet-day] appended quiet-day post ${quietPost.id} to feed`);
      } catch (err) {
        warn(`  [quiet-day] feed write failed: ${err.message}`);
        return 0;
      }

      // Mark cooldown + the daily-cap counter so quiet-day shares one of
      // the day's MAX_POSTS_PER_DAY slots. Deliberately NO GroupMe ping —
      // a "slow news day" post buzzing every phone is the opposite of slow.
      try {
        await redis.set(QUIET_DAY_LAST_DATE_KEY, todayPtDate);
        const newCount = await redis.incr(RUMOR_POSTS_TODAY_KEY);
        if (newCount === 1) {
          await redis.expire(RUMOR_POSTS_TODAY_KEY, secondsUntilPtMidnight(now));
        }
        // Also spends the mill's own slot. It is a rumor-mill feed entry, so
        // leaving it out would let a quiet-day post and a real rumor both ship
        // on a 1/day in-season cap — two posts from a lane capped at one.
        const newMillCount = await redis.incr(RUMOR_MILL_POSTS_TODAY_KEY);
        if (newMillCount === 1) {
          await redis.expire(RUMOR_MILL_POSTS_TODAY_KEY, secondsUntilPtMidnight(now));
        }
        await redis.set(RUMOR_LAST_POST_TS_KEY, now.getTime());
      } catch (err) {
        warn(`  [quiet-day] counter update failed: ${err.message} — post shipped, cooldown unset`);
      }
      return 1;
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
    // separate. Trade-rumor posts get the same two-post pattern under the
    // busy-morning catch-up rule below — see BUSY_MORNING_END_HOUR.
    //
    // The gossip secondary only fires under real backlog pressure
    // (>= SECONDARY_GOSSIP_POST_PRESSURE gossip tips queued). Below that
    // threshold we ship a single post and let the secondary bucket wait
    // its turn — the two-post double is a pile-up catch-up mechanism,
    // not a default cadence.
    if (postKind === 'gossip' && secondaryBucket) {
      const gossipQueueDepth = freshTips.filter((t) => classifyTipKind(t) === 'gossip').length;
      if (!allowsTwoPostCycle(LEAGUE_SLUG, now, MAX_POSTS_PER_DAY)) {
        // Same rule as the busy-morning split below: the daily counter
        // increments once per delivering CYCLE, so two beats here would ship
        // two posts against a cap of one. In season the secondary bucket waits
        // for tomorrow's slot instead.
        log(`  Holding ${secondaryBucket.key} for next cycle — rumor-mill cap is 1/day (${rumorMillCapReason(LEAGUE_SLUG, now)})`);
      } else if (
        isTradeFlavoredBatch(secondaryBucket.tips)
        && tradeSlots <= (isTradeFlavoredBatch(batch) ? 1 : 0)
      ) {
        // The trade ceiling reaches the GOSSIP secondary too, not just the
        // busy-morning trade split below. `trade_bait` classifies as gossip,
        // so two franchises' block listings are two gossip buckets and two
        // trade stories — the ceiling would be spent to 2/1 after the fact,
        // with both posts already shipped. Gate on what this cycle is already
        // spending: a trade primary leaves room only if two slots exist.
        log(`  Holding ${secondaryBucket.key} for tomorrow — it is a trade story and the day's trade slot is spoken for`);
      } else if (gossipQueueDepth >= SECONDARY_GOSSIP_POST_PRESSURE) {
        secondaryBatch = secondaryBucket.tips.slice(0, MAX_TIPS_PER_BATCH);
        log(`  Second post bucket ${secondaryBucket.key} (size=${secondaryBucket.tips.length}, using ${secondaryBatch.length} tip(s)) — pressure ${gossipQueueDepth}/${SECONDARY_GOSSIP_POST_PRESSURE}`);
      } else {
        log(`  Holding ${secondaryBucket.key} for next cycle — gossip queue depth ${gossipQueueDepth} < ${SECONDARY_GOSSIP_POST_PRESSURE} (no pile-up pressure)`);
      }
    }

    // Busy-morning trade catch-up: the trade bucket key is `trade:offer`
    // (all trade-offer tips share one bucket — see schefter-bucket-logic
    // .mjs), so pickPrimaryBucket only ever returns one trade bucket.
    // To ship 2 trade-offer posts in this cycle, we split the trade
    // bucket's tips: oldest tip → primary beat, next-oldest → secondary
    // beat. Each becomes its own post with its own anonymization pass.
    // Under a 1/day cap the double-post would put two rumors in the chat
    // back-to-back off one slot — the pile-up the in-season cap exists to
    // prevent — so the catch-up is offseason/deadline-window only and an
    // overnight backlog just clears a day slower in season.
    //
    // The backlog is counted in DISTINCT tip ids, and the second beat is the
    // oldest tip whose id differs from the first's — never simply the next row
    // along. dedupeTipsById already guarantees one row per tip upstream; this
    // is the belt to that pair of braces, because this split is the single
    // place in the scanner where "two tips" is read as "two stories", and the
    // cost of being wrong here is not a bad log line, it is the same trade
    // offer reported twice in the chat one second apart (owner report,
    // 2026-09-08).
    const distinctTradeTipIds = new Set(
      primaryBucket.tips.map((t) => String(t?.id ?? '')),
    );
    // `tradeSlots > 1` is the topic ceiling asserting itself INSIDE a cycle.
    // The two gates above it both count posts against MAX_POSTS_PER_DAY, and
    // this split deliberately ships two feed entries against ONE of those
    // slots — which under a one-trade-story-a-day ceiling is one trade post
    // too many. The second beat waits for tomorrow's trade slot.
    if (
      postKind === 'trade' &&
      distinctTradeTipIds.size >= BUSY_MORNING_TRADE_THRESHOLD &&
      isBusyMorningWindow(now) &&
      allowsTwoPostCycle(LEAGUE_SLUG, now, MAX_POSTS_PER_DAY) &&
      tradeSlots > 1
    ) {
      const sortedTips = [...primaryBucket.tips].sort(
        (a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0),
      );
      const primaryTip = sortedTips.slice(0, 1);
      const primaryTipId = String(primaryTip[0]?.id ?? '');
      const secondaryTip = sortedTips
        .slice(1)
        .find((t) => String(t?.id ?? '') !== primaryTipId);
      // Unreachable by construction — the gate above already found >= 2
      // distinct ids in the very array `sortedTips` is sorted from, so some
      // element of slice(1) must differ from the first. Kept as a guard, not
      // as a branch: it costs one line, and it is what makes the "never the
      // same offer twice" property hold locally rather than only as a
      // consequence of a gate ten lines up that a future edit could loosen.
      // Deliberately NOT logged in the else — a log line for a branch that
      // cannot run reads as a real state in the workflow output.
      if (secondaryTip) {
        busyMorning = true;
        busyMorningBacklog = distinctTradeTipIds.size;
        batch = primaryTip;
        secondaryBatch = [secondaryTip];
        log(`  [busy-morning] Trade backlog ${busyMorningBacklog} distinct offer(s) — splitting into 2 beats (one slot)`);
      }
    }
  }

  const batchIds = new Set([
    ...batch.map((t) => t.id),
    ...(secondaryBatch ? secondaryBatch.map((t) => t.id) : []),
  ]);
  const unusedTips = freshTips.filter((t) => !batchIds.has(t.id));
  log(`  Processing batch of ${batch.length}${secondaryBatch ? ` + ${secondaryBatch.length} secondary` : ''} (holding ${unusedTips.length} for next cycle)`);

  // Cross-corroboration. For each trade-offer tip about to ship, check
  // whether the rest of the queue contains independent web/groupme tips
  // pointing at the same offer (matching franchise scope on a trade-topic
  // tip, or a player-name substring match in the text). The resulting
  // count flows through anonymization to the LLM, which upgrades to
  // direct-knowledge voice. Mutates the tip objects in place — the
  // anonymizer reads the count off the tip and surfaces it to the LLM.
  const corroborationCandidates = freshTips; // include batch + leftovers
  for (const tipBatch of [batch, secondaryBatch].filter(Boolean)) {
    for (const tip of tipBatch) {
      if (tip.source !== 'trade_offer') continue;
      const others = corroborationCandidates.filter((t) => t.id !== tip.id);
      const matches = findCorroboratingTips(tip, others);
      if (matches.length > 0) {
        tip.corroboratingSourceCount = matches.length;
        log(`  [corroboration] ${tip.id} matched ${matches.length} independent tip(s): ${matches.join(', ')}`);
      }
    }
  }

  // Anonymize — load the feed early so whisper-back tips can pull parent
  // headline snippets into their scope. `teams` was loaded up front for the
  // memory-block masker; reused rather than re-read.
  const feedForAnonymize = await loadFeed();
  const anonymized = await anonymizeTips(batch, teams, feedForAnonymize.posts ?? [], now, redis, tipsterContext);
  const secondaryAnonymized = secondaryBatch
    ? await anonymizeTips(secondaryBatch, teams, feedForAnonymize.posts ?? [], now, redis, tipsterContext)
    : null;
  log(`  Anonymized ${anonymized.length} tips${secondaryAnonymized ? ` + ${secondaryAnonymized.length} secondary` : ''}`);

  // Annotate each anonymized tip with the recurrence streak length for its
  // bucket. The mailbag prompt uses this to frame multi-week repeats with
  // "week N now" language (HARD RULE 20). Single-post rumors only ever ship
  // when streak < 3 (the scanner filters stale buckets out of the normal
  // lane), but we annotate anyway so the LLM has the signal if HARD RULE 17
  // wants to lean on it for borderline cases.
  try {
    const annotateStreaks = (anonList, tipList) => {
      if (!Array.isArray(anonList) || anonList.length === 0) return;
      const streakById = new Map();
      const consumed = buildTopicBuckets(tipList);
      for (const b of consumed) {
        const streak = bucketStreakLength(b, recurrenceLedger, currentIsoWeek);
        for (const t of b.tips) {
          if (t && typeof t.id === 'string') streakById.set(t.id, streak);
        }
      }
      for (const a of anonList) {
        if (a && typeof a.id === 'string') {
          a.staleStreakWeeks = streakById.get(a.id) ?? 1;
        }
      }
    };
    annotateStreaks(anonymized, batch);
    if (secondaryAnonymized) annotateStreaks(secondaryAnonymized, secondaryBatch);
  } catch (err) {
    warn(`  [recurrence] streak annotation failed: ${err.message} — proceeding without`);
  }

  // Cross-week memory recall (feature 10 / HARD RULE 25). For each bucket
  // that has a ledger fingerprint AND has been touched in ≥2 prior weeks,
  // check whether THIS cycle's tipster roster contains at least one voice
  // that wasn't on the previous roster. If yes, surface a memoryRecall
  // payload on every anonymized tip in that bucket so the LLM can open
  // with "circling back to last week's…" / "three weeks ago a source
  // mentioned this; tonight a different voice…" framing. Privacy: only
  // COUNTS surface — no hashes, no codenames, no franchises.
  try {
    const annotateMemoryRecall = (anonList, tipList) => {
      if (!Array.isArray(anonList) || anonList.length === 0) return;
      const recallById = new Map();
      const consumed = buildTopicBuckets(tipList);
      for (const b of consumed) {
        const fp = bucketFingerprint(b);
        if (!fp) continue;
        const currentHashes = [];
        for (const t of b.tips) {
          if (t?.source === 'web' && typeof t.hashedOwnerId === 'string' && t.hashedOwnerId) {
            currentHashes.push(t.hashedOwnerId);
          }
        }
        const recall = getMemoryRecall(recurrenceLedger, fp, currentHashes, currentIsoWeek);
        if (!recall) continue;
        for (const t of b.tips) {
          if (t && typeof t.id === 'string') recallById.set(t.id, recall);
        }
      }
      for (const a of anonList) {
        if (a && typeof a.id === 'string') {
          const r = recallById.get(a.id);
          if (r) a.memoryRecall = r;
        }
      }
    };
    annotateMemoryRecall(anonymized, batch);
    if (secondaryAnonymized) annotateMemoryRecall(secondaryAnonymized, secondaryBatch);
  } catch (err) {
    warn(`  [recurrence] memory-recall annotation failed: ${err.message} — proceeding without`);
  }

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

  // Morning greeting — once per PT day, when the first post lands in the
  // 07:00–10:59 PT window, the LLM gets a directive to cold-open with a
  // classic-news / sports-column "good morning" line. The Redis key is
  // stamped only on successful post commit (alongside last_post_ts and
  // ROGER_LAST_RIFF_DATE_KEY) so a failed cycle doesn't burn the slot.
  let morningGreeting = false;
  let lastMorningGreetingDate = null;
  if (isMorningGreetingWindow(now)) {
    try {
      lastMorningGreetingDate = await redis.get(MORNING_GREETING_DATE_KEY);
    } catch { /* tolerate */ }
    morningGreeting = lastMorningGreetingDate !== todayPt;
    log(`  [morning-greeting] window open, todayPT=${todayPt}, lastUsed=${lastMorningGreetingDate ?? '(none)'} → ${morningGreeting ? 'will fire on primary beat' : 'already greeted today'}`);
  }

  // Build the list of "beats" — one per independent feed post we'll ship
  // this cycle. Most post kinds produce exactly one beat; a two-topic
  // gossip cycle produces TWO beats (independent post IDs, independent
  // reactions/threads) even though they share the same cap slot. Trade
  // beats also produce two posts in busy-morning catch-up mode — see
  // BUSY_MORNING_END_HOUR / BUSY_MORNING_TRADE_THRESHOLD above.
  const beats = [
    { batch, anonymized, kind: postKind },
  ];
  if (secondaryBatch && (postKind === 'gossip' || (postKind === 'trade' && busyMorning))) {
    beats.push({
      batch: secondaryBatch,
      anonymized: secondaryAnonymized,
      kind: postKind,
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
  // riff and the morning greeting — both are once-per-day cameos that
  // shouldn't double up across beats in the same cycle.
  const aiMode = postKind === 'mailbag' ? 'mailbag' : 'single';
  const aiBodies = await Promise.all(
    beats.map((beat, i) => generateAiBody(beat.anonymized, {
      rogerQuote: i === 0 ? rogerQuote : null,
      lore,
      recentPostsBlock,
      mode: aiMode,
      nflContext,
      schefterTargetMode: schefterModes[i],
      busyMorning: busyMorning && beat.kind === 'trade',
      busyMorningBacklog: busyMorning ? busyMorningBacklog : 0,
      morningGreeting: i === 0 && morningGreeting,
    })),
  );

  // Build post objects. Each beat resolves its own whisper-back thread
  // from its own batch's repliesToPostId, so replies to two different
  // parent rumors land in two different threads — one per post. We keep
  // the parent-id mapping in a side Map so it never leaks into the feed
  // JSON or the API response shape.
  const builtPosts = [];
  const ctaByPostId = new Map();
  const parentIdByPostId = new Map();
  // CTA is resolved per-beat from THAT BEAT'S OWN TIPS, so a gossip secondary
  // attached to a trade_bait primary cannot inherit the wrong Trade Builder
  // link — and, since the busy-morning split, so the second TRADE beat gets
  // the right one.
  //
  // This used to index a parallel [primaryBucket, secondaryBucket] array, and
  // pickPrimaryBucket hard-codes secondaryBucket to null for a trade primary.
  // Under the busy-morning split both beats are trade-offer reports drawn from
  // ONE bucket, so beat 2 resolved its CTA from `undefined`, found no
  // trade-flavored tips, and shipped the generic "Got a tip?" link while beat 1
  // shipped the Trade Builder one. That is why the 2026-09-08 pair read as two
  // separate scoops rather than one story told twice. `resolveCta` only ever
  // reads `.tips`, so handing it the beat's own batch is both simpler and
  // correct for every lane.
  //
  // The Friday MAILBAG stays on the tip-page CTA. It never assigns
  // `primaryBucket`, so it used to reach the generic link by accident of
  // `null` — and its batch is the whole gossip pool, which `classifyTipKind`
  // fills with everything that is not `source: 'trade_offer'`, `trade_bait`
  // tips and `topic: 'trade'` web tips included. Handing that batch to
  // `resolveCta` would point a multi-topic roundup at one franchise's trade
  // builder and drop the whisper-back CTA, which is the one link a mailbag
  // most needs. Explicit now, rather than correct by accident.
  //
  // Scope note: this governs the resolveCta path only. `buildDirectedCta`
  // short-circuits ahead of it, so a mailbag led by an explicit-pick tip still
  // ships a DIRECTED dare. That stays as-is — the directed link is
  // `TIP_PAGE_PATH?target=<fid>`, i.e. still the tip form with the
  // whisper-back affordance, merely pre-selecting a franchise. Pre-existing
  // behavior; whether a multi-topic roundup should be aimed at one desk is an
  // editorial question, not this bug.
  const ctaSourceFor = (beat) =>
    (postKind === 'mailbag' ? { tips: [] } : { tips: beat.batch ?? [] });
  // Still needed for the recurrence fingerprint below, which reads the
  // bucket's key/kind and not just its tips. Under busy-morning beat 2 has no
  // bucket of its own, so it gets no "fresh subject" threshold relaxation —
  // the conservative pre-existing behavior, left alone deliberately.
  const beatBuckets = [primaryBucket, secondaryBucket];
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const aiBody = aiBodies[i];

    // ── Team tokens resolve HERE, the single point every body passes ──
    //
    // The LLM was handed `{{TEAM:<fid>}}` rather than a franchise name, so it
    // could not have named the wrong one; this puts the real names back. Every
    // token carries its own franchise id (and a year, for a former name), so
    // this is a lookup against the whole team map — not an assumption that the
    // post is about one particular team. That is what lets the former-name
    // callback be tokenized too: its franchise is often NOT the exposure team.
    //
    // An unresolved token means the model invented its own placeholder, or
    // wrote one on a beat with no team to fill. That is a failed generation,
    // not a body to patch: fall back to the template, which is code-built and
    // has no tokens in it. A literal `{{TEAM}}` in the group chat would be
    // worse than the misattribution this replaces.
    // The exact tokens this beat may expand, read from the FIELDS that mint
    // them — never scraped off the whole tip, which carries tipster-controlled
    // text and would let a tipster authorize their own token.
    const resolveOpts = { allowedTokens: authorizedTokensFor(beat.anonymized) };
    let resolvedBody = resolveTeamTokens(aiBody || templateBody(beat.anonymized), teams, resolveOpts);
    let usedTemplate = !aiBody;
    if (resolvedBody.unresolved && aiBody) {
      warn(`  [beat ${i + 1}] unresolved team token in AI body — falling back to template`);
      resolvedBody = resolveTeamTokens(templateBody(beat.anonymized), teams, resolveOpts);
      usedTemplate = true;
    }
    let body = resolvedBody.text;
    if (resolvedBody.unresolved) {
      // Belt to the braces above: templateBody does not emit tokens, so this
      // is unreachable today. If it ever fires, ship prose rather than markup.
      warn(`  [beat ${i + 1}] token survived the template fallback — scrubbing to a generic placeholder`);
      // Matches the DETECTION above, which counts any stray `{{`/`}}` — a
      // balanced-only scrub would leave the half-mangled markup it guards.
      body = body.replace(/\{\{[^{}]*\}{0,2}/g, MASKED_TEAM).replace(/\}\}/g, '');
    }
    log(`  [beat ${i + 1}/${beats.length}] (${usedTemplate ? 'template' : 'AI'})${i === 0 && hadRogerRiff ? ' [with Roger riff]' : ''}:\n    ${body.replace(/\n/g, '\n    ')}`);

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
        const registered = await redis.get(globalSchefterKey('threadOf', dominantParentId));
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
    const cta = directedCta ?? resolveCta(ctaSourceFor(beat));

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

  // GroupMe payload — per-post CTA. Trade-bait posts link into the Trade
  // Builder; every other post carries the tip-page CTA.
  const groupMeTextFor = (p) => {
    const cta = ctaByPostId.get(p.id) ?? {
      groupMePrefix: 'Got a tip?',
      groupMeUrl: TIP_PAGE_ABSOLUTE_URL,
    };
    return `${p.body}\n\n${cta.groupMePrefix} ${cta.groupMeUrl}`;
  };

  // Quality gate — per-beat check BEFORE any persistence. Suppressed beats
  // do not write the feed, do not ping GroupMe, do not credit tipster
  // counters, and do not bump team-naming or history. Their tips are pushed
  // back into the queue with `suppressedStrikes` incremented (Option A) so a
  // future cycle can promote them to multi-source naming if a corroborating
  // tip lands. Tips that hit MAX_SUPPRESSED_STRIKES or sit in held state
  // longer than MAX_HELD_MS get dropped at the next queue load.
  // Failure mode of the gate itself is allow-on-error (see
  // schefter-quality-gate.mjs header).
  //
  // Quiet-feed leniency (July 2026, per Brandon): when Schefter has been
  // quiet, the bar for interrupting the chat drops to
  // RELAXED_QUALITY_THRESHOLD. A beat runs against the relaxed bar when
  // EITHER holds:
  //   - league drought: this league's feed has no rumor-mill post in the
  //     last RUMOR_QUIET_FEED_DAYS (or none ever — a fresh launch).
  //     Applies to EVERY beat in the cycle, whatever its lane — a silent
  //     league is the whole reason to loosen up.
  //   - fresh subject: the beat's bucket fingerprint has not shipped a post
  //     during the current ISO week. The recurrence ledger is stamped only
  //     on delivery, so it is the source of truth for "posted about it".
  //     Only fingerprint lanes qualify — bucketFingerprint() returns null
  //     for trade-offer / whisper-back buckets (and mailbag beats have no
  //     single bucket), so those stay on the standard bar.
  // Note the deliberate consequence: any subject that hasn't shipped this
  // week — including a brand-new one — gets the 3-bar. That is Brandon's
  // rule verbatim ("a 3/10 is ok to post if he hasn't posted about it that
  // week"); the strict 6-bar applies to repeat coverage within a week.
  // Scores of 1-2 (hallucinated / contradictory) still suppress either way.
  const RUMOR_QUIET_FEED_DAYS = 7;
  const newestRumorTs = (feedForAnonymize.posts ?? []).reduce(
    (acc, p) =>
      p?.transactionSubType === RUMOR_SUB_TYPE
        ? Math.max(acc, new Date(p.timestamp).getTime() || 0)
        : acc,
    0,
  );
  const leagueQuiet =
    newestRumorTs === 0 ||
    now.getTime() - newestRumorTs > RUMOR_QUIET_FEED_DAYS * 24 * 60 * 60 * 1000;
  const relaxedThresholdFor = (beatIndex) => {
    if (leagueQuiet) return { threshold: RELAXED_QUALITY_THRESHOLD, why: `league quiet ${RUMOR_QUIET_FEED_DAYS}d` };
    // Each beat's bucket was already resolved when the beat was built —
    // reuse it rather than re-clustering the batch.
    const bucket = beatBuckets[beatIndex] ?? null;
    const fp = bucket ? bucketFingerprint(bucket) : null;
    if (fp && !(recurrenceLedger?.fingerprints?.[fp]?.weeksSeen ?? []).includes(currentIsoWeek)) {
      return { threshold: RELAXED_QUALITY_THRESHOLD, why: 'fresh subject this week' };
    }
    return null;
  };
  const gateResults = await Promise.all(
    builtPosts.map((p, i) => {
      const primaryTip = beats[i]?.anonymized?.[0];
      const relaxed = relaxedThresholdFor(i);
      if (relaxed) {
        log(`  [quality-gate] relaxed threshold ${relaxed.threshold} for beat ${i + 1} (${relaxed.why})`);
      }
      return checkGroupMeQuality(
        {
          headline: p.headline,
          body: p.body,
          tier: p.tier,
          scope: primaryTip?.scope?.kind ?? null,
          topic: primaryTip?.topic ?? null,
        },
        {
          apiKey: process.env.ANTHROPIC_API_KEY,
          log,
          warn,
          // undefined falls back to QUALITY_THRESHOLD inside the gate.
          threshold: relaxed?.threshold,
        },
      );
    }),
  );

  // gateResults order matches beats/builtPosts order (Promise.all
  // preserves input order), so index i is safe to share across all three.
  const allowedIndexSet = new Set(
    gateResults
      .map((g, i) => (g && g.allow !== false ? i : -1))
      .filter((i) => i >= 0),
  );
  const allowedPosts = builtPosts.filter((_, i) => allowedIndexSet.has(i));
  const allowedBeats = beats.filter((_, i) => allowedIndexSet.has(i));
  const consumedBatch = allowedBeats.flatMap((b) => b.batch);
  const consumedTipIds = consumedBatch.map((t) => t.id);

  // Build the held-tips list now so DRY_RUN can log it. Each held tip:
  //  - bumps suppressedStrikes (defaults 0 → 1 on first hold)
  //  - stamps firstSuppressedAt the first time it's held
  //  - drops here when strikes hit the cap or held-age exceeds the window
  //    (instead of getting re-pushed and dropped on the next queue load)
  const heldTipsForRequeue = [];
  const heldTipsExhausted = [];
  for (let i = 0; i < beats.length; i++) {
    if (allowedIndexSet.has(i)) continue;
    const gate = gateResults[i];
    await recordRumorGroupMeSuppression({
      id: builtPosts[i].id,
      timestamp: builtPosts[i].timestamp,
      headline: builtPosts[i].headline,
      body: builtPosts[i].body,
      score: gate?.score ?? null,
      reason: gate?.reason ?? null,
    });
    for (const tip of beats[i].batch) {
      const strikes = (typeof tip.suppressedStrikes === 'number' ? tip.suppressedStrikes : 0) + 1;
      const firstSuppressedAt = typeof tip.firstSuppressedAt === 'number' ? tip.firstSuppressedAt : now.getTime();
      if (strikes >= MAX_SUPPRESSED_STRIKES) {
        log(`  [hold-strike] ${tip.id} hit ${MAX_SUPPRESSED_STRIKES} strikes — dropping`);
        heldTipsExhausted.push(tip);
        await recordTipReceipt(redis, tip, { status: 'spiked' });
        continue;
      }
      if (now.getTime() - firstSuppressedAt > MAX_HELD_MS) {
        log(`  [hold-strike] ${tip.id} held > ${(MAX_HELD_MS / 3600000).toFixed(0)}h — dropping`);
        heldTipsExhausted.push(tip);
        await recordTipReceipt(redis, tip, { status: 'spiked' });
        continue;
      }
      heldTipsForRequeue.push({ ...tip, suppressedStrikes: strikes, firstSuppressedAt });
    }
  }

  if (DRY_RUN) {
    log(`\n  [dry-run] Gate verdict: ${allowedPosts.length} allow / ${builtPosts.length - allowedPosts.length} suppress`);
    log(`\n  [dry-run] Would append ${allowedPosts.length} post(s) to feed:`);
    for (const p of allowedPosts) log(JSON.stringify(p, null, 2));
    log('\n  [dry-run] Would archive (consume) the following tipIds:');
    log(`    ${consumedTipIds.join(', ')}`);
    if (heldTipsForRequeue.length > 0) {
      log(`  [dry-run] Would HOLD ${heldTipsForRequeue.length} suppressed tip(s) for re-evaluation: ${heldTipsForRequeue.map((t) => `${t.id}(strikes=${t.suppressedStrikes})`).join(', ')}`);
    }
    if (heldTipsExhausted.length > 0) {
      log(`  [dry-run] Would DROP ${heldTipsExhausted.length} strike-exhausted tip(s): ${heldTipsExhausted.map((t) => t.id).join(', ')}`);
    }
    if (unusedTips.length > 0) {
      log(`  [dry-run] Would hold ${unusedTips.length} unchosen-bucket tip(s) for the next cycle: ${unusedTips.map((t) => t.id).join(', ')}`);
    }
    log('  [dry-run] Would increment gen_attempts_today by 1 (LLM safety valve — counts every generation cycle)');
    if (allowedPosts.length > 0) {
      log(`  [dry-run] Would increment schefter:rumor:posts_today + schefter:rumor:mill_posts_today by 1${postKind === 'gossip' ? ' + schefter:rumor:gossip_posts_today by 1' : ''}, set last_post_ts (budgets count delivered posts only)`);
    } else {
      log('  [dry-run] Fully-suppressed cycle — would consume NO daily budget (posts_today, mill_posts_today, gossip cap, spacing all unchanged)');
    }
    // Mirror the real path's delivery gating exactly — the riff/greeting
    // stamps only burn when beat 0 (their carrier) actually ships.
    if (hadRogerRiff) {
      log(`  [dry-run] ${allowedIndexSet.has(0)
        ? `Would set ${ROGER_LAST_RIFF_DATE_KEY}=${todayPt} (ex=48h)`
        : 'Riff beat suppressed — would NOT set roger riff date'}`);
    }
    if (morningGreeting) {
      log(`  [dry-run] ${allowedIndexSet.has(0)
        ? `Would set ${MORNING_GREETING_DATE_KEY}=${todayPt} (ex=48h)`
        : 'Greeting beat suppressed — would NOT set morning-greeting date'}`);
    }
    for (const p of allowedPosts) {
      await postToGroupMe(groupMeTextFor(p), p);
    }
    return 0;
  }

  // Write feed — only ALLOWED posts ship. Held / suppressed posts never hit
  // the website feed; their underlying tips wait for re-evaluation.
  if (allowedPosts.length > 0) {
    const feed = await loadFeed();
    const existingPosts = feed.posts ?? [];
    feed.posts = [...allowedPosts, ...existingPosts];
    feed.lastScanTimestamp = now.toISOString();
    await fs.writeFile(FEED_PATH, JSON.stringify(feed, null, 2) + '\n');
    log(`  Appended to feed: ${allowedPosts.length} new post(s) (total: ${feed.posts.length})`);
  } else {
    log('  All beats suppressed — skipping feed write; tips held for re-evaluation');
  }

  // GroupMe — one message per allowed post so each shows up as an independent
  // reply target in the group chat. Small stagger between to avoid
  // rate-limiting surprises.
  for (let i = 0; i < allowedPosts.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 250));
    await postToGroupMe(groupMeTextFor(allowedPosts[i]), allowedPosts[i]);
  }

  // Per-team name counter: every ALLOWED post that named a franchise
  // (explicit-pick, multi-source, or trade-bait) bumps the rolling 30-day
  // name count for that franchise. Drives drama escalation in subsequent
  // posts and powers the "Hottest desks this week" sidebar widget. Held
  // posts do not bump — the post never shipped, so it shouldn't influence
  // future naming framing.
  for (let i = 0; i < allowedPosts.length; i++) {
    const beat = allowedBeats[i];
    const post = allowedPosts[i];
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
        NAV_SLUG,
      );
    } catch (err) {
      warn(`  [team-naming] record failed for ${post.id} → ${franchiseId}: ${err.message}`);
    }
  }

  // Rule 27 — stamp the hotseat per-team cooldown for any shipped post whose
  // batch contains a hotseat tip pointed at a specific team. The key TTLs
  // itself away after HOTSEAT_TEAM_COOLDOWN_DAYS.
  for (let i = 0; i < allowedPosts.length; i++) {
    const beat = allowedBeats[i];
    for (const t of beat?.batch ?? []) {
      if (t?.topic !== 'hotseat') continue;
      const fid = typeof t.franchiseHint === 'string' && t.franchiseHint !== 'league-wide' && t.franchiseHint !== 'commish'
        ? t.franchiseHint
        : null;
      if (!fid || !redis) continue;
      try {
        await redis.set(hotseatCooldownKey(fid), Date.now(), {
          ex: HOTSEAT_TEAM_COOLDOWN_DAYS * 24 * 60 * 60,
        });
      } catch (err) {
        warn(`  [hotseat-cooldown] stamp failed for ${fid}: ${err.message}`);
      }
    }
  }

  // Append each ALLOWED post to the rolling history (one entry per post).
  const tipSources = Array.from(new Set(consumedBatch.map((t) => t.source).filter(Boolean)));
  for (let i = 0; i < allowedPosts.length; i++) {
    const p = allowedPosts[i];
    const beat = allowedBeats[i];
    const subject = deriveHistorySubject(beat.batch, beat.anonymized);
    await appendPostHistory(
      buildHistoryEntry({
        id: p.id,
        timestamp: p.timestamp,
        body: p.body,
        subject,
        tipSources,
      }),
      { log, warn, navSlug: NAV_SLUG },
    );
  }

  // Recurrence ledger: stamp this week against every fingerprint that
  // produced a post (or rode along in the mailbag). After three consecutive
  // weeks, the bucket's normal-lane visibility flips off until a quiet week
  // breaks the streak. Trade-offer and whisper-back buckets are exempt — see
  // bucketFingerprint() in schefter-bucket-logic.mjs.
  if (!DRY_RUN) {
    try {
      const consumedBuckets = buildTopicBuckets(consumedBatch);
      const stampedFingerprints = [];
      for (const b of consumedBuckets) {
        const fp = bucketFingerprint(b);
        if (!fp) continue;
        // Per-bucket tipster roster (web-only — groupme/trade_offer don't
        // carry a hashedOwnerId). The ledger merges this list into its
        // running tipsterHashes set so feature 10's memory recall can
        // detect when a "different voice" returns to an old fingerprint.
        const tipsterHashes = [];
        for (const t of b.tips) {
          if (t?.source === 'web' && typeof t.hashedOwnerId === 'string' && t.hashedOwnerId) {
            tipsterHashes.push(t.hashedOwnerId);
          }
        }
        markFingerprintSeen(recurrenceLedger, fp, currentIsoWeek, now.toISOString(), tipsterHashes);
        stampedFingerprints.push(fp);
      }
      if (stampedFingerprints.length > 0) {
        saveLedger(recurrenceLedger, ledgerPathAbs);
        log(`  [recurrence] Marked ${currentIsoWeek} for: ${stampedFingerprints.join(', ')}`);
      }
    } catch (err) {
      warn(`  [recurrence] update failed: ${err.message} — ledger unchanged`);
    }
  }

  // Redis updates: bump the daily budgets when a post shipped, set last post
  // ts, rewrite queue with leftovers from unchosen buckets, and record
  // processed tips for audit.
  try {
    // BUDGET-ON-DELIVERY SENTINEL — every daily budget here counts DELIVERED
    // posts only (posts_today, gossip cap, mailbag-done, spacing anchor). A
    // fully-suppressed cycle must consume NOTHING: a ~7am suppressed beat
    // once burned the day's gossip slot (and, earlier, the 4h spacing
    // anchor) and silenced the rumor mill for the whole day — see the
    // July 2026 AFL-launch post-mortem. LLM attempt-rate stays bounded
    // without an attempt-based counter: each tip gets MAX_SUPPRESSED_STRIKES
    // generation attempts before dropping, held tips age out at MAX_HELD_MS,
    // and quiet hours block 8h/day. tests/schefter-gossip-budget.test.ts
    // greps for this sentinel — do not delete it without replacing the
    // coverage.
    // Attempt counter (LLM safety valve) — the ONE counter that runs on
    // every generation cycle, delivered or suppressed. Not a posting
    // budget; see checkGates 2b.
    const genAttempts = await redis.incr(RUMOR_GEN_ATTEMPTS_TODAY_KEY);
    if (genAttempts === 1) {
      await redis.expire(RUMOR_GEN_ATTEMPTS_TODAY_KEY, secondsUntilPtMidnight(now));
    }

    if (postKind === 'mailbag') {
      // Once-per-Friday ATTEMPT marker — deliberately NOT delivery-gated,
      // unlike the posting budgets below. A suppressed mailbag re-firing
      // every 15-min cycle would strike every swept gossip tip to
      // exhaustion within the hour, wiping the very backlog the mailbag
      // exists to preserve. One attempt per Friday; a suppressed sweep's
      // tips keep one strike and surface via the normal lane or next week.
      await redis.set(FRIDAY_MAILBAG_DONE_KEY, todayPtDate, { ex: 48 * 60 * 60 });
      log(`  [mailbag] Marked done for ${todayPtDate}${allowedPosts.length === 0 ? ' (suppressed — attempt still consumed to protect the swept tips)' : ''}`);
    }

    let newCount = null;
    if (allowedPosts.length > 0) {
      newCount = await redis.incr(RUMOR_POSTS_TODAY_KEY);
      if (newCount === 1) {
        await redis.expire(RUMOR_POSTS_TODAY_KEY, secondsUntilPtMidnight(now));
      }
      // The mill's own counter, on the same BUDGET-ON-DELIVERY rule as the
      // shared one above. Incremented once per delivering CYCLE, matching the
      // shared budget: a busy-morning or gossip double-post is two feed
      // entries against one slot by design, and that pairing only ever
      // happens where the cap is above one.
      const newMillCount = await redis.incr(RUMOR_MILL_POSTS_TODAY_KEY);
      if (newMillCount === 1) {
        await redis.expire(RUMOR_MILL_POSTS_TODAY_KEY, secondsUntilPtMidnight(now));
      }
      log(
        `  Rumor-mill counter: now ${newMillCount}/` +
          `${rumorMillDailyCap(LEAGUE_SLUG, now, MAX_POSTS_PER_DAY)} ` +
          `(${rumorMillCapReason(LEAGUE_SLUG, now)})`,
      );

      // The TRADE counter, shared with the speculation lane. Incremented per
      // delivered trade BEAT, not once per cycle like the two counters above:
      // those two are post budgets and a double-post is two entries against
      // one slot by design, whereas this is a topic ceiling and a reader
      // counts stories, not cycles.
      const deliveredTradeBeats = allowedBeats.filter((b) => isTradeFlavoredBatch(b.batch)).length;
      if (deliveredTradeBeats > 0) {
        const newTradeCount = await redis.incrby(RUMOR_TRADE_POSTS_TODAY_KEY, deliveredTradeBeats);
        if (newTradeCount === deliveredTradeBeats) {
          await redis.expire(RUMOR_TRADE_POSTS_TODAY_KEY, secondsUntilPtMidnight(now));
        }
        log(`  Trade-story counter: now ${newTradeCount}/${MAX_TRADE_POSTS_PER_DAY} for the PT day`);
      }

      // Trade-offer repost cooldown anchor — stamped HERE, on delivery, not
      // where the tip was enqueued. scanTradeOffers only queues; roughly half
      // of the offers that pass the dice roll never become their own post, and
      // stamping at enqueue silences an offer for 7 days over a post nobody
      // read. Tip ids are `to_<offerId>` (redact-trade-offer.mjs), so the
      // consumed batch is the authoritative list of offers actually reported.
      const reportedOfferIds = [
        ...new Set(
          consumedBatch
            .filter((t) => t?.source === 'trade_offer' && typeof t.id === 'string')
            // Strip the prefix EXPLICITLY rather than by offset: a bare
            // slice(3) silently yields a garbage key if the id shape ever
            // changes, and a garbage key means no cooldown at all.
            .map((t) => (t.id.startsWith('to_') ? t.id.slice('to_'.length) : ''))
            .filter(Boolean),
        ),
      ];
      if (reportedOfferIds.length > 0) {
        try {
          await redis.hset(
            OFFER_LAST_POST_KEY,
            Object.fromEntries(reportedOfferIds.map((id) => [id, String(now.getTime())])),
          );
          await redis.expire(OFFER_LAST_POST_KEY, OFFER_STATE_TTL_SEC);
          log(`  Repost cooldown stamped for offer(s): ${reportedOfferIds.join(', ')}`);
        } catch (err) {
          warn(`  hset(last_post) failed: ${err.message} — offer(s) may re-post tomorrow`);
        }
      }
      if (postKind === 'gossip') {
        const newGossipCount = await redis.incr(RUMOR_GOSSIP_POSTS_TODAY_KEY);
        if (newGossipCount === 1) {
          await redis.expire(RUMOR_GOSSIP_POSTS_TODAY_KEY, secondsUntilPtMidnight(now));
        }
        log(`  Gossip counter: now ${newGossipCount}/${adaptiveGossipCap}`);
      }
      // Spacing anchor — starts the 4h chat-cadence clock from this delivery.
      await redis.set(RUMOR_LAST_POST_TS_KEY, now.getTime());
    } else {
      log('  Suppressed cycle — no daily budget consumed (posts_today, mill_posts_today, gossip cap, spacing all unchanged)');
    }

    // Remove consumed tips from the queue while preserving (a) tips in
    // unchosen buckets and (b) tips held back by the quality gate (Option A —
    // suppressed but not yet strike-exhausted). We replace the list
    // atomically: DEL then RPUSH each surviving JSON string back. Any tip
    // that arrived between LRANGE and now would be lost — acceptable at
    // our 15 min cadence.
    const requeueTips = [...unusedTips, ...heldTipsForRequeue];
    await redis.del(TIPS_QUEUE_KEY);
    if (requeueTips.length > 0) {
      const serialized = requeueTips.map((t) => JSON.stringify(t));
      await redis.rpush(TIPS_QUEUE_KEY, ...serialized);
      // Keep first_tip_ts anchored at the OLDEST surviving tip so the
      // marinate gate still gates the next cycle accurately — tips that
      // have already sat longer than MIN_MARINATE_MS stay eligible.
      const oldest = requeueTips.reduce(
        (acc, t) => Math.min(acc, t.submittedAt ?? Date.now()),
        Number.MAX_SAFE_INTEGER,
      );
      if (Number.isFinite(oldest)) {
        await redis.set(FIRST_TIP_TS_KEY, oldest);
      }
      log(`  Queue requeued ${requeueTips.length} tip(s) for next cycle (${unusedTips.length} unchosen-bucket + ${heldTipsForRequeue.length} held; oldest submittedAt=${new Date(oldest).toISOString()})`);
    } else {
      await redis.del(FIRST_TIP_TS_KEY);
    }

    // Processed audit list (TTL 24h) — covers consumed tips only. Held and
    // strike-exhausted tips do not enter the processed archive on this
    // cycle (they will when their post finally ships, or never if dropped).
    const archiveTipIds = [...consumedTipIds, ...heldTipsExhausted.map((t) => t.id)];
    if (archiveTipIds.length > 0) {
      await redis.lpush(TIPS_PROCESSED_KEY, ...archiveTipIds);
      await redis.expire(TIPS_PROCESSED_KEY, PROCESSED_TTL_SEC);
    }

    // Phase 10 — hash_for_tip index. The weekly tip-of-the-week script needs to
    // resolve each contributing tipId back to a hashedOwnerId to award badges.
    // We TTL these at 14 days so the weekly job has a generous window even if
    // it runs a day or two late. Held tips are skipped — they get indexed if
    // and when their post eventually ships. Covers both beats of a two-beat
    // gossip post plus every tip swept into a Friday mailbag.
    for (const tip of consumedBatch) {
      if (tip && tip.source === 'web' && typeof tip.hashedOwnerId === 'string' && tip.hashedOwnerId.length > 0) {
        try {
          await redis.set(
            globalSchefterKey('tipsterHashForTip', tip.id),
            tip.hashedOwnerId,
            { ex: 14 * 24 * 60 * 60 },
          );
        } catch (err) {
          warn(`  [hash-for-tip] set failed for ${tip.id}: ${err.message}`);
        }
      }
    }

    // Tip receipts for the happy path. `allowedBeats` and `allowedPosts` are
    // filtered from the same index set, so beat j is the batch behind post j
    // — that pairing is what lets the receipt carry a postId the tip page
    // can link straight to.
    for (let j = 0; j < allowedBeats.length; j++) {
      const postId = allowedPosts[j]?.id ?? null;
      for (const tip of allowedBeats[j].batch ?? []) {
        await recordTipReceipt(redis, tip, { status: 'published', postId });
      }
    }

    // Roger riff / morning greeting date stamps. Both ride on beat 0, so
    // they only burn their once-a-day slot when beat 0 actually shipped —
    // a suppressed beat never fired the greeting or the riff. 48h TTLs so
    // clock skew can't strand the keys.
    const beatZeroShipped = allowedIndexSet.has(0);
    if (hadRogerRiff && beatZeroShipped) {
      await redis.set(ROGER_LAST_RIFF_DATE_KEY, todayPt, { ex: 48 * 60 * 60 });
    }
    if (morningGreeting && beatZeroShipped) {
      await redis.set(MORNING_GREETING_DATE_KEY, todayPt, { ex: 48 * 60 * 60 });
    }

    log(`  Redis updated: posts_today=${newCount ?? 'unchanged'}, queue drained, processed archived${hadRogerRiff && beatZeroShipped ? ', roger riff date stamped' : ''}${morningGreeting && beatZeroShipped ? ', morning greeting stamped' : ''}`);
  } catch (err) {
    warn(`  Redis post-write update failed: ${err.message}`);
  }

  // Phase 7 — thread registry. If a post joined an existing thread (or
  // started one from a whisper-back), record it in Redis so future
  // follow-ups can look up the thread and the permalink page can render
  // the chain. Each beat has its own (possibly null) threadId, so we
  // loop and treat them independently. Held / suppressed posts never
  // shipped, so they don't enter the thread registry.
  for (const p of allowedPosts) {
    if (!p.threadId) continue;
    const threadId = p.threadId;
    const dominantParentId = parentIdByPostId.get(p.id);
    try {
      const threadZsetKey = globalSchefterKey('thread', threadId);
      const threadOfParentKey = globalSchefterKey('threadOf', dominantParentId);
      const threadOfNewKey = globalSchefterKey('threadOf', p.id);
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
  // scorecard failure cannot block the post from shipping. Held / suppressed
  // tips are excluded — they get credit if and when their post eventually
  // ships from a future cycle.
  try {
    const seasonYear = getSeasonYearForTipster(now);
    await incrementTipsterCounters({
      redis,
      batch: consumedBatch,
      seasonYear,
      navSlug: NAV_SLUG,
      dryRun: DRY_RUN,
      log,
      warn,
    });
  } catch (err) {
    warn(`  [tipster-counters] hook failed: ${err.message}`);
  }

  // Per-tipster topic histogram — feeds buildTipsterContext on subsequent
  // cycles so the "standing beat" (HARD RULE 24) can be derived. Same
  // failure stance as above: a counter error never blocks the post.
  try {
    await incrementTipsterTopicCounters({
      redis,
      batch: consumedBatch,
      navSlug: NAV_SLUG,
      dryRun: DRY_RUN,
      log,
      warn,
    });
  } catch (err) {
    warn(`  [tipster-topic-counters] hook failed: ${err.message}`);
  }

  // Return DELIVERED posts, not generated beats — the "Posts written" line
  // this feeds once claimed 1 on a fully-suppressed cycle, which read like a
  // post had shipped and vanished.
  if (builtPosts.length > allowedPosts.length) {
    log(`  Cycle result: ${allowedPosts.length} shipped, ${builtPosts.length - allowedPosts.length} suppressed`);
  }
  return allowedPosts.length;
}

/**
 * Returns the 4-digit league year for tipster counters. Mirrors the
 * getCurrentLeagueYear() semantics from src/utils/league-year.ts — league
 * year advances after Feb 14 @ 8:45 PT. Kept inline here so the scanner
 * stays in pure-Node .mjs without importing the .ts module.
 */
function getSeasonYearForTipster(now = new Date()) {
  // Driven by the registry's per-league rollover date so the scanner (which
  // WRITES season-scoped keys) and the API layer (schefterSeasonYear, which
  // READS them) always agree — a hardcoded fork here would split the season
  // leaderboard the moment the registry date changed. Comparison is done on
  // Pacific-Time date parts, matching src/utils/league-year.ts semantics.
  const rollover = getLeagueBySlug(LEAGUE_SLUG)?.leagueYearRollover ?? { month: 2, day: 14 };
  const pt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const year = pt.getFullYear();
  const flipped =
    pt.getMonth() + 1 > rollover.month ||
    (pt.getMonth() + 1 === rollover.month && pt.getDate() >= rollover.day);
  return flipped ? year : year - 1;
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
    .then(async (count) => {
      await flushGroupMeSuppressions();
      log(`\n=== Done. Posts written: ${count} ===`);
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[rumor-scan] Fatal:', err);
      try { await flushGroupMeSuppressions(); } catch {}
      process.exit(1);
    });
}
