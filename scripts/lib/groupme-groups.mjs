/**
 * Resolve which GroupMe GROUP a league's bot lives in.
 *
 * Posting and reading need different identifiers, and the repo only ever had
 * the posting one. `POST /v3/bots/post` takes a `bot_id` and nothing else — it
 * never needs to know the group — which is why GROUPME_AFL_ROGER_BOT_ID has
 * been enough to nag the AFL for years while no AFL group id exists anywhere
 * in the repo. Reading the group (`GET /v3/groups/<id>/messages`) needs the
 * group id, so Roger's reply lane was blocked on a secret nobody had.
 *
 * It turns out nobody needs to create one. `GET /v3/bots` lists the bots the
 * service token owns and each entry carries its own `group_id`, so the bot id
 * we already store names its own group. This module makes that hop and caches
 * the answer, so adding Roger's reply lane to a league costs zero new secrets
 * and cannot drift out of sync with the bot it belongs to.
 *
 * An explicitly configured group id always wins — that stays the escape hatch
 * for a bot that posts into a group the token doesn't own.
 */

const GROUPME_API_BASE = 'https://api.groupme.com/v3';

/**
 * The slice of `fetch` this module actually uses.
 *
 * Typed structurally rather than as `typeof fetch` on purpose: nothing here
 * touches a Response beyond `ok`, `status` and `json()`, and demanding the full
 * DOM signature would force every caller and test stub to build a whole
 * Response object to satisfy a checker rather than a runtime.
 *
 * @typedef {(url: string, init?: object) => Promise<any>} MinimalFetch
 */

/**
 * The two Redis operations the group-id cache needs. Any client providing them
 * works; the scripts pass an @upstash/redis instance.
 *
 * @typedef {{
 *   get: (key: string) => Promise<any>,
 *   set: (key: string, value: string, opts?: object) => Promise<any>
 * }} GroupIdCache
 */

/** Cache key for a derived group id. Long-lived: a bot's group never changes. */
export function groupIdCacheKey(navSlug) {
  return `groupme:${navSlug}:resolved_group_id`;
}

/** A derived group id is stable, but re-check weekly in case a bot is rebuilt. */
export const GROUP_ID_CACHE_TTL_SEC = 7 * 24 * 60 * 60;

function serviceToken() {
  return process.env.GROUPME_SERVICE_TOKEN || process.env.GROUPME_ACCESS_TOKEN || null;
}

/**
 * List the bots owned by the service token.
 *
 * @param {{fetchImpl?: MinimalFetch, token?: string|null}} [opts]
 * @returns {Promise<Array<{bot_id: string, group_id: string, name: string}>|null>}
 *   null on any failure — callers degrade rather than throw mid-scan.
 */
export async function fetchBots({ fetchImpl = fetch, token = serviceToken() } = {}) {
  if (!token) return null;
  try {
    const res = await fetchImpl(`${GROUPME_API_BASE}/bots?token=${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const bots = data?.response;
    return Array.isArray(bots) ? bots : null;
  } catch {
    return null;
  }
}

/**
 * Find the group a given bot posts into.
 *
 * @param {{botId?: string|null, fetchImpl?: MinimalFetch, token?: string|null}} opts
 * @returns {Promise<string|null>}
 */
export async function resolveGroupIdForBot({ botId, fetchImpl = fetch, token = serviceToken() }) {
  if (!botId) return null;
  const bots = await fetchBots({ fetchImpl, token });
  if (!bots) return null;
  const match = bots.find((b) => b?.bot_id === botId);
  const groupId = match?.group_id;
  return typeof groupId === 'string' && groupId ? groupId : null;
}

/**
 * Resolve a league's group id, preferring cheap sources.
 *
 *   1. An explicitly configured id (registry / env override) — always wins.
 *   2. The Redis cache, so the common path costs one GET.
 *   3. `GET /v3/bots`, matching the league's Roger bot id; cached on success.
 *
 * @param {object} opts
 * @param {object} opts.league  a SCHEFTER_LEAGUES entry
 * @param {GroupIdCache|null} [opts.redis]
 * @param {MinimalFetch} [opts.fetchImpl]
 * @param {string|null} [opts.token]
 * @returns {Promise<{groupId: string|null, source: string}>}
 */
export async function resolveLeagueGroupId({
  league,
  redis = null,
  fetchImpl = fetch,
  token = serviceToken(),
}) {
  if (league?.groupMeGroupId) {
    return { groupId: league.groupMeGroupId, source: 'configured' };
  }

  const cacheKey = groupIdCacheKey(league.slug);
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (typeof cached === 'string' && cached) return { groupId: cached, source: 'cache' };
    } catch {
      // Cache miss by failure is the same as a cache miss — fall through.
    }
  }

  const groupId = await resolveGroupIdForBot({
    botId: league?.groupMeRogerBotId,
    fetchImpl,
    token,
  });
  if (!groupId) return { groupId: null, source: 'unresolved' };

  if (redis) {
    try {
      await redis.set(cacheKey, groupId, { ex: GROUP_ID_CACHE_TTL_SEC });
    } catch {
      // A cache write failure costs one extra API call next run, nothing more.
    }
  }
  return { groupId, source: 'derived' };
}

/**
 * List a group's members.
 *
 * @param {{groupId?: string|null, fetchImpl?: MinimalFetch, token?: string|null}} opts
 * @returns {Promise<Array<{user_id: string, nickname: string}>|null>}
 */
export async function fetchGroupMembers({ groupId, fetchImpl = fetch, token = serviceToken() }) {
  if (!groupId || !token) return null;
  try {
    const res = await fetchImpl(
      `${GROUPME_API_BASE}/groups/${groupId}?token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const members = data?.response?.members;
    return Array.isArray(members) ? members : null;
  } catch {
    return null;
  }
}
