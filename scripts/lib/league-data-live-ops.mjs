/**
 * Moving the live league-data pointer (src/config/league-data-live.mjs): the
 * pure half of scripts/league-data-pointer.mjs, so the tests can pin it
 * without Redis or Blob.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEAGUE_DATA_SCHEMA, LIVE_HISTORY_LENGTH, globToRegExp, parsePointer } from '../../src/config/league-data-live.mjs';
import { hashContent, storeFiles } from './league-data-store.mjs';

/**
 * The overlay for `patterns` as the files stand on disk: every store file
 * under the patterns with its content hash, and the overlay blob itself
 * (`{ files }`, named by ITS content hash like every other blob).
 * @param {string[]} patterns
 * @param {string} [root]
 */
export function buildOverlay(patterns, root = process.cwd()) {
  const res = patterns.map(globToRegExp);
  const files = {};
  for (const f of storeFiles(root)) {
    if (res.some((re) => re.test(f))) files[f] = hashContent(readFileSync(join(root, f)));
  }
  const body = Buffer.from(JSON.stringify({ files }));
  return { files, body, hash: hashContent(body) };
}

/**
 * The pointer naming `overlay`. `base` (the store's URL) and `gitBase` (the
 * commit the files were built on) are for the next sync run's hydrate.
 * @param {{ overlay: string, patterns: string[], source: string, now?: Date, base?: string, gitBase?: string }} args
 */
export function makePointer({ overlay, patterns, source, now = new Date(), base, gitBase }) {
  const at = now.toISOString();
  return {
    schema: LEAGUE_DATA_SCHEMA,
    overlay,
    patterns,
    publishedAt: at,
    refreshedAt: at,
    source,
    ...(base ? { base } : {}),
    ...(gitBase ? { gitBase } : {}),
  };
}

/**
 * Which overlay files a sync run should take from the store before it fetches,
 * so it starts from the data the site is serving rather than the last daily
 * commit. A file git changed since the pointer's `gitBase` is someone else's
 * newer write (a code change, another lane's commit) and git keeps it; every
 * other file whose content differs from the overlay is taken from the store.
 * @param {Record<string, string>} overlayFiles path → hash
 * @param {(path: string) => string | null} diskHash null when the file is absent
 * @param {Set<string>} changedInGit paths changed between gitBase and HEAD
 * @param {(path: string) => boolean} [allowed] paths the run may write; any other is ignored
 * @returns {Array<{ path: string, hash: string }>}
 */
export function planHydrate(overlayFiles, diskHash, changedInGit, allowed = () => true) {
  const take = [];
  for (const [path, hash] of Object.entries(overlayFiles)) {
    if (!allowed(path) || !/^[0-9a-f]{32}$/.test(String(hash))) continue;
    if (changedInGit.has(path)) continue;
    if (diskHash(path) !== hash) take.push({ path, hash });
  }
  return take.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * What a rollback of `steps` does to the history (newest first): the pointer
 * that becomes live, and how many entries come off the front of the list. The
 * current pointer is the bad one being undone, so it is NOT kept — a second
 * rollback goes further back instead of flipping back to it.
 * @param {unknown[]} history raw entries, newest first
 * @param {number} steps 1 = the pointer before the current one
 */
export function planRollback(history, steps = 1) {
  if (!Number.isInteger(steps) || steps < 1) throw new Error(`steps must be a whole number ≥ 1, got ${steps}`);
  if (history.length < steps) {
    throw new Error(`history holds ${history.length} earlier pointer(s); cannot go back ${steps}`);
  }
  const target = parsePointer(history[steps - 1]);
  if (!target) throw new Error(`history entry ${steps} is not a usable pointer`);
  return { target, drop: steps };
}

export { LIVE_HISTORY_LENGTH };
