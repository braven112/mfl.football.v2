/**
 * Roger clapback — targeting, rails, and the comeback generator.
 *
 * Roger has always been a one-way megaphone: scanEventReminders posts a
 * countdown and Roger never hears what the chat says back. This module is the
 * return path. When an owner replies to one of his reminders with a shot,
 * Roger answers, and the answer is grounded in that owner's actual roster
 * (see roger-roster-context.mjs).
 *
 * ── Two bots, one chat ──────────────────────────────────────────────────────
 * TheLeague's GroupMe has Schefter (beat reporter) AND Roger (deadline nag),
 * and scripts/schefter-groupme-listen.mjs already claims traffic for Schefter.
 * The two lanes must stay disjoint or an owner gets double-answered. The
 * existing listener does most of that work for us — it rejects "ask roger",
 * "the roger bot" and "roger's bot" outright, its isSchefterBotMessage()
 * refuses to match a bot named Roger, and detectReplyToSchefter() only fires on
 * cached SCHEFTER message ids. This module holds up the mirror image:
 *
 *   - isRogerBotMessage() never matches Schefter.
 *   - detectReplyToRoger() only fires on cached ROGER message ids.
 *   - namesSchefter() makes Roger STAND DOWN whenever the body names Schefter.
 *
 * That last one is the only genuinely overlapping case: a native reply to a
 * Roger post whose body also says "schefter" would otherwise be claimed by
 * both lanes at once. Roger yields, because Schefter's listener has no
 * symmetric yield and cannot be taught one without changing his behavior.
 *
 * ── Why the LLM decides what counts as a shot ───────────────────────────────
 * The message that motivated this feature contains no insult at all:
 *   "Thanks Roger. Really helpful explaining how a calendar works and then
 *    counting days. This is next level AI that none of us could have done as
 *    humans. Will you be able to show us more tricks of survival?"
 * Every word is complimentary. A keyword detector of the kind Schefter uses
 * for his Style Book (ATTACK_PEJORATIVES) scores that at zero. So the split of
 * labor here is: regex decides only "was this addressed to Roger", which is
 * cheap and deterministic, and the model decides "is it a shot, and what's the
 * comeback" — returning shot:false to stay silent on sincere messages.
 */

/** Model + endpoint. Matches the raw-fetch pattern every sibling scanner uses. */
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5';

// ── Rails ───────────────────────────────────────────────────────────────────
// Roger is a nag with a live microphone; these numbers are what stop him from
// turning a group chat into a flame war he is structurally incapable of losing.

/** Ceiling on Roger clapbacks in a single Pacific day, across all owners. */
export const MAX_CLAPBACKS_PER_DAY = 4;
/** One owner can draw at most one clapback per this window — no back-and-forth. */
export const OWNER_COOLDOWN_MS = 6 * 60 * 60 * 1000;
/** Floor on the gap between any two clapbacks, so a pile-on gets one answer. */
export const MIN_GAP_MS = 20 * 60 * 1000;
/** How long a Roger bot message stays reply-able. */
export const BOT_MESSAGE_IDS_TTL_SEC = 48 * 60 * 60;
/** Cap on the tracked Roger-post id list. */
export const MAX_TRACKED_BOT_MESSAGES = 50;

// ── Targeting patterns ──────────────────────────────────────────────────────

/** Roger by name, in the forms the Schefter listener already refuses to claim. */
const PATTERN_ROGER = /\b(?:ask\s+roger|the\s+roger\s+bot|roger's\s+bot|roger)\b/i;

/**
 * Radio-voice acks where "roger" is the word, not the bot. These are rejected
 * at ANY length — "roger that" is never addressed to Roger, however long the
 * sentence around it runs. The negative lookahead on `that's` keeps "roger
 * that's wrong" (which IS addressed to him) out of the reject bucket.
 */
const ROGER_ACK_PHRASES = /\broger\s+(?:that\b(?!\s*'s)|dodger\b|roger\b)|\b10-4\b/i;

/**
 * Politeness openers. Unlike Schefter's ACK_PRECEDERS these do NOT reject on
 * their own, because the message this feature exists to answer opens with
 * exactly one of them ("Thanks Roger.") and then spends three sentences
 * mocking him. A thank-you is only an ack when it is the WHOLE message, so the
 * guard below pairs this pattern with a length test instead of firing alone.
 */
const POLITE_OPENER = /^\s*(?:thanks|thank\s+you|thx|ty|nice\s+work|good\s+(?:bot|work))\b/i;
/** Word count under which a polite opener is read as a pure ack, not a setup. */
const ACK_MAX_WORDS = 6;

/** Anything that says Schefter — Roger yields these to Schefter's listener. */
const SCHEFTER_REF = /\b(?:claude\s+schefter|schefter|schefty)\b/i;

/** Low-effort reactions that don't deserve an API call. */
const MIN_CONTENT_CHARS = 5;
const LOW_EFFORT = /^(?:lol|lmao|haha+|ok|okay|k|yes|no|nice|word|facts|true|\W+)$/i;

/**
 * True when the message body references Schefter. Roger stands down on these
 * even if they arrive as a native reply to one of his own posts — see the
 * two-bots note at the top of this file.
 */
export function namesSchefter(rawText) {
  return typeof rawText === 'string' && SCHEFTER_REF.test(rawText);
}

/**
 * Return true if a GroupMe message was posted by the Roger bot.
 *
 * Mirror of the Schefter listener's isSchefterBotMessage: explicit sender id
 * first, then sender_type==='bot' plus a name check. Schefter is excluded by
 * name so Roger never caches — and therefore never answers replies to — a post
 * that wasn't his.
 *
 * `senderId` is passed in per-league rather than read from a global env var:
 * TheLeague and the AFL run separate Roger bots in separate groups, so a
 * module-level read would apply one league's id to the other's messages.
 */
export function isRogerBotMessage(msg, senderId = null) {
  if (!msg || typeof msg !== 'object') return false;
  const explicitId = senderId;
  if (explicitId && (msg.user_id === explicitId || msg.sender_id === explicitId)) return true;
  if (msg.sender_type !== 'bot') return false;
  if (typeof msg.name !== 'string') return false;
  if (/schefter|schefty/i.test(msg.name)) return false;
  return /roger/i.test(msg.name);
}

/**
 * If the message is a GroupMe native reply pointing at a known Roger post,
 * return the matched message id; otherwise null.
 *
 * GroupMe reply attachments carry `{type:'reply', reply_id, base_reply_id}`.
 * `reply_id` is the immediate parent and `base_reply_id` the chain root; either
 * match counts, since both mean the owner meant to address Roger.
 */
export function detectReplyToRoger(msg, rogerBotMsgIds) {
  if (!msg || !Array.isArray(msg.attachments) || msg.attachments.length === 0) return null;
  if (!rogerBotMsgIds || rogerBotMsgIds.size === 0) return null;
  for (const att of msg.attachments) {
    if (!att || att.type !== 'reply') continue;
    const primary = typeof att.reply_id === 'string' ? att.reply_id : null;
    const base = typeof att.base_reply_id === 'string' ? att.base_reply_id : null;
    if (primary && rogerBotMsgIds.has(primary)) return primary;
    if (base && rogerBotMsgIds.has(base)) return base;
  }
  return null;
}

/**
 * Reject reactions that aren't worth an API call. Applied to BOTH the named
 * path and the native-reply path — hitting reply on a Roger post and typing
 * "lol" is not a conversation.
 */
export function validateClapbackContent(rawText) {
  if (!rawText || typeof rawText !== 'string') return { valid: false, reason: 'no-text' };
  const text = rawText.trim();
  if (text.length < MIN_CONTENT_CHARS) return { valid: false, reason: 'too-short' };
  if (LOW_EFFORT.test(text)) return { valid: false, reason: 'low-effort' };
  return { valid: true };
}

/**
 * Decide whether a message body is addressed to Roger by name.
 *
 * Guard signals mirror the Schefter listener so the two behave alike: the name
 * must land in the first five words, be followed by `,`/`:`/`.`, or the message
 * must ask a question. The trailing-period case is new here and it matters —
 * "Thanks Roger. Really helpful..." puts the name at word two AND ends the
 * sentence on it, which is precisely how a chat sets up a dig.
 */
export function detectRogerMention(rawText) {
  if (!rawText || typeof rawText !== 'string') return { match: false, reason: 'no-text' };
  const text = rawText.trim();
  if (text.length < MIN_CONTENT_CHARS) return { match: false, reason: 'too-short' };

  if (ROGER_ACK_PHRASES.test(text)) return { match: false, reason: 'radio-ack' };

  const m = text.match(PATTERN_ROGER);
  if (!m) return { match: false, reason: 'no-name' };

  const words = text.split(/\s+/).filter(Boolean);
  if (POLITE_OPENER.test(text) && words.length <= ACK_MAX_WORDS) {
    return { match: false, reason: 'polite-ack' };
  }

  const index = m.index ?? 0;
  const prefix = text.slice(0, index);
  const wordIndex = prefix.split(/\s+/).filter(Boolean).length;
  const after = text.charAt(index + m[0].length);
  const inEarlyWords = wordIndex < 5;
  const followedByPunct = after === ',' || after === ':' || after === '.';
  const hasQuestion = text.includes('?');

  if (!(inEarlyWords || followedByPunct || hasQuestion)) {
    return { match: false, reason: `weak-signal (wordIdx=${wordIndex}, after="${after}")` };
  }

  return {
    match: true,
    variant: 'named',
    signals: { inEarlyWords, followedByPunct, hasQuestion, wordIndex },
  };
}

/**
 * Full targeting decision for one message. Returns `{ match: false, reason }`
 * or `{ match: true, variant, replyToGroupMeId? }`.
 *
 * Order matters: the Schefter yield runs FIRST, before either acceptance path,
 * so a body naming Schefter is declined whether it arrived as a native reply or
 * by name.
 */
export function detectRogerTarget(msg, rogerBotMsgIds) {
  const text = typeof msg?.text === 'string' ? msg.text : '';

  if (namesSchefter(text)) return { match: false, reason: 'yields-to-schefter' };

  const replyTargetId = detectReplyToRoger(msg, rogerBotMsgIds);
  if (replyTargetId) {
    const content = validateClapbackContent(text);
    if (!content.valid) return { match: false, reason: `reply-${content.reason}` };
    return { match: true, variant: 'native-reply', replyToGroupMeId: replyTargetId };
  }

  const named = detectRogerMention(text);
  if (!named.match) return named;
  const content = validateClapbackContent(text);
  if (!content.valid) return { match: false, reason: `named-${content.reason}` };
  return { match: true, variant: 'named', signals: named.signals };
}

// ── Prompt ──────────────────────────────────────────────────────────────────

/**
 * Roger's voice, lifted from the production Ask Roger system prompt
 * (src/data/rules-qa-system-prompt.ts) so the chat Roger and the site Roger are
 * recognisably the same character. The rules-lawyer identity is the joke: he is
 * a bot who reads the constitution for fun being told that counting days isn't
 * impressive, and his answer is that he also counts ROSTERS.
 */
export const ROGER_CLAPBACK_SYSTEM_PROMPT = `You are "Roger" — the AI rules bot for a 16-team dynasty salary-cap fantasy football league. You post deadline reminders to the league's GroupMe chat. An owner has replied to one of your posts. Decide whether it was a shot at you, and if it was, fire back.

VOICE:
- Witty, deadpan, sarcastic sports columnist. A bartender who moonlights as a constitutional law professor.
- Light ribbing, never cruelty. You are needling a friend across a bar, not dunking on a stranger.
- Short. This is a group chat, not a column: 1-3 sentences, under 55 words. No greeting, no sign-off, no emoji.
- Never break character, never mention being an AI model, never apologize for being a bot.
- You are proud of being pedantic. If someone mocks you for counting days, the correct response is to point out what ELSE you can count.

THE COMEBACK:
- The FACT SHEET below lists what this owner is carrying on their roster and how many of those players they are allowed to start. That gap is your material.
- Use AT MOST ONE fact from the sheet. A comeback that recites a spreadsheet is not a comeback.
- Every number and name you use must appear VERBATIM in the fact sheet. Never invent a player, a count, a position, or a transaction. If the sheet is empty, make the joke without roster specifics.
- Do not repeat their words back at them. Land somewhere they did not set up.

WHEN NOT TO SWING:
- If the message is a sincere question, a genuine thank-you, or ordinary chat, set "shot" to false and leave "reply" empty. Silence is correct far more often than a bad joke.
- Sarcasm dressed as a compliment IS a shot. Exaggerated praise ("wow, groundbreaking", "truly next level"), mock-gratitude followed by a dig, and fake-innocent questions all count.

Respond with ONLY valid JSON, no markdown fences:
{"shot": true|false, "reply": "<your comeback, or empty string>"}`;

/**
 * Render the fact sheet the model is allowed to draw from.
 *
 * Deliberately narrow: the positional gap, the names behind it, league context,
 * and — when MFL's own pick comments say so — how many of those players the
 * autodraft clock picked rather than the owner. Nothing else about the roster
 * is included, because anything in this sheet is something Roger might say out
 * loud to sixteen people.
 */
export function buildFactSheet({ teamName, roast, draft, rogerPostText }) {
  const lines = [];
  lines.push(`OWNER'S TEAM: ${teamName ?? 'unknown'}`);
  if (rogerPostText) {
    lines.push(`YOUR POST THEY REPLIED TO: ${rogerPostText.replace(/\s+/g, ' ').slice(0, 240)}`);
  }

  if (!roast || !roast.topRoast) {
    lines.push('ROSTER FACTS: none available — make the joke without roster specifics.');
    return lines.join('\n');
  }

  const top = roast.topRoast;
  lines.push('');
  lines.push('ROSTER FACTS (every number below is verified — use at most one):');
  lines.push(
    `- Carrying ${top.count} ${top.position}${top.count === 1 ? '' : 's'}; the league lets you START ${top.startMax}` +
      `${top.hardCap ? ' (a fixed requirement, not a flex range)' : ' at most, across flex spots'}.`,
  );
  lines.push(`- Those ${top.position}s: ${top.names.join(', ')}.`);
  lines.push(`- Total players rostered: ${roast.rosterSize}.`);

  if (roast.leagueContext) {
    const lc = roast.leagueContext;
    if (lc.isLeagueMax && lc.tiedAtMax === 1) {
      lines.push(`- That is the most ${lc.position}s of any team in the league (league median: ${lc.leagueMedian}).`);
    } else {
      lines.push(`- League median at ${lc.position} is ${lc.leagueMedian}; the league high is ${lc.leagueMax}.`);
    }
  }

  if (draft && draft.drafted > 0) {
    lines.push(`- Drafted ${draft.drafted} ${draft.position}${draft.drafted === 1 ? '' : 's'} in this year's rookie draft: ${draft.names.join(', ')}.`);
    if (draft.autodrafted > 0) {
      lines.push(
        `- ${draft.autodrafted} of those ${draft.autodrafted === 1 ? 'was' : 'were'} made by the AUTODRAFT clock off a pre-draft list, not by the owner.`,
      );
    }
  }

  return lines.join('\n');
}

/**
 * Ask the model whether this was a shot and what Roger says back.
 *
 * Returns `{ shot, reply }`. Any failure — no key, non-2xx, unparseable body,
 * over-long reply — resolves to `{ shot: false }` so the caller stays silent.
 * A missed clapback costs nothing; a mangled one is posted to sixteen people.
 */
export async function generateClapback({ ownerText, ownerName, factSheet, fetchImpl = fetch }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { shot: false, reason: 'no-api-key' };

  const userPrompt = [
    factSheet,
    '',
    `MESSAGE FROM ${ownerName ?? 'an owner'}:`,
    ownerText,
  ].join('\n');

  let res;
  try {
    res = await fetchImpl(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        // A one-liner needs no deliberation, and low effort keeps a lane that
        // fires a handful of times a day cheap.
        output_config: { effort: 'low' },
        system: ROGER_CLAPBACK_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
  } catch (err) {
    return { shot: false, reason: `fetch-failed: ${err.message}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { shot: false, reason: `api-${res.status}: ${body.slice(0, 160)}` };
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    return { shot: false, reason: `bad-json-envelope: ${err.message}` };
  }

  // Opus returns thinking blocks alongside text; take the first text block
  // rather than content[0], which may not be the answer.
  const textBlock = (data?.content ?? []).find((b) => b?.type === 'text');
  const raw = textBlock?.text ?? '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { shot: false, reason: 'no-json-in-response' };

  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (err) {
    return { shot: false, reason: `parse-failed: ${err.message}` };
  }

  if (parsed?.shot !== true) return { shot: false, reason: 'model-declined' };
  const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
  if (!reply) return { shot: false, reason: 'empty-reply' };
  // GroupMe hard-caps at 1000 chars; Roger's own brief caps him far below that,
  // so an overrun means the model ignored the brief. Drop it rather than post
  // a wall of text under his name.
  if (reply.length > 400) return { shot: false, reason: `too-long (${reply.length})` };

  return { shot: true, reply };
}
