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
 * @param {{
 *   botId: string | undefined,
 *   text: string,
 *   dryRun?: boolean,
 *   checkStatus?: boolean,
 *   onDryRun?: () => void,
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
  dryRun = false,
  checkStatus = false,
  onDryRun,
  onMissingBotId,
  onPosted,
  onHttpError,
  onFetchError,
} = {}) {
  // Applied before the dry-run bail so a rehearsal prints the exact bytes a
  // live run would send.
  text = stripLinkAdjacentPunctuation(text);
  if (dryRun) {
    onDryRun?.();
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
      body: JSON.stringify({ bot_id: botId, text }),
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
