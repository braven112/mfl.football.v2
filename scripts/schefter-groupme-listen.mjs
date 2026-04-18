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

  for (const msg of messages) {
    // Filter bots
    if (msg.sender_type === 'bot') continue;
    if (botSenderIds.has(msg.user_id) || botSenderIds.has(msg.sender_id)) continue;

    const text = msg.text ?? '';
    const detection = detectMention(text);

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
    const tip = {
      id: `gm_${msg.id}`,
      mentionMessageId: msg.id,
      topic: 'other',
      text: text.trim(),
      submittedAt: (msg.created_at ?? Math.floor(Date.now() / 1000)) * 1000,
      source: 'groupme',
      attributable: true,
      author: msg.name,
    };

    result.accepted.push({
      id: tip.id,
      author: tip.author,
      text: tip.text.slice(0, 80),
      variant: detection.variant,
      signals: detection.signals,
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

  log(
    `Scanned=${result.scanned} detected=${result.detected} ` +
    `rejected(near-miss)=${result.rejected.length}`,
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
