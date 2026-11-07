/**
 * The live league-data pointer: how a data sync changes what the site reads
 * WITHOUT a Vercel build (plan "Data syncs without a Vercel build", phase 1).
 *
 * Shared by the request half (src/utils/league-data.ts) and the scripts that
 * move the pointer (scripts/league-data-pointer.mjs), so both agree on the key,
 * the shape and how a pointer combines with a deploy's own manifest. Pure: no
 * I/O here.
 *
 * The pointer is ONE small Redis value:
 *
 *   { schema, overlay: '<hash>', patterns: ['data/theleague/mfl-feeds/**', …],
 *     publishedAt: ISO, refreshedAt: ISO, source: 'roster-sync' | 'rollback' | …,
 *     base: '<store URL>', gitBase: '<commit sha>' }
 *
 * `overlay` names a blob in the store (`league-data/<hash>.json`, content
 * hashed like every other file) holding `{ files: { path: hash } }` for every
 * file under `patterns`. The site reads its deploy's manifest with that slice
 * swapped out: files under `patterns` come from the overlay — including the
 * absence of one the sync deleted — and everything else from the deploy. So a
 * code deploy still ships its own config and assets, and the sync owns only
 * the files it writes.
 */

/**
 * The data layout this code reads. A pointer carrying any other number is
 * ignored and the deploy serves its own built data, so a sync can never break
 * a page by getting ahead of (or behind) the code. Bump it when a change makes
 * old and new code read the same paths differently.
 */
export const LEAGUE_DATA_SCHEMA = 1;

/** Redis key of the live pointer. */
export const LIVE_POINTER_KEY = 'league-data:live';

/** Redis list of earlier pointers, newest first — what a rollback picks from. */
export const LIVE_HISTORY_KEY = 'league-data:history';

/** How many earlier pointers the history keeps. */
export const LIVE_HISTORY_LENGTH = 50;

/** How long one server instance trusts the pointer it last read. */
export const LIVE_CHECK_INTERVAL_MS = 60_000;

/**
 * A pointer no sync has confirmed for this long is ignored, and every deploy
 * serves the data it was built with. Each sync run re-stamps `refreshedAt`
 * even when nothing changed, so this only trips when the syncs stopped
 * publishing — and then git, which the deploys build from, is the fresher copy.
 * Comfortably above the longest quiet stretch the sync cadence allows.
 */
export const LIVE_MAX_AGE_MS = 36 * 60 * 60 * 1000;

/** Whether no sync has confirmed `pointer` within LIVE_MAX_AGE_MS of `now`. */
export function pointerIsStale(pointer, now = Date.now()) {
  const at = Date.parse(pointer.refreshedAt ?? pointer.publishedAt);
  return Number.isFinite(at) && now - at > LIVE_MAX_AGE_MS;
}

/** A path glob as a RegExp: `*` is one path segment, `**` any depth. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
    } else if (c === '*') {
      re += '[^/]*';
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * A parsed, usable pointer, or null. Upstash returns JSON values already
 * parsed; a value written as a string is parsed here.
 * @param {unknown} raw
 * @returns {{ schema: number, overlay: string, patterns: string[], publishedAt: string, source?: string, refreshedAt?: string, base?: string, gitBase?: string } | null}
 */
export function parsePointer(raw) {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const p = /** @type {Record<string, unknown>} */ (value);
  if (typeof p.schema !== 'number' || typeof p.overlay !== 'string' || !/^[0-9a-f]{32}$/.test(p.overlay)) return null;
  if (!Array.isArray(p.patterns) || !p.patterns.every((g) => typeof g === 'string' && g.length > 0)) return null;
  if (typeof p.publishedAt !== 'string') return null;
  return {
    schema: p.schema,
    overlay: p.overlay,
    patterns: /** @type {string[]} */ (p.patterns),
    publishedAt: p.publishedAt,
    ...(typeof p.source === 'string' ? { source: p.source } : {}),
    // Written by scripts/league-data-pointer.mjs for the next sync run, which
    // starts from the live data: when it was last confirmed, the store's base
    // URL, and the git commit the published files were built on.
    ...(typeof p.refreshedAt === 'string' ? { refreshedAt: p.refreshedAt } : {}),
    ...(typeof p.base === 'string' && /^https:\/\//.test(p.base) ? { base: p.base } : {}),
    ...(typeof p.gitBase === 'string' && /^[0-9a-f]{40}$/.test(p.gitBase) ? { gitBase: p.gitBase } : {}),
  };
}

/**
 * The deploy's file map with the pointer's slice swapped in: every path under
 * `patterns` comes from `overlayFiles` (or is gone, if the overlay lacks it),
 * every other path from `builtFiles`.
 * @param {Record<string, string>} builtFiles
 * @param {Record<string, string>} overlayFiles
 * @param {string[]} patterns
 * @returns {Record<string, string>}
 */
export function composeFiles(builtFiles, overlayFiles, patterns) {
  const res = patterns.map(globToRegExp);
  const owned = (path) => res.some((re) => re.test(path));
  const out = {};
  for (const [path, hash] of Object.entries(builtFiles)) if (!owned(path)) out[path] = hash;
  for (const [path, hash] of Object.entries(overlayFiles)) if (owned(path)) out[path] = hash;
  return out;
}
