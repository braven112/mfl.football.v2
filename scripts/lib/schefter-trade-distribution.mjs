/**
 * Where a trade rumor GOES — the feed always, the group chat rarely.
 *
 * Until 2026-09-08 every rumor-mill beat was one thing: a feed post AND a
 * GroupMe ping, delivered together, gated together. Making the chat quiet
 * therefore meant making the REPORT quiet, and the September rarity gates did
 * exactly that — the mill fell to one post a day in season, so the Schefter
 * Report had almost nothing in it and the chat still got every one of them.
 * That is backwards in both directions: owners open the report expecting to
 * find something, and they open the chat hoping not to be pinged again.
 *
 * So the two channels split. For the TRADE LANES — live proposals
 * (`trade_offer`) and trade-block listings (`trade_bait`) — the beat is
 * FEED-FIRST:
 *
 *   - the feed post has NO daily budget at all. Trade volume is already
 *     bounded upstream, per offer, by the once-a-day dice roll and the repost
 *     cooldown in redact-trade-offer.mjs — the daily post caps were a second,
 *     blunter throttle on top of a lane that was already rationed.
 *   - the group chat gets a HANDFUL A WEEK, and only for a beat that scores
 *     high enough to be worth a whole league's phones. See
 *     `resolveTradeChatPing`.
 *
 * Nothing here touches the gossip lane, the Friday mailbag, the quiet-day
 * post or the transaction scanner. Those still spend the shared budget and
 * still ping the chat on every delivery — a tip an owner wrote by hand is the
 * chat's business, and there is at most one of those a day anyway.
 *
 * Web push is NOT part of this split. It stays on every delivered beat,
 * trade lane included: push is opt-in per category and per owner
 * (/<league>/notifications), so the owner who wants every rumor already has
 * the switch for it, and the owner who does not has already turned it off.
 */

import { isLeagueSeasonOpen } from './schefter-rumor-cadence.mjs';
import { isTradeDeadlineWindow } from '../../src/utils/trade-deadline.mjs';

/**
 * The tip sources that make a beat a TRADE beat.
 *
 * Source, not bucket kind: `classifyTipKind` calls a trade-block listing
 * 'gossip' (it buckets per franchise, like a topic tip), so keying the split
 * off the bucket would have left half the trade lane in the chat.
 */
export const TRADE_LANE_SOURCES = Object.freeze(['trade_offer', 'trade_bait']);

const TRADE_LANE_SOURCE_SET = new Set(TRADE_LANE_SOURCES);

/** Is this one tip from a trade lane? */
export function isTradeLaneTip(tip) {
  return Boolean(tip) && TRADE_LANE_SOURCE_SET.has(tip.source);
}

/**
 * Is this whole delivered batch a trade beat?
 *
 * EVERY tip has to be a trade tip, and there has to be at least one. A cycle
 * that mixes an owner's gossip tip into a trade post is partly the chat's
 * business, so it takes the standard path — under-claiming the split costs one
 * extra chat post, over-claiming silently mutes a tip somebody wrote by hand.
 */
export function isTradeLaneBatch(tips) {
  return Array.isArray(tips) && tips.length > 0 && tips.every(isTradeLaneTip);
}

/**
 * The gate failures a trade beat may walk past.
 *
 * These three are CHAT budgets — the shared daily ping allowance, the rumor
 * mill's own daily cap, and the four-hour spacing between pings. A feed-only
 * beat spends none of them, so being blocked by one is not a reason to hold
 * the post; it is a reason to publish it without the ping.
 *
 * Everything else still stops the cycle for every lane:
 *   - `quiet-hours`   — a 3am beat reads as a bot, whatever channel it is in.
 *   - `gen-attempts`  — the LLM spend ceiling, not a cadence rule.
 *   - `marinate` / `no-anchor` — the tip is not ready to report yet.
 */
export const FEED_ONLY_BYPASSABLE_GATES = Object.freeze([
  'shared-budget',
  'mill-cap',
  'spacing',
]);

const BYPASSABLE = new Set(FEED_ONLY_BYPASSABLE_GATES);

/** May the trade lane continue past this gate as a feed-only cycle? */
export function tradeLaneMayBypass(blockedBy) {
  return BYPASSABLE.has(blockedBy);
}

/** The rolling window the weekly chat allowance is measured over. */
export const TRADE_CHAT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How good a beat has to be to earn the whole league's phones.
 *
 * The publish bar is QUALITY_THRESHOLD (6), or RELAXED_QUALITY_THRESHOLD (3)
 * on a quiet week — that decides whether a post is worth READING. This is a
 * different question: worth INTERRUPTING for. 8+ is the scorer's own band for
 * a concrete, named, genuinely new development, so the week's ping goes to a
 * real story rather than to whichever routine beat happened to come first.
 *
 * A null score never pings. The scorer returns null when it could not run (no
 * API key, an API error) and the publish path treats that as allow — failing
 * open on the feed costs a mediocre post, failing open on the chat costs the
 * league's attention, so this half fails CLOSED.
 */
export const TRADE_CHAT_MIN_SCORE = 8;

/** Chat pings per rolling week while a season is being played. */
export const IN_SEASON_TRADE_CHAT_PER_WEEK = 1;

/**
 * Chat pings per rolling week in the offseason — and through the run-up to
 * each league's trade deadline.
 *
 * Same inversion the rumor mill's daily cap runs on, for the same reason: in
 * the offseason the trade market IS the league's conversation, and at the
 * deadline it is the story. Both are the times owners want to be interrupted
 * about a trade.
 */
export const OFFSEASON_TRADE_CHAT_PER_WEEK = 3;

/**
 * This league's trade-chat allowance, in pings per rolling week.
 *
 * Reuses the rumor mill's own season and deadline helpers rather than
 * re-deriving either. The season window runs kickoff → championship Monday
 * and the deadline is per league; both traps are documented in
 * schefter-rumor-cadence.mjs and src/utils/trade-deadline.mjs, and there is
 * no version of this question those two do not already answer.
 */
export function tradeChatWeeklyAllowance(slug, now = new Date()) {
  if (!isLeagueSeasonOpen(now)) return OFFSEASON_TRADE_CHAT_PER_WEEK;
  if (isTradeDeadlineWindow(slug, now)) return OFFSEASON_TRADE_CHAT_PER_WEEK;
  return IN_SEASON_TRADE_CHAT_PER_WEEK;
}

/** A short label for why the allowance is what it is — logged on every check. */
export function tradeChatAllowanceReason(slug, now = new Date()) {
  if (!isLeagueSeasonOpen(now)) return 'offseason';
  if (isTradeDeadlineWindow(slug, now)) return 'trade-deadline window';
  return 'in season';
}

/**
 * The minimum gap between two trade chat pings.
 *
 * The weekly allowance alone would let all three of an offseason week's pings
 * land in one afternoon and then go silent for six days, which is the pile-up
 * the whole exercise is meant to remove — an owner reads three trade rumors
 * back to back as one spam burst, not as three stories. Spreading them is
 * what makes "a few a week" feel like a few a week.
 */
export function tradeChatMinGapMs(allowance) {
  const n = Number.isFinite(allowance) && allowance > 0 ? allowance : 1;
  return Math.floor(TRADE_CHAT_WINDOW_MS / n);
}

/** Timestamps inside the rolling window, newest first. */
export function recentChatPings(log, nowMs) {
  if (!Array.isArray(log)) return [];
  return log
    .map((ms) => Number(ms))
    .filter((ms) => Number.isFinite(ms) && ms > 0 && nowMs - ms < TRADE_CHAT_WINDOW_MS)
    .sort((a, b) => b - a);
}

/**
 * Which of this cycle's beats — if any — also goes to the group chat.
 *
 * Pure: the scanner reads Redis, this decides. Returns the chosen index into
 * `candidates` (or -1) plus a reason, which is logged either way. A lane that
 * posts nothing and says nothing is indistinguishable from a broken one.
 *
 * @param {object} args
 * @param {Array<{index:number, score:number|null}>} args.candidates
 *   The cycle's ALLOWED posts and their quality scores, in delivery order.
 * @param {number} args.nowMs
 * @param {number[]} args.chatLog     Past trade-chat ping timestamps (epoch ms).
 * @param {number} args.allowance     From `tradeChatWeeklyAllowance`.
 * @param {number} args.postsToday    The shared daily chat budget, spent so far.
 * @param {number} args.maxPostsPerDay
 * @param {number} args.lastPostTs    Last chat ping of ANY lane (epoch ms).
 * @param {number} args.minSpacingMs
 */
export function resolveTradeChatPing({
  candidates = [],
  nowMs = Date.now(),
  chatLog = [],
  allowance = IN_SEASON_TRADE_CHAT_PER_WEEK,
  postsToday = 0,
  maxPostsPerDay = Infinity,
  lastPostTs = 0,
  minSpacingMs = 0,
}) {
  if (candidates.length === 0) return { index: -1, score: null, reason: 'nothing shipped' };

  const recent = recentChatPings(chatLog, nowMs);
  if (recent.length >= allowance) {
    return {
      index: -1,
      score: null,
      reason: `weekly allowance spent (${recent.length}/${allowance} in the last 7d)`,
    };
  }

  const gapMs = tradeChatMinGapMs(allowance);
  if (recent.length > 0 && nowMs - recent[0] < gapMs) {
    const hoursLeft = (gapMs - (nowMs - recent[0])) / 3600000;
    return {
      index: -1,
      score: null,
      reason: `${hoursLeft.toFixed(1)}h left of the ${(gapMs / 3600000).toFixed(0)}h gap between chat pings`,
    };
  }

  // The shared budget and the spacing clock govern the CHAT, so a ping obeys
  // them even though the feed post beside it does not. A trade rumor landing
  // ten minutes after a gossip post is the same pile-up from two lanes.
  if (postsToday >= maxPostsPerDay) {
    return { index: -1, score: null, reason: `shared chat budget spent (${postsToday}/${maxPostsPerDay})` };
  }
  if (lastPostTs > 0 && nowMs - lastPostTs < minSpacingMs) {
    const minsLeft = (minSpacingMs - (nowMs - lastPostTs)) / 60000;
    return { index: -1, score: null, reason: `${minsLeft.toFixed(0)}m left of chat spacing` };
  }

  // Best beat wins — ties go to the earlier one, which is the one the cycle
  // led with. A null score is not a low score; it never pings.
  let best = null;
  for (const c of candidates) {
    if (!Number.isFinite(c?.score)) continue;
    if (c.score < TRADE_CHAT_MIN_SCORE) continue;
    if (!best || c.score > best.score) best = c;
  }
  if (!best) {
    return {
      index: -1,
      score: null,
      reason: `no beat cleared the chat bar (${TRADE_CHAT_MIN_SCORE}/10)`,
    };
  }
  return { index: best.index, score: best.score, reason: `scored ${best.score}/10 — spending a chat ping` };
}
