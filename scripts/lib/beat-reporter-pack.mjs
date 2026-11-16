/**
 * The private beat-reporter content pack — read side.
 *
 * The reporter's voice material (example bank, house-reporter voice, the
 * rumor mill's system prompt) is a trade secret and lives in the PRIVATE
 * braven112/beat-reporter repo, not here. The jobs that write posts check it
 * out at .private/beat-reporter (BEAT_REPORTER_DIR overrides; see
 * `privateLoreRoot` in schefter-lore.mjs, which owns the path).
 *
 * Every read FAILS SOFT and returns null, so the caller decides what a missing
 * pack means: the example bank goes empty, the house voice keeps its short
 * public stub, and the rumor mill falls back to its templates rather than
 * writing without its anonymity rules. Reads are synchronous and cached per
 * absolute path, because the callers are prompt builders that are sync today.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { privateLoreRoot } from './schefter-lore.mjs';

/** @type {Map<string, string | null>} */
const cache = new Map();
/** @type {Set<string>} */
const warned = new Set();

/**
 * One file from the pack as text, or null when it is missing or empty.
 *
 * @param {string} rel  Path inside the pack, e.g. 'prompts/rumor-mill.md'.
 * @param {{ log?: Pick<Console, 'warn'> }} [opts]
 * @returns {string | null}
 */
export function readPackText(rel, { log = console } = {}) {
  const abs = path.join(privateLoreRoot(), rel);
  if (cache.has(abs)) return cache.get(abs) ?? null;
  let text = null;
  try {
    const raw = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n').trim();
    text = raw || null;
  } catch {
    text = null;
  }
  if (text === null && !warned.has(abs)) {
    warned.add(abs);
    log.warn?.(`  [beat-reporter] ${rel} not found in the private pack (${privateLoreRoot()}) — using the public fallback.`);
  }
  cache.set(abs, text);
  return text;
}

/**
 * One JSON file from the pack, or null when it is missing or does not parse.
 *
 * @param {string} rel
 * @param {{ log?: Pick<Console, 'warn'> }} [opts]
 * @returns {unknown}
 */
export function readPackJson(rel, opts) {
  const text = readPackText(rel, opts);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    (opts?.log ?? console).warn?.(`  [beat-reporter] ${rel} is not valid JSON — using the public fallback.`);
    return null;
  }
}

/** Test seam: forget every cached read. */
export function resetPackCache() {
  cache.clear();
  warned.clear();
}
