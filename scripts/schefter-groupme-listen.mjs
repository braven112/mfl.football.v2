#!/usr/bin/env node
/**
 * Schefter GroupMe Listener (Phase 3)
 *
 * Fetches recent GroupMe messages, detects @Schefter / @Claude mentions,
 * and injects them into the same `schefter:tips:queue` that the web tip form
 * feeds. This is NOT a standalone cron — it's invoked inline at the top of
 * scripts/schefter-rumor-scan.mjs so every rumor-mill cycle picks up fresh
 * GroupMe activity with zero latency. One cron, two input sources.
 *
 * Watermark: schefter:groupme:last_mention_id (NEVER expires — it's a cursor).
 * Audit list: schefter:groupme:recent_mentions (TTL 24h) for debugging.
 *
 * Bot filtering: the Schefter + Roger bots' sender_ids are excluded so we
 * don't ingest our own posts. Any message with sender_type === 'bot' is also
 * skipped (belt + suspenders).
 *
 * This module exports `ingestGroupMeMentions({ redis, dryRun })` — keep it
 * dependency-light so the scanner can call it without extra setup.
 */

const GROUPME_API_BASE = 'https://api.groupme.com/v3';

// Redis keys
const TIPS_QUEUE_KEY = 'schefter:tips:queue';
const FIRST_TIP_TS_KEY = 'schefter:tips:first_tip_ts';
const WATERMARK_KEY = 'schefter:groupme:last_mention_id';
const RECENT_MENTIONS_KEY = 'schefter:groupme:recent_mentions';
const RECENT_MENTIONS_TTL_SEC = 24 * 60 * 60;
const MAX_RECENT_MENTIONS = 50;

// Native-reply detection: cache of recent Schefter-bot GroupMe message IDs.
// When a user hits GroupMe's reply UI on one of these messages, the reply
// message carries an attachment `{type:'reply', reply_id, base_reply_id}`.
// We resolve that reply_id against this cache so replies become tips without
// requiring the name ("schefter", "claude") in the body.
const BOT_MESSAGE_IDS_KEY = 'schefter:groupme:bot_message_ids';
const BOT_MESSAGE_IDS_TTL_SEC = 48 * 60 * 60; // 48h — GroupMe replies older than this are rare
const MAX_TRACKED_BOT_MESSAGES = 50;

// Style-Book tracker: counts of personal attacks directed at Schefter himself
// in the group chat. Lifetime counter + per-season counter + leaderboard ZSET
// + last-shot timestamp. When a new tip is classified as an attack, these
// keys are updated in the same transaction that pushes to the tips queue,
// and the tip gains `attackOnSchefter: true` plus the current `styleBookCount`
// so the LLM can escalate the Style Book bit with running-total flavor.
const STYLE_BOOK_LIFETIME_PREFIX = 'schefter:style_book:';
const STYLE_BOOK_SEASON_PREFIX = 'schefter:style_book:season:';
const STYLE_BOOK_LAST_SHOT_PREFIX = 'schefter:style_book:last_shot_at:';
const STYLE_BOOK_LEADERBOARD_PREFIX = 'schefter:style_book:leaderboard:';

// Regex patterns (case-insensitive)
// "claude schefter" > "schefter" > "schefty" > "claude" — match all, we only count once.
// "schefty" is the affectionate group-chat nickname for the bot.
const PATTERN_CLAUDE_SCHEFTER = /\bclaude\s+schefter\b/i;
const PATTERN_SCHEFTER = /\bschefter\b/i;
const PATTERN_SCHEFTY = /\bschefty\b/i;
const PATTERN_CLAUDE = /\bclaude\b/i;

// Ack phrases that should NOT trigger (false-positive guard)
// "Roger that", "Roger dodger", "10-4 Roger", "yeah roger" — but these are
// all Roger-targeted, not Claude/Schefter-targeted. We still check for analogous
// usage of "schefter/claude" to be safe ("that's good schefter-level reporting").
// In practice the main risk is someone saying "yeah claude that's right" as an
// ack. We treat "(yeah|ok|thanks|thx) (claude|schefter)" as potential acks and
// require an additional signal (?, early position, or comma/colon after the name).
const ACK_PRECEDERS = /(?:\b(?:yeah|yep|yup|ok|okay|thanks|thx|cool|nice|good|sweet|right)\s+)$/i;

function log(...args) {
  console.log('[schefter-listen]', ...args);
}
function warn(...args) {
  console.warn('[schefter-listen]', ...args);
}

/**
 * Detect whether a message text is directed at Schefter/Claude. Returns the
 * matched name variant + reason, or null if no mention.
 *
 * Guardrails (at least one must be true once a match is found):
 *  - Name appears within the first 5 words of the message
 *  - Name is immediately followed by `,` or `:`
 *  - Message contains `?`
 *
 * Hard rejects:
 *  - Preceded by ack phrase ("yeah claude ...", "thanks schefter")
 *  - Trimmed length < 5 chars
 *  - Name is "Roger"-style ack ("roger that" etc) — we don't match Roger here
 *    at all, so this is moot for our patterns.
 */
export function detectMention(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const text = rawText.trim();
  if (text.length < 5) {
    return { match: false, reason: 'too-short' };
  }

  // Find first match (prefer most specific)
  let matchInfo = null;
  const csMatch = text.match(PATTERN_CLAUDE_SCHEFTER);
  if (csMatch) {
    matchInfo = { variant: 'claude schefter', index: csMatch.index ?? 0, length: csMatch[0].length };
  } else {
    const sMatch = text.match(PATTERN_SCHEFTER);
    if (sMatch) {
      matchInfo = { variant: 'schefter', index: sMatch.index ?? 0, length: sMatch[0].length };
    } else {
      const styMatch = text.match(PATTERN_SCHEFTY);
      if (styMatch) {
        matchInfo = { variant: 'schefty', index: styMatch.index ?? 0, length: styMatch[0].length };
      } else {
        const cMatch = text.match(PATTERN_CLAUDE);
        if (cMatch) {
          matchInfo = { variant: 'claude', index: cMatch.index ?? 0, length: cMatch[0].length };
        }
      }
    }
  }

  if (!matchInfo) return { match: false, reason: 'no-name' };

  // Ack-preceder check
  const prefix = text.slice(0, matchInfo.index);
  if (ACK_PRECEDERS.test(prefix)) {
    return { match: false, reason: `ack-preceder ("${prefix.trim().split(/\s+/).slice(-2).join(' ')} ${matchInfo.variant}")` };
  }

  // Guard signals — need at least one
  const words = text.split(/\s+/);
  const wordIndexOfMatch = prefix.split(/\s+/).filter(Boolean).length; // 0-indexed
  const inEarlyWords = wordIndexOfMatch < 5;

  const afterMatchChar = text.charAt(matchInfo.index + matchInfo.length);
  const followedByPunct = afterMatchChar === ',' || afterMatchChar === ':';

  const hasQuestion = text.includes('?');

  if (!(inEarlyWords || followedByPunct || hasQuestion)) {
    return { match: false, reason: `weak-signal (wordIdx=${wordIndexOfMatch}, after="${afterMatchChar}", q=${hasQuestion})` };
  }

  return {
    match: true,
    variant: matchInfo.variant,
    signals: {
      inEarlyWords,
      followedByPunct,
      hasQuestion,
      wordIndex: wordIndexOfMatch,
    },
    totalWords: words.length,
  };
}

/**
 * Validate a native-reply's content (no name required — the reply attachment
 * itself is the signal that this was directed at Schefter). Guards against
 * low-effort reactions so "lol" and "🔥" don't enqueue as tips.
 */
export function validateReplyContent(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { valid: false, reason: 'no-text' };
  }
  const text = rawText.trim();
  if (text.length < 5) {
    return { valid: false, reason: 'too-short' };
  }

  // Strip emoji + trailing punctuation, then re-check length for things like
  // "ok!!!" or "👍👍👍" that clear the 5-char bar only via noise.
  const stripped = text
    .replace(/[\p{Extended_Pictographic}]/gu, '')
    .replace(/[!?.,:;\s]+/g, ' ')
    .trim();
  if (stripped.length < 5) {
    return { valid: false, reason: 'too-short-after-strip' };
  }

  // Whole-message ack pattern: if the entire reply is a single low-effort
  // token (with optional repetition like "hahaha" / "hehehe"), reject it.
  // `(ha){2,}` handles "haha", "hahaha", "hahahaha"; `haha+` catches
  // stretched variants like "hahaaaa".
  const LOW_EFFORT =
    /^(lol|lmao|lmfao|yeah|yea|yes|no|ok|okay|kk|thanks|thx|nice|cool|sweet|good|sure|yep|yup|right|correct|agreed|ty|thnx|hmm+|(ha){2,}|haha+|(he){2,}|hehe+|heh|true|word|facts|fr|nah|bet|same)$/i;
  if (LOW_EFFORT.test(stripped.replace(/\s+/g, ''))) {
    return { valid: false, reason: 'low-effort-ack' };
  }

  return { valid: true };
}

// Pejoratives that count as "attacking the bot". Kept simple on purpose —
// false positives are tolerated (the bit is affectionate anyway), false
// negatives cost nothing (the tip still gets processed normally).
// Patterns match whole words or "a/an X" forms; case-insensitive.
const ATTACK_PEJORATIVES = [
  'sucks',
  'suck',
  'bitch',
  'hack',
  'trash',
  'garbage',
  'dumb',
  'stupid',
  'fake',
  'wrong',
  'useless',
  'lame',
  'clown',
  'joke',
  'idiot',
  'moron',
  'fraud',
  'bullshit',
  'bullshitter',
  'liar',
  'lies',
  'worst',
  'terrible',
  'awful',
  'pathetic',
];

// Subject patterns — the attack has to be about Schefter/the bot, not just
// contain a pejorative somewhere in the message.
const ATTACK_SUBJECT_PATTERNS = [
  /\bclaude\s+schefter\b/i,
  /\bschefter\b/i,
  /\bschefty\b/i,
  /\bclaude\b/i,
  /\bthe\s+bot\b/i,
  /\bthis\s+bot\b/i,
  /\bthat\s+bot\b/i,
];

// Negation guards — if the attack keyword is preceded by "not " / "isn't " /
// "ain't " within 2 words, ignore it. Handles "that's not bad", "ain't wrong",
// "schefter isn't dumb", etc.
const NEGATION_WINDOW_WORDS = 2;
const NEGATION_TOKENS = new Set([
  'not',
  "isn't",
  "ain't",
  'aint',
  'never',
  "wasn't",
  'no',
  "doesn't",
  'doesnt',
]);

/**
 * Detect whether a GroupMe message is a personal attack on Schefter himself.
 * Returns `{ attack: true, keyword, reason }` when a pejorative referring to
 * the bot is found; `{ attack: false, reason }` otherwise.
 *
 * This is intentionally loose — false positives are OK because the Style Book
 * bit is affectionate ribbing either way. The only thing we really guard
 * against is matching generic negativity that isn't aimed at Schefter.
 *
 * Requirements for a match:
 *  - Message mentions Claude/Schefter/Schefty/"the bot"
 *  - Message contains at least one pejorative from ATTACK_PEJORATIVES
 *  - The pejorative is not preceded by a negation token within the prior 2 words
 */
export function detectAttackOnSchefter(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { attack: false, reason: 'no-text' };
  }
  const text = rawText.trim();
  if (text.length < 5) {
    return { attack: false, reason: 'too-short' };
  }

  // Must reference Schefter/Claude/the bot somewhere
  const subjectMatch = ATTACK_SUBJECT_PATTERNS.some((re) => re.test(text));
  if (!subjectMatch) {
    return { attack: false, reason: 'no-subject' };
  }

  // Tokenize for negation window scanning
  const lowerTokens = text
    .toLowerCase()
    .replace(/[^\w'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (let i = 0; i < lowerTokens.length; i++) {
    const tok = lowerTokens[i];
    if (!ATTACK_PEJORATIVES.includes(tok)) continue;

    // Check for a negation token within NEGATION_WINDOW_WORDS prior tokens
    let negated = false;
    for (let j = Math.max(0, i - NEGATION_WINDOW_WORDS); j < i; j++) {
      if (NEGATION_TOKENS.has(lowerTokens[j])) {
        negated = true;
        break;
      }
    }
    if (negated) continue;

    return { attack: true, keyword: tok, reason: 'pejorative-match' };
  }

  return { attack: false, reason: 'no-pejorative' };
}

/**
 * Normalize a GroupMe display name into a Redis-safe author key. Lowercases,
 * trims, and strips any non-alphanumeric characters. Keeps the ID readable
 * (no hashing) because GroupMe authorship is already public — the leaderboard
 * will display these names directly.
 */
export function normalizeAuthorKey(name) {
  if (!name || typeof name !== 'string') return '';
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/**
 * Compute the league year for style-book counters. Mirrors the rumor-scan's
 * getSeasonYearForTipster — advances on Feb 14 @ 8:45 PT (= Feb 15 04:45 UTC).
 */
function getStyleBookSeasonYear(now = new Date()) {
  const calendarYear = now.getUTCFullYear();
  const febCutoff = Date.UTC(calendarYear, 1, 15, 4, 45, 0, 0);
  return now.getTime() >= febCutoff ? calendarYear : calendarYear - 1;
}

/**
 * Increment the Style Book counters for a named attacker. Returns the new
 * seasonal count (used for LLM escalation) or null on failure. Best-effort —
 * a Redis failure here should never block tip enqueue.
 */
async function bumpStyleBookCounters(redis, authorKey, displayName, nowMs) {
  if (!redis || !authorKey) return null;
  const year = getStyleBookSeasonYear(new Date(nowMs));
  try {
    const lifetimeKey = `${STYLE_BOOK_LIFETIME_PREFIX}${authorKey}`;
    const seasonKey = `${STYLE_BOOK_SEASON_PREFIX}${year}:${authorKey}`;
    const lastShotKey = `${STYLE_BOOK_LAST_SHOT_PREFIX}${authorKey}`;
    const leaderboardKey = `${STYLE_BOOK_LEADERBOARD_PREFIX}${year}`;

    await redis.incr(lifetimeKey);
    const seasonCount = await redis.incr(seasonKey);
    await redis.set(lastShotKey, nowMs);
    await redis.zincrby(leaderboardKey, 1, displayName || authorKey);
    return typeof seasonCount === 'number' ? seasonCount : parseInt(seasonCount ?? '0', 10) || 1;
  } catch (err) {
    warn(`Style-book bump failed for ${authorKey}: ${err.message}`);
    return null;
  }
}

/**
 * Return true if the GroupMe message was posted by the Schefter bot.
 * Match order: explicit sender-id env var, then sender_type==='bot' + name
 * regex fallback. Roger is NEVER matched here.
 */
export function isSchefterBotMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  const explicitId = process.env.GROUPME_SCHEFTER_BOT_SENDER_ID;
  if (explicitId) {
    if (msg.user_id === explicitId || msg.sender_id === explicitId) return true;
    // Env var set but no match — still allow name fallback so a renamed
    // sender_id doesn't silently break the feature.
  }
  if (msg.sender_type !== 'bot') return false;
  if (typeof msg.name !== 'string') return false;
  // "Schefter", "Claude Schefter", "Schefty" are all acceptable display names.
  // Exclude Roger explicitly so a bot named "Roger" never matches.
  if (/roger/i.test(msg.name)) return false;
  return /schefter|schefty/i.test(msg.name);
}

/**
 * If the message is a GroupMe native reply targeting a known Schefter-bot
 * message ID, return the matched reply_id. Otherwise null.
 *
 * GroupMe reply attachment shape:
 *   { type: 'reply', reply_id: '<msgId>', base_reply_id: '<msgId>', user_id: '...' }
 * In thread-of-thread conversations `reply_id` points at the immediate parent
 * and `base_reply_id` at the chain root; we accept either match since both
 * indicate the user meant to address Schefter.
 */
export function detectReplyToSchefter(msg, schefterBotMsgIds) {
  if (!msg || !Array.isArray(msg.attachments) || msg.attachments.length === 0) {
    return null;
  }
  if (!schefterBotMsgIds || schefterBotMsgIds.size === 0) return null;
  for (const att of msg.attachments) {
    if (!att || att.type !== 'reply') continue;
    const primary = typeof att.reply_id === 'string' ? att.reply_id : null;
    const base = typeof att.base_reply_id === 'string' ? att.base_reply_id : null;
    if (primary && schefterBotMsgIds.has(primary)) return primary;
    if (base && schefterBotMsgIds.has(base)) return base;
  }
  return null;
}

/**
 * Fetch GroupMe messages since the watermark. Uses the service token.
 * Returns oldest-first.
 */
async function fetchGroupMeSince(watermarkId) {
  const token = process.env.GROUPME_SERVICE_TOKEN || process.env.GROUPME_ACCESS_TOKEN;
  const groupId = process.env.GROUPME_GROUP_ID;
  if (!token || !groupId) {
    warn('GROUPME_SERVICE_TOKEN or GROUPME_GROUP_ID not set — skipping mention ingest');
    return null;
  }

  const url = new URL(`${GROUPME_API_BASE}/groups/${groupId}/messages`);
  url.searchParams.set('token', token);
  url.searchParams.set('limit', '100');
  if (watermarkId) url.searchParams.set('since_id', watermarkId);

  try {
    const res = await fetch(url.toString());
    if (res.status === 304) return [];
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      warn(`GroupMe fetch failed (${res.status}): ${body.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const messages = data?.response?.messages ?? [];
    // oldest first (GroupMe returns newest-first when using since_id)
    return [...messages].sort((a, b) => a.created_at - b.created_at);
  } catch (err) {
    warn(`GroupMe fetch error: ${err.message}`);
    return null;
  }
}

/**
 * Return sender IDs that belong to our own bots (Schefter, Roger). These
 * need to be filtered out so Schefter doesn't eat his own tail. GroupMe's
 * `bot_id` (used to POST) is NOT the same as the `sender_id` seen on
 * messages posted by a bot; when unset, fall back to sender_type === 'bot'.
 */
function getBotSenderIds() {
  const ids = new Set();
  // These may be set explicitly if the admin configures them; otherwise we
  // rely on sender_type === 'bot' filtering below.
  const schefter = process.env.GROUPME_SCHEFTER_BOT_SENDER_ID;
  const roger = process.env.GROUPME_ROGER_BOT_SENDER_ID;
  if (schefter) ids.add(schefter);
  if (roger) ids.add(roger);
  return ids;
}

/**
 * Main ingestion entrypoint. Called from rumor-scan at the top of each cycle.
 *
 * @param {object} opts
 * @param {any} opts.redis - Upstash Redis client (or null if unavailable)
 * @param {boolean} opts.dryRun - skip all Redis writes if true
 * @returns {Promise<{scanned: number, detected: number, rejected: Array, accepted: Array}>}
 */
export async function ingestGroupMeMentions({ redis, dryRun = false }) {
  const result = { scanned: 0, detected: 0, rejected: [], accepted: [] };

  if (!redis) {
    warn('No Redis — skipping GroupMe mention ingest');
    return result;
  }

  // Read watermark
  let watermark = null;
  try {
    watermark = await redis.get(WATERMARK_KEY);
    if (typeof watermark !== 'string' && watermark !== null) {
      watermark = String(watermark);
    }
  } catch (err) {
    warn(`Watermark read failed: ${err.message}`);
  }

  log(`Fetching GroupMe messages since watermark=${watermark ?? '(none)'}`);
  const messages = await fetchGroupMeSince(watermark);
  if (messages === null) {
    // Hard failure (auth/network) — caller continues with web-only tips
    return result;
  }
  result.scanned = messages.length;

  if (messages.length === 0) {
    log('No new GroupMe messages since last check');
    return result;
  }

  const botSenderIds = getBotSenderIds();
  const newestId = messages[messages.length - 1].id;

  // Load the known Schefter-bot message ID cache so native replies to posts
  // from earlier scans (not in this batch) are still recognized.
  const schefterBotMsgIds = new Set();
  try {
    const cached = await redis.lrange(BOT_MESSAGE_IDS_KEY, 0, MAX_TRACKED_BOT_MESSAGES - 1);
    if (Array.isArray(cached)) {
      for (const id of cached) if (typeof id === 'string') schefterBotMsgIds.add(id);
    }
  } catch (err) {
    warn(`Bot-message-id cache read failed: ${err.message}`);
  }
  const newSchefterBotMsgIds = [];

  for (const msg of messages) {
    // Track Schefter-bot message IDs BEFORE the bot filter — replies later in
    // this same batch need them, and we persist them for future batches.
    if (isSchefterBotMessage(msg) && typeof msg.id === 'string') {
      if (!schefterBotMsgIds.has(msg.id)) {
        schefterBotMsgIds.add(msg.id);
        newSchefterBotMsgIds.push(msg.id);
      }
    }

    // Filter bots out of tip generation
    if (msg.sender_type === 'bot') continue;
    if (botSenderIds.has(msg.user_id) || botSenderIds.has(msg.sender_id)) continue;

    const text = msg.text ?? '';

    // Native-reply path: if this is a GroupMe reply targeting a known Schefter
    // post, accept it as a tip without requiring the name in the body.
    let detection = null;
    const replyTargetId = detectReplyToSchefter(msg, schefterBotMsgIds);
    if (replyTargetId) {
      const contentCheck = validateReplyContent(text);
      if (contentCheck.valid) {
        detection = {
          match: true,
          variant: 'native-reply',
          signals: { replyTo: replyTargetId, native: true },
        };
      } else {
        // Surface low-effort reply rejections the same way near-miss name
        // detections are surfaced — they represent real intent (the user hit
        // the reply button) so they're worth logging for tuning.
        result.rejected.push({
          id: msg.id,
          author: msg.name,
          text: text.slice(0, 80),
          reason: `reply-${contentCheck.reason}`,
        });
      }
    }

    // Fall back to name-regex detection if the reply path didn't match.
    if (!detection) {
      detection = detectMention(text);
    }

    if (!detection || !detection.match) {
      if (detection && detection.reason && /schefter|schefty|claude/i.test(text)) {
        // Only log rejections that almost matched, to keep noise down
        result.rejected.push({
          id: msg.id,
          author: msg.name,
          text: text.slice(0, 80),
          reason: detection.reason,
        });
      }
      continue;
    }

    result.detected += 1;

    // Style Book: detect personal attacks on Schefter and bump counters BEFORE
    // building the tip so the outgoing payload carries the fresh count. A
    // Redis failure here must not block enqueue — we null-check seasonCount
    // downstream and skip the LLM escalation hint when unavailable.
    const attackCheck = detectAttackOnSchefter(text);
    let styleBookSeasonCount = null;
    if (attackCheck.attack) {
      const authorKey = normalizeAuthorKey(msg.name);
      if (authorKey) {
        styleBookSeasonCount = dryRun
          ? null
          : await bumpStyleBookCounters(redis, authorKey, msg.name, Date.now());
        if (dryRun) {
          log(
            `  [dry-run] Would bump style-book for ${msg.name} (${authorKey}) — keyword="${attackCheck.keyword}"`,
          );
        }
      }
    }

    const tip = {
      id: `gm_${msg.id}`,
      mentionMessageId: msg.id,
      topic: 'other',
      text: text.trim(),
      submittedAt: (msg.created_at ?? Math.floor(Date.now() / 1000)) * 1000,
      source: 'groupme',
      attributable: true,
      author: msg.name,
      ...(replyTargetId ? { replyToGroupMeId: replyTargetId } : {}),
      ...(attackCheck.attack
        ? {
            attackOnSchefter: true,
            ...(styleBookSeasonCount !== null ? { styleBookCount: styleBookSeasonCount } : {}),
          }
        : {}),
    };

    result.accepted.push({
      id: tip.id,
      author: tip.author,
      text: tip.text.slice(0, 80),
      variant: detection.variant,
      signals: detection.signals,
      ...(attackCheck.attack ? { attack: true, keyword: attackCheck.keyword, styleBookCount: styleBookSeasonCount } : {}),
    });

    if (!dryRun) {
      try {
        // Check queue depth BEFORE push so we know if we need to anchor the marinate timer
        const prevLen = await redis.llen(TIPS_QUEUE_KEY);
        await redis.lpush(TIPS_QUEUE_KEY, JSON.stringify(tip));
        if (prevLen === 0) {
          await redis.set(FIRST_TIP_TS_KEY, Date.now(), { nx: true });
        }
        // Audit list (newest first, TTL 24h)
        await redis.lpush(RECENT_MENTIONS_KEY, JSON.stringify({
          id: tip.id,
          author: tip.author,
          text: tip.text,
          variant: detection.variant,
          at: tip.submittedAt,
          ...(attackCheck.attack ? { attack: true, keyword: attackCheck.keyword } : {}),
        }));
        await redis.ltrim(RECENT_MENTIONS_KEY, 0, MAX_RECENT_MENTIONS - 1);
        await redis.expire(RECENT_MENTIONS_KEY, RECENT_MENTIONS_TTL_SEC);
      } catch (err) {
        warn(`Enqueue failed for ${tip.id}: ${err.message}`);
      }
    }
  }

  // Advance watermark even if nothing matched — we processed these messages
  if (!dryRun && newestId) {
    try {
      await redis.set(WATERMARK_KEY, newestId);
    } catch (err) {
      warn(`Watermark write failed: ${err.message}`);
    }
  } else if (dryRun && newestId) {
    log(`  [dry-run] Would advance watermark → ${newestId}`);
  }

  // Persist any newly-seen Schefter-bot message IDs so future batches can
  // recognize replies to them. LPUSH keeps the newest-first ordering and the
  // LTRIM caps the list at MAX_TRACKED_BOT_MESSAGES.
  if (!dryRun && newSchefterBotMsgIds.length > 0) {
    try {
      // LPUSH accepts multiple values; feed them newest-first so the list
      // matches the ordering convention used elsewhere in this file.
      await redis.lpush(BOT_MESSAGE_IDS_KEY, ...[...newSchefterBotMsgIds].reverse());
      await redis.ltrim(BOT_MESSAGE_IDS_KEY, 0, MAX_TRACKED_BOT_MESSAGES - 1);
      await redis.expire(BOT_MESSAGE_IDS_KEY, BOT_MESSAGE_IDS_TTL_SEC);
    } catch (err) {
      warn(`Bot-message-id cache write failed: ${err.message}`);
    }
  } else if (dryRun && newSchefterBotMsgIds.length > 0) {
    log(`  [dry-run] Would cache ${newSchefterBotMsgIds.length} Schefter bot message IDs`);
  }

  log(
    `Scanned=${result.scanned} detected=${result.detected} ` +
    `rejected(near-miss)=${result.rejected.length} ` +
    `botMsgsTracked=${newSchefterBotMsgIds.length}`,
  );

  return result;
}

/**
 * Fetch the latest Ask Roger bot message within the last `maxAgeMs`.
 * Returns { text, created_at_ms } or null.
 */
export async function getLatestRogerQuote({ maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  const token = process.env.GROUPME_SERVICE_TOKEN || process.env.GROUPME_ACCESS_TOKEN;
  const groupId = process.env.GROUPME_GROUP_ID;
  if (!token || !groupId) return null;

  const rogerSenderId = process.env.GROUPME_ROGER_BOT_SENDER_ID;

  try {
    const url = new URL(`${GROUPME_API_BASE}/groups/${groupId}/messages`);
    url.searchParams.set('token', token);
    url.searchParams.set('limit', '100');
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    const messages = data?.response?.messages ?? [];
    const nowMs = Date.now();

    for (const msg of messages) {
      const ageMs = nowMs - (msg.created_at ?? 0) * 1000;
      if (ageMs > maxAgeMs) break; // messages are newest-first
      const isBot = msg.sender_type === 'bot';
      const byRogerSenderId = rogerSenderId && (msg.user_id === rogerSenderId || msg.sender_id === rogerSenderId);
      const looksLikeRoger = typeof msg.name === 'string' && /roger/i.test(msg.name);
      if ((isBot || byRogerSenderId) && looksLikeRoger && msg.text) {
        return { text: msg.text, createdAtMs: (msg.created_at ?? 0) * 1000, name: msg.name };
      }
    }
    return null;
  } catch (err) {
    warn(`getLatestRogerQuote failed: ${err.message}`);
    return null;
  }
}
