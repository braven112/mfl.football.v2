/**
 * League chat, provider-neutral.
 *
 * A league's registry entry says where its news persona posts
 * (`chat: { provider: 'groupme' | 'slack', ... }`, src/config/leagues-data.mjs).
 * GroupMe keeps its existing sender (scripts/lib/groupme.mjs) untouched; this
 * module adds Slack beside it and the one lookup callers use to pick between
 * them.
 *
 * SLACK, and the three ways it differs from GroupMe that matter here:
 *
 * 1. A 200 is not a success. `chat.postMessage` answers HTTP 200 with
 *    `{ ok: false, error: 'not_in_channel' }` for most failures, so success is
 *    `ok === true` and nothing else — the same trap MFL sets
 *    (docs/claude/rules/lineups.md).
 * 2. Links are delimited. Slack's mrkdwn takes `<https://…>`, which ends the
 *    URL at the bracket, so the trailing-period problem GroupMe needs
 *    the link-punctuation sanitizer for does not exist — and that sanitizer
 *    is pinned to the GroupMe lanes, so it is deliberately not used here.
 * 3. The bot can post under the league's persona. With the `chat:write.customize`
 *    scope, `username` and `icon_url` set per message, so a commissioner's
 *    rename shows up in the channel without anyone touching the Slack app.
 */

const SLACK_POST_URL = 'https://slack.com/api/chat.postMessage';

/** Sentence punctuation that belongs to the prose, not the URL before it. */
const TRAILING_URL_PUNCTUATION = /[.,!?;:)\]'"’”]+$/;

/**
 * The league's chat config, or null when it has none.
 *
 * @typedef {{ provider: 'groupme', botEnv: string }
 *   | { provider: 'slack', tokenEnv: string, channelEnv: string }} ChatConfig
 *
 * @param {{ chat?: object } | Record<string, unknown> | null | undefined} league Registry entry.
 * @returns {ChatConfig | null}
 */
export function chatConfigFor(league) {
  const chat = /** @type {any} */ (league)?.chat;
  if (!chat || (chat.provider !== 'groupme' && chat.provider !== 'slack')) return null;
  return /** @type {ChatConfig} */ (chat);
}

/**
 * Plain chat copy → Slack mrkdwn.
 *
 * Escapes the three characters Slack reserves (`&`, `<`, `>`) and wraps every
 * URL in `<…>` so it links exactly the URL — sentence punctuation after it is
 * moved outside the brackets. Everything else passes through, so copy written
 * for GroupMe reads the same in Slack.
 *
 * @param {string} text
 */
export function toSlackText(text) {
  if (typeof text !== 'string' || !text) return '';
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(/https?:\/\/[^\s<>]+/g, (match) => {
    const tail = match.match(TRAILING_URL_PUNCTUATION)?.[0] ?? '';
    const url = tail ? match.slice(0, -tail.length) : match;
    // `&amp;` inside a URL has to go back to `&` — Slack reads the bracketed
    // part as a raw URL, not as escaped text.
    return `<${url.replace(/&amp;/g, '&')}>${tail}`;
  });
}

/**
 * Post one message to a Slack channel as the league's persona.
 *
 * Mirrors postToGroupMe's contract — `{ posted, reason }` plus optional
 * callbacks — so a caller can hand either sender the same handlers.
 *
 * @param {{
 *   token: string | undefined,
 *   channel: string | undefined,
 *   text: string,
 *   persona?: { name?: string, avatarUrl?: string } | null,
 *   dryRun?: boolean,
 *   fetchImpl?: (url: string, init?: object) => Promise<any>,
 *   onDryRun?: (slackText: string) => void,
 *   onMissingBotId?: () => void,
 *   onPosted?: () => void,
 *   onHttpError?: (status: number | string) => void,
 *   onFetchError?: (err: Error) => void,
 * }} options
 * @returns {Promise<{ posted: boolean, reason?: string }>}
 */
export async function postToSlack({
  token,
  channel,
  text,
  persona = null,
  dryRun = false,
  fetchImpl = fetch,
  onDryRun,
  onMissingBotId,
  onPosted,
  onHttpError,
  onFetchError,
} = /** @type {any} */ ({})) {
  const slackText = toSlackText(text);
  if (dryRun) {
    onDryRun?.(slackText);
    return { posted: false, reason: 'dry-run' };
  }
  if (!token || !channel) {
    onMissingBotId?.();
    return { posted: false, reason: 'no-bot-id' };
  }
  const body = {
    channel,
    text: slackText,
    // Links to the league's own site are the point of the post; unfurling
    // each one would bury the text under preview cards.
    unfurl_links: false,
    unfurl_media: false,
    ...(persona?.name ? { username: persona.name } : {}),
    ...(persona?.avatarUrl ? { icon_url: persona.avatarUrl } : {}),
  };
  try {
    const res = await fetchImpl(SLACK_POST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const status = typeof res?.status === 'number' ? res.status : 0;
    if (status < 200 || status >= 300) {
      onHttpError?.(status);
      return { posted: false, reason: `http-${status}` };
    }
    const data = await res.json().catch(() => null);
    if (data?.ok !== true) {
      const error = typeof data?.error === 'string' ? data.error : 'unknown';
      onHttpError?.(error);
      return { posted: false, reason: `slack-${error}` };
    }
    onPosted?.();
    return { posted: true };
  } catch (err) {
    onFetchError?.(/** @type {Error} */ (err));
    return { posted: false, reason: 'fetch-error' };
  }
}

/**
 * The sender for a league's chat, curried to the shape postToGroupMeCapped
 * calls: `({ text, dryRun, ...handlers }) => Promise<{ posted, reason }>`.
 * Returns null for a GroupMe league (the caller keeps its own GroupMe path)
 * and for a league with no chat.
 *
 * @param {{ chat?: object } | null | undefined} league Registry entry.
 * @param {{ persona?: object | null, env?: Record<string, string | undefined>, fetchImpl?: any }} [opts]
 */
export function slackSenderFor(league, { persona = null, env = process.env, fetchImpl } = {}) {
  const chat = chatConfigFor(league);
  if (chat?.provider !== 'slack') return null;
  const { tokenEnv, channelEnv } = chat;
  return (/** @type {any} */ { text, dryRun, onMissingBotId, onPosted, onHttpError, onFetchError, onDryRun }) =>
    postToSlack({
      token: env[tokenEnv],
      channel: env[channelEnv],
      text,
      persona,
      dryRun,
      ...(fetchImpl ? { fetchImpl } : {}),
      onDryRun,
      onMissingBotId,
      onPosted,
      onHttpError,
      onFetchError,
    });
}
