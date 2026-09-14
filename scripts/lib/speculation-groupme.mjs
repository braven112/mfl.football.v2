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
 *   - buildSpeculationGroupMeText({ body, ctaUrl })
 *       → "<body>\n\n<CTA prefix> <url>" — the exact bytes we send. Takes the
 *         URL rather than building one: the destination is a PREFIXED internal
 *         route, and whether that prefix is kept or stripped depends on the
 *         base (see scripts/lib/schefter-public-url.mjs). Concatenating one
 *         here is how `theleague.us/theleague/trade-builder` ships.
 *   - postSpeculationToGroupMe({ post, ctaUrl, env, fetcher,
 *                               dryRun, log, warn })
 *       → best-effort POST to GroupMe. NEVER throws — the post is already
 *         on disk + on the ledger by the time we get here, so a GroupMe
 *         outage cannot block the run.
 *
 * The CTA copy intentionally avoids "tip" / "whisper" framing — those route
 * to the tip page and apply to rumors, and a speculation post is algorithmic:
 * there is nothing to whisper back ABOUT, because nobody said anything.
 *
 * It used to send readers back to the feed entry — "Read the speculation →
 * /news?post=<id>" — which is a link to the thing they had just finished
 * reading in the chat. The post is a HYPOTHETICAL TRADE, so the one useful
 * next click is the Trade Builder, where an owner can actually build the deal
 * (or the counter it deserves). That is the same destination every other
 * trade-flavored Schefter post already uses; this lane was the odd one out
 * (owner report, 2026-09-11).
 */

import { stripLinkAdjacentPunctuation } from '../../src/utils/link-punctuation.mjs';

import { isPlannedToday, describeRefusal } from './groupme-day-plan.mjs';

const GROUPME_POST_URL = 'https://api.groupme.com/v3/bots/post';

// Matches the rumor-mill's trade CTA voice (`Counter on the block?`) without
// repeating it verbatim — this is a deal nobody has proposed, so the invitation
// is to build it rather than to answer it.
const SPECULATION_CTA_PREFIX = 'Build it yourself →';

/**
 * Strip trailing slashes from a base URL so we can append a path safely.
 * Returns '' when given a falsy value so callers can guard cleanly upstream.
 */
function normalizeBaseUrl(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Build the absolute deep-link to a specific feed post.
 *
 * No longer used by the GroupMe CTA — that points at the Trade Builder now
 * (see the module header) — but kept exported because
 * `scripts/resend-speculation-groupme.mjs` and the feed's own share surfaces
 * still need the canonical anchor for a post.
 *
 * Uses the canonical /news path because theleague.us redirects
 * /theleague/news → /news (see vercel.json). The id MUST match the post.id we
 * wrote into schefter-feed.json because the feed renderer applies
 * `id="post-${post.id}"` to each card (SchefterPostCard.astro), making the
 * anchor stable.
 *
 * The ?post=<id> query is for link unfurlers (GroupMe etc.), which strip the
 * #fragment before fetching: the SSR news page reads it and emits per-post
 * og:title / og:image meta pointing at /api/og/schefter/<id>.png, so every
 * deep link unfurls with its own composite card. Browsers still scroll to
 * the #post-<id> anchor.
 *
 * @param {{ postId: string, publicBaseUrl?: string }} args
 * @returns {string}
 */
export function buildSpeculationDeepLink({ postId, publicBaseUrl }) {
  if (typeof postId !== 'string' || postId.length === 0) {
    throw new Error('buildSpeculationDeepLink: postId is required');
  }
  const base = normalizeBaseUrl(publicBaseUrl) || 'https://theleague.us';
  const encodedId = encodeURIComponent(postId);
  return `${base}/news?post=${encodedId}#post-${postId}`;
}

/**
 * Compose the full GroupMe message body.
 *
 * Format (matches the rumor-mill convention from schefter-rumor-scan.mjs):
 *
 *   <speculation copy from the feed post>
 *
 *   Build it yourself → <absolute Trade Builder URL>
 *
 * The body is taken verbatim from the persisted post — including the tier
 * emoji prefix (🟡) — so what owners see in GroupMe matches what they see
 * on the news page.
 *
 * @param {{ body: string, ctaUrl: string }} args
 */
export function buildSpeculationGroupMeText({ body, ctaUrl }) {
  if (typeof body !== 'string' || body.length === 0) {
    throw new Error('buildSpeculationGroupMeText: body is required');
  }
  if (typeof ctaUrl !== 'string' || ctaUrl.length === 0) {
    throw new Error('buildSpeculationGroupMeText: ctaUrl is required');
  }
  // The body is LLM-written and regularly ends a sentence right after a link,
  // so scrub the whole composed message rather than just the CTA line. Done
  // here (not at POST time) so the returned `text` — which the dry-run log and
  // the unit tests both read — is the exact payload.
  return stripLinkAdjacentPunctuation(`${body}\n\n${SPECULATION_CTA_PREFIX} ${ctaUrl}`);
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
 * @param {string} args.ctaUrl                - absolute URL the CTA points at,
 *                                              built by the caller through
 *                                              scripts/lib/schefter-public-url.mjs
 * @param {Record<string,string|undefined>} [args.env] - env override for tests;
 *                                              defaults to process.env
 * @param {typeof fetch} [args.fetcher]       - fetch override for tests
 * @param {boolean} [args.dryRun]             - skip the network call
 * @param {() => boolean} [args.allowPost] - day-plan check; override in tests.
 *          NOT the budget: `schefter-trade-speculation.mjs` owns that for this
 *          lane — it gates on the shared 3/day + 4h spacing at its step 3 and
 *          CONSUMES the slot at step 9, both before this is called.
 * @param {(...a:any[])=>void} [args.log]
 * @param {(...a:any[])=>void} [args.warn]
 */
export async function postSpeculationToGroupMe({
  post,
  ctaUrl,
  env = process.env,
  fetcher = globalThis.fetch,
  dryRun = false,
  // Injected like `fetcher` and `env` above. The default asks the DAY PLAN
  // only. It must not re-check the shared trade budget: the calling script
  // increments posts_today and stamps last_post_ts at its step 9, BEFORE this
  // runs, so a second look at those keys sees a millisecond-old timestamp and
  // refuses on 4-hour spacing — every single time. That bug made this lane
  // post nothing at all while looking correctly gated.
  allowPost = () => isPlannedToday('trade-speculation'),
  log = () => {},
  warn = () => {},
} = {}) {
  if (!post || typeof post.id !== 'string' || typeof post.body !== 'string') {
    return { posted: false, reason: 'invalid-post' };
  }

  const text = buildSpeculationGroupMeText({
    body: post.body,
    // The caller owns this: only it knows the league registry entry and the
    // operator's base, which together decide whether the route keeps its
    // league prefix.
    ctaUrl: ctaUrl || post.link || '',
  });

  if (dryRun) {
    log(`  [dry-run] Would post to GroupMe:\n${text}`);
    return { posted: false, reason: 'dry-run', text };
  }

  // This lane predates postToGroupMe and posts /v3/bots/post directly, so the
  // day-plan check has to be asked explicitly — a raw fetch is exactly how a
  // sender ends up outside a cap nobody realises it is outside of.
  if (!allowPost()) {
    const why = describeRefusal('trade-speculation', null);
    log(`  [speculation] Held: ${why}`);
    return { posted: false, reason: 'daily-cap', why };
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
