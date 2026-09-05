/**
 * My Watch List — Redis mirror keys.
 *
 * Plain .mjs so the API route (TypeScript), Astro pages, AND the cron senders
 * under scripts/ build the same key. The mirror is a per-franchise, per-league
 * cache of what MFL's `myWatchList` holds; it exists so pages and crons can
 * read the list without an owner cookie, which MFL requires for every read.
 *
 * Keyed by the REGISTRY league slug (`theleague`, `afl-fantasy`), never by a
 * rankings scope or nav slug — both leagues have a franchise 0001, and the
 * slug is the one identifier every layer already has.
 */

export const WATCH_LIST_KEY_PREFIX = 'wl';

/** @param {string} leagueSlug registry slug @param {string} franchiseId four-digit id */
export function watchListKey(leagueSlug, franchiseId) {
  return `${WATCH_LIST_KEY_PREFIX}:${leagueSlug}:${franchiseId}`;
}

/**
 * Shape of the value stored at `watchListKey`. Kept here (as JSDoc) so the
 * scripts and the TypeScript side describe the same object.
 * @typedef {{ playerIds: string[], syncedAt: string }} WatchListMirror
 */

/** Read-side normalizer: accepts any stored value and yields a clean id list. */
export function mirrorPlayerIds(value) {
  if (!value || typeof value !== 'object') return [];
  const ids = /** @type {{ playerIds?: unknown }} */ (value).playerIds;
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => `${id}`.trim()).filter((id) => /^\d{1,7}$/.test(id));
}
