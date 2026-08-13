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
 */

const GROUPME_POST_URL = 'https://api.groupme.com/v3/bots/post';
const GROUPME_DM_URL = 'https://api.groupme.com/v3/direct_messages';

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

/**
 * Send a GroupMe DIRECT message to one user.
 *
 * Distinct from postToGroupMe in two ways that matter:
 *
 *  - **Audience.** Every bot-id path in this repo posts to the whole league
 *    chat. This one reaches a single person, which is what makes it usable
 *    for admin/commissioner alerts that 12 owners shouldn't absorb.
 *  - **Credential.** Bots cannot DM. This needs a USER access token
 *    (GROUPME_SERVICE_TOKEN — the same service account that already reads
 *    the group in src/utils/groupme-client.ts), and the sender must share a
 *    group with the recipient.
 *
 * `sourceGuid` is GroupMe's idempotency key: reusing one collapses a retry
 * into the original message instead of double-pinging. Callers that can
 * derive a stable key (a proposal id, a run date) should pass one.
 *
 * @param {{
 *   token: string | undefined,
 *   recipientId: string | undefined,
 *   text: string,
 *   sourceGuid?: string,
 *   dryRun?: boolean,
 *   onDryRun?: () => void,
 *   onMissingConfig?: (missing: string[]) => void,
 *   onSent?: () => void,
 *   onHttpError?: (status: number, body: string) => void,
 *   onFetchError?: (err: Error) => void,
 * }} options
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
export async function sendGroupMeDirectMessage({
  token,
  recipientId,
  text,
  sourceGuid,
  dryRun = false,
  onDryRun,
  onMissingConfig,
  onSent,
  onHttpError,
  onFetchError,
} = {}) {
  if (dryRun) {
    onDryRun?.();
    return { sent: false, reason: 'dry-run' };
  }
  const missing = [];
  if (!token) missing.push('GROUPME_SERVICE_TOKEN');
  if (!recipientId) missing.push('GROUPME_COMMISSIONER_USER_ID');
  if (missing.length > 0) {
    onMissingConfig?.(missing);
    return { sent: false, reason: `missing-${missing.join(',')}` };
  }
  try {
    const res = await fetch(`${GROUPME_DM_URL}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        direct_message: {
          source_guid: sourceGuid || `roger_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
          recipient_id: recipientId,
          text,
        },
      }),
    });
    const status = typeof res?.status === 'number' ? res.status : 0;
    if (status < 200 || status >= 300) {
      // Body, not just status: GroupMe answers 401 for a revoked token and
      // 400 for a recipient the sender shares no group with, and the two
      // need completely different fixes.
      const body = await res.text?.().catch(() => '') ?? '';
      onHttpError?.(status, body);
      return { sent: false, reason: `http-${status}` };
    }
    onSent?.();
    return { sent: true };
  } catch (err) {
    onFetchError?.(err);
    return { sent: false, reason: 'fetch-error' };
  }
}
