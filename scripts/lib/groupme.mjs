/**
 * Shared GroupMe bot-post helper for node scripts.
 *
 * Consolidates the POST-to-GroupMe-bot fetch duplicated across
 * scripts/schefter-announce.mjs (`sendGroupMe`), scripts/schefter-rumor-scan.mjs
 * (`postToGroupMe`), and scripts/schefter-scan.mjs (`postToGroupMe`). The
 * three callers differ in exactly which log channel they use (console.log
 * vs console.warn), whether they log anything at all on a missing bot id,
 * and whether they inspect the response status (schefter-announce.mjs does;
 * the other two treat any non-throwing fetch as "posted"). Rather than
 * silently normalize those differences, every branch here is an optional
 * callback so each call site reproduces its own original behavior exactly.
 *
 * The one thing this DOES normalize is link hygiene: every outgoing text is
 * run through `stripLinkAdjacentPunctuation` so a sentence-ending period
 * never gets autolinked into the URL. See src/utils/link-punctuation.mjs.
 */

import { stripLinkAdjacentPunctuation } from '../../src/utils/link-punctuation.mjs';

const GROUPME_POST_URL = 'https://api.groupme.com/v3/bots/post';

/**
 * A GroupMe native-reply attachment, or null when there is nothing to point at.
 *
 * `reply_id` is the immediate parent and `base_reply_id` the chain root. Both
 * are set to the same id here: a bot answering one message IS the root of the
 * chain it starts, and GroupMe's own clients send them equal in that case.
 * `detectReplyToRoger` in roger-clapback.mjs reads this same shape inbound.
 */
export function buildReplyAttachment(messageId) {
  if (typeof messageId !== 'string' || !messageId) return null;
  return { type: 'reply', reply_id: messageId, base_reply_id: messageId };
}

/**
 * A GroupMe mentions attachment, or null when nothing is mentionable.
 *
 * `loci` are [start, length] offsets into the message text — the range GroupMe
 * highlights and links to the matching entry in `user_ids`. They are positional,
 * not textual: they must be computed against the EXACT string that gets sent,
 * which is why callers build the text and the loci together rather than letting
 * anything rewrite the text afterwards.
 *
 * @param {Array<{ userId: string, start: number, length: number }>} mentions
 */
export function buildMentionAttachment(mentions) {
  const valid = (mentions ?? []).filter(
    (m) =>
      m &&
      typeof m.userId === 'string' &&
      m.userId &&
      Number.isInteger(m.start) &&
      m.start >= 0 &&
      Number.isInteger(m.length) &&
      m.length > 0,
  );
  if (valid.length === 0) return null;
  return {
    type: 'mentions',
    user_ids: valid.map((m) => m.userId),
    loci: valid.map((m) => [m.start, m.length]),
  };
}

/**
 * @param {{
 *   botId: string | undefined,
 *   text: string,
 *   attachments?: Array<object> | null,
 *   dryRun?: boolean,
 *   checkStatus?: boolean,
 *   onDryRun?: (sanitizedText: string, attachments: Array<object>) => void,
 *   onMissingBotId?: () => void,
 *   onPosted?: () => void,
 *   onHttpError?: (status: number) => void,
 *   onFetchError?: (err: Error) => void,
 * }} options
 * @returns {Promise<{ posted: boolean, reason?: string }>}
 */
export async function postToGroupMe({
  botId,
  text,
  attachments = null,
  dryRun = false,
  checkStatus = false,
  onDryRun,
  onMissingBotId,
  onPosted,
  onHttpError,
  onFetchError,
} = {}) {
  // Applied before the dry-run bail, and handed to onDryRun, so a rehearsal
  // can print the exact bytes a live run would send. Callers that log their
  // own captured text still show the unsanitized original — take the argument.
  text = stripLinkAdjacentPunctuation(text);
  const sent = (attachments ?? []).filter(Boolean);
  if (dryRun) {
    onDryRun?.(text, sent);
    return { posted: false, reason: 'dry-run' };
  }
  if (!botId) {
    onMissingBotId?.();
    return { posted: false, reason: 'no-bot-id' };
  }
  try {
    const res = await fetch(GROUPME_POST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Omitted entirely rather than sent empty: GroupMe treats an empty
      // `attachments` array as a malformed post on some client versions, and
      // every existing caller posts plain text.
      body: JSON.stringify({ bot_id: botId, text, ...(sent.length > 0 ? { attachments: sent } : {}) }),
    });
    if (checkStatus) {
      const status = typeof res?.status === 'number' ? res.status : 0;
      if (status < 200 || status >= 300) {
        onHttpError?.(status);
        return { posted: false, reason: `http-${status}` };
      }
    }
    onPosted?.();
    return { posted: true };
  } catch (err) {
    onFetchError?.(err);
    return { posted: false, reason: 'fetch-error' };
  }
}
