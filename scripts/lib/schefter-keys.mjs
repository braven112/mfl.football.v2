/**
 * League-scoped Redis key builder for the Schefter tips / rumor-mill system.
 *
 * TheLeague is the original tenant: its keys predate multi-league support and
 * stay byte-identical to the legacy unprefixed form (`schefter:<suffix>`).
 * Every other league is namespaced by its registry navSlug
 * (`schefter:<navSlug>:<suffix>`, e.g. `schefter:afl:tips:queue`), which is
 * what keeps the two leagues' queues, leaderboards, rate limits, and codename
 * pools fully isolated without migrating live TheLeague state.
 *
 * `tests/schefter-keys.test.ts` freezes the legacy TheLeague key strings and
 * forbids raw `'schefter:'` literals outside this module — build every
 * league-scoped key through `schefterKey`.
 *
 * GLOBAL namespaces — keyed by globally-unique ids and shared across leagues
 * by design — do NOT go through `schefterKey` and stay unprefixed forever:
 *   - `schefter:reactions:*`, `schefter:replies:*`, `schefter:reply-rate:*`
 *     (postId-keyed; both leagues' feeds already share them)
 *   - `schefter:rumor:impressions:{postId}`
 *   - `schefter:thread:{threadId}`, `schefter:thread_of:{postId}`
 *   - `schefter:tipster_hash_for_tip:{tipId}`
 * Those live in `GLOBAL_SCHEFTER_KEY` below so they're still literal-free.
 *
 * Tipster identity note: `hashTipsterId` deliberately has NO league component.
 * Per-league isolation comes entirely from these key prefixes — the same MFL
 * user tipping in both leagues gets independent rate limits, counters, and an
 * independently-assigned codename per league. Do not add league to the hash
 * input; do not expose raw hashes cross-league.
 */

import { LEAGUES } from '../../src/config/leagues-data.mjs';

/** navSlug of the league whose keys stay legacy/unprefixed. */
export const DEFAULT_SCHEFTER_NAV_SLUG = 'theleague';

const VALID_NAV_SLUGS = new Set(Object.values(LEAGUES).map((l) => l.navSlug));

/**
 * Build a league-scoped Schefter Redis key.
 *
 * @param {string|{navSlug: string}} league - registry navSlug ('theleague' |
 *   'afl') or any object carrying a `navSlug` (registry league entry).
 * @param {string} suffix - key body without the `schefter:` prefix, e.g.
 *   'tips:queue' or 'tipster:codename:' (prefix-style suffixes may end in ':').
 * @returns {string}
 */
export function schefterKey(league, suffix) {
  const navSlug =
    typeof league === 'object' && league !== null ? league.navSlug : league;
  if (!VALID_NAV_SLUGS.has(navSlug)) {
    throw new Error(`schefterKey: unknown league navSlug "${navSlug}"`);
  }
  if (typeof suffix !== 'string' || suffix.length === 0) {
    throw new Error('schefterKey: suffix required');
  }
  return navSlug === DEFAULT_SCHEFTER_NAV_SLUG
    ? `schefter:${suffix}`
    : `schefter:${navSlug}:${suffix}`;
}

/**
 * Global (league-agnostic) Schefter key namespaces. Keyed by globally-unique
 * ids (postId / tipId), so they never collide across leagues — see the module
 * doc for the list and rationale. Use `globalSchefterKey(ns, id)` to build one.
 */
export const GLOBAL_SCHEFTER_NAMESPACES = Object.freeze({
  reactions: 'schefter:reactions:',
  reactionsAnon: 'schefter:reactions:anon:',
  replies: 'schefter:replies:',
  replyRate: 'schefter:reply-rate:',
  rumorImpressions: 'schefter:rumor:impressions:',
  thread: 'schefter:thread:',
  threadOf: 'schefter:thread_of:',
  tipsterHashForTip: 'schefter:tipster_hash_for_tip:',
});

/**
 * Build a key in one of the global namespaces.
 * @param {keyof typeof GLOBAL_SCHEFTER_NAMESPACES} ns
 * @param {string} [id] - optional id appended to the namespace prefix.
 */
export function globalSchefterKey(ns, id = '') {
  const prefix = GLOBAL_SCHEFTER_NAMESPACES[ns];
  if (!prefix) throw new Error(`globalSchefterKey: unknown namespace "${ns}"`);
  return `${prefix}${id}`;
}
