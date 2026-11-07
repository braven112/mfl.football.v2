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
 * The pointer naming `overlay`.
 * @param {{ overlay: string, patterns: string[], source: string, now?: Date }} args
 */
export function makePointer({ overlay, patterns, source, now = new Date() }) {
  return { schema: LEAGUE_DATA_SCHEMA, overlay, patterns, publishedAt: now.toISOString(), source };
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
