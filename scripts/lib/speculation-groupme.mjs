/**
 * Speculation GroupMe helper — Phase 2.
 *
 * Builds the GroupMe payload text for a published trade-speculation post and
 * delivers it to the chat via the same /v3/bots/post primitive the rumor-mill
 * uses. Kept dependency-light and pure-where-possible so the payload shape
 * can be unit-tested without standing up a Redis or fetch mock.
 *
 * Public surface:
 *   - buildSpeculationDeepLink({ postId, publicBaseUrl })
 *       → absolute URL pointing at #post-<id> on the feed page. theleague.us
 *         301s /theleague/news → /news, so we anchor on the canonical /news
 *         path (production) and rely on the same redirect locally.
 *   - buildSpeculationGroupMeText({ body, postId, publicBaseUrl })
 *       → "<body>\n\n<CTA prefix> <url>" — the exact bytes we send.
 *   - postSpeculationToGroupMe({ post, publicBaseUrl, env, fetcher,
 *                               dryRun, log, warn })
 *       → best-effort POST to GroupMe. NEVER throws — the post is already
 *         on disk + on the ledger by the time we get here, so a GroupMe
 *         outage cannot block the run.
 *
 * The CTA copy intentionally avoids "tip" / "whisper" framing — those route
 * to the tip page and apply to rumors. Speculation posts are algorithmic,
 * so we direct readers back to the feed entry itself.
 */

const GROUPME_POST_URL = 'https://api.groupme.com/v3/bots/post';

const SPECULATION_CTA_PREFIX = 'Read the speculation →';

/**
 * Strip trailing slashes from a base URL so we can append a path safely.
 * Returns '' when given a falsy value so callers can guard cleanly upstream.
 */
function normalizeBaseUrl(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Build the absolute deep-link to a specific feed post. Uses the canonical
 * /news path because theleague.us redirects /theleague/news → /news (see
 * vercel.json). The id MUST match the post.id we wrote into schefter-feed.json
 * because the feed renderer applies `id="post-${post.id}"` to each card
 * (SchefterPostCard.astro), making the anchor stable.
 *
 * @param {{ postId: string, publicBaseUrl?: string }} args
 * @returns {string}
 */
export function buildSpeculationDeepLink({ postId, publicBaseUrl }) {
  if (typeof postId !== 'string' || postId.length === 0) {
    throw new Error('buildSpeculationDeepLink: postId is required');
  }
  const base = normalizeBaseUrl(publicBaseUrl) || 'https://theleague.us';
  return `${base}/news#post-${postId}`;
}

/**
 * Compose the full GroupMe message body.
 *
 * Format (matches the rumor-mill convention from schefter-rumor-scan.mjs):
 *
 *   <speculation copy from the feed post>
 *
 *   Read the speculation → <absolute deep link>
 *
 * The body is taken verbatim from the persisted post — including the tier
 * emoji prefix (🟡) — so what owners see in GroupMe matches what they see
 * on the news page.
 *
 * @param {{ body: string, postId: string, publicBaseUrl?: string }} args
 */
export function buildSpeculationGroupMeText({ body, postId, publicBaseUrl }) {
  if (typeof body !== 'string' || body.length === 0) {
    throw new Error('buildSpeculationGroupMeText: body is required');
  }
  const url = buildSpeculationDeepLink({ postId, publicBaseUrl });
  return `${body}\n\n${SPECULATION_CTA_PREFIX} ${url}`;
}

/**
 * Best-effort GroupMe POST. Returns one of:
 *   { posted: true, text }                   → live POST succeeded
 *   { posted: false, reason: 'dry-run', text }
 *   { posted: false, reason: 'no-bot-id' }   → env not configured
 *   { posted: false, reason: 'http-<status>' }
 *   { posted: false, reason: 'fetch-error', error }
 *
 * Never throws. The caller has already committed the feed + ledger; surfacing
 * a GroupMe failure to the cron run would just produce noise.
 *
 * @param {object} args
 * @param {object} args.post                  - the persisted feed post
 *                                              ({ id, body, ... })
 * @param {string} [args.publicBaseUrl]       - origin used in the deep link
 * @param {Record<string,string|undefined>} [args.env] - env override for tests;
 *                                              defaults to process.env
 * @param {typeof fetch} [args.fetcher]       - fetch override for tests
 * @param {boolean} [args.dryRun]             - skip the network call
 * @param {(...a:any[])=>void} [args.log]
 * @param {(...a:any[])=>void} [args.warn]
 */
export async function postSpeculationToGroupMe({
  post,
  publicBaseUrl,
  env = process.env,
  fetcher = globalThis.fetch,
  dryRun = false,
  log = () => {},
  warn = () => {},
} = {}) {
  if (!post || typeof post.id !== 'string' || typeof post.body !== 'string') {
    return { posted: false, reason: 'invalid-post' };
  }

  const text = buildSpeculationGroupMeText({
    body: post.body,
    postId: post.id,
    publicBaseUrl,
  });

  if (dryRun) {
    log(`  [dry-run] Would post to GroupMe:\n${text}`);
    return { posted: false, reason: 'dry-run', text };
  }

  const botId = env?.GROUPME_SCHEFTER_BOT_ID;
  if (!botId) {
    warn(
      '[speculation] GROUPME_SCHEFTER_BOT_ID not set — skipping GroupMe (Roger is reserved for deadlines)',
    );
    return { posted: false, reason: 'no-bot-id' };
  }

  if (typeof fetcher !== 'function') {
    warn('[speculation] fetch unavailable — skipping GroupMe');
    return { posted: false, reason: 'no-fetch' };
  }

  try {
    const res = await fetcher(GROUPME_POST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot_id: botId, text }),
    });
    // GroupMe returns 202 on success. Anything else is a soft failure —
    // the post is already on the feed, so we just log and move on.
    const status = typeof res?.status === 'number' ? res.status : 0;
    if (status >= 200 && status < 300) {
      log('  [GroupMe] Posted speculation');
      return { posted: true, text };
    }
    warn(`  [GroupMe] Speculation post failed: HTTP ${status}`);
    return { posted: false, reason: `http-${status}`, text };
  } catch (err) {
    warn(`  [GroupMe] Speculation post error: ${err?.message ?? err}`);
    return { posted: false, reason: 'fetch-error', error: err, text };
  }
}

export const __testing__ = {
  GROUPME_POST_URL,
  SPECULATION_CTA_PREFIX,
};
